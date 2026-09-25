/**
 * Scans the old client's storage/ files off the UI thread. Receives only public keys: the private
 * keys stay in the background service worker.
 */
import { StorageScanner } from '@/core/legacy/storage';
import { fromHex } from '@/core/bytes';
import type { ScanRequest, ScanMessage } from './storage-scan';

/** no genuine 64-second frame file comes close to this */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

// typed against the DOM lib like the rest of the UI; in a dedicated worker `self.postMessage` takes one argument
const post = (m: ScanMessage) => (self as unknown as { postMessage(m: ScanMessage): void }).postMessage(m);

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const req = e.data;
  try {
    const scanner = new StorageScanner(req.pubkeys.map(fromHex), { thorough: req.thorough, verifyBudget: req.verifyBudget });
    let last = 0;
    for (let i = 0; i < req.files.length; i++) {
      const f = req.files[i]!;
      let bytes: Uint8Array | null = null;
      try {
        bytes = new Uint8Array(await f.file.slice(0, MAX_FILE_BYTES).arrayBuffer());
      } catch {
        scanner.stats.damagedFiles++;
      }
      if (bytes) scanner.scanFile(bytes, f);
      if (scanner.stats.budgetExhausted) break;
      const now = performance.now();
      if (now - last > 120) {
        last = now;
        post({ type: 'progress', done: i + 1, total: req.files.length, found: scanner.results() });
      }
    }
    post({ type: 'done', found: scanner.results(), stats: scanner.stats });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
