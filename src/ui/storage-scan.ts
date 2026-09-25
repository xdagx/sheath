/**
 * Finding the old wallet's block addresses in a selected 2018 client folder (storage/), in a
 * worker, followed by a balance lookup for every block found.
 */
import { signal } from '@preact/signals';
import { findLegacyWalletFiles, type LegacyNet, type OwnedBlock, type ScanStats, type StorageFileRef } from '@/core/legacy/storage';
import { RpcError, type XdagRpc } from '@/core/rpc';

export interface ScanRequest {
  files: Array<{ file: File } & StorageFileRef>;
  /** compressed public keys, hex */
  pubkeys: string[];
  thorough: boolean;
  verifyBudget: number;
}

export type ScanMessage =
  | { type: 'progress'; done: number; total: number; found: OwnedBlock[] }
  | { type: 'done'; found: OwnedBlock[]; stats: ScanStats }
  | { type: 'error'; message: string };

/** A selected old client folder: the wallet files and the block files of its storage folder. */
export interface LegacyFolder {
  name: string;
  walletDat: File | null;
  dnetKeyDat: File | null;
  storage: Array<{ file: File } & StorageFileRef>;
  storageBytes: number;
}

/** the folder picked on the import page, handed to the preview page (File objects stay in this tab) */
export const pickedFolder = signal<LegacyFolder | null>(null);

/** storage files beyond this are ignored (a full node adds ~490,000 files a year) */
export const MAX_STORAGE_FILES = 400_000;
/** ECDSA verifications per scan (~1–2 ms each) */
export const VERIFY_BUDGET = 200_000;
/** below this many block × key checks, even blocks that embed only foreign keys are verified */
const THOROUGH_LIMIT = 100_000;

export function readFolder(files: File[]): LegacyFolder {
  const withPath = files.map((file) => ({ file, path: file.webkitRelativePath || file.name }));
  const { walletDat, dnetKeyDat, storage } = findLegacyWalletFiles(withPath);
  const kept = storage.slice(0, MAX_STORAGE_FILES);
  return {
    name: withPath[0]?.path.split('/')[0] ?? '',
    walletDat: walletDat?.file ?? null,
    dnetKeyDat: dnetKeyDat?.file ?? null,
    storage: kept.map(({ file, net, frame }) => ({ file, net, frame })),
    storageBytes: kept.reduce((n, f) => n + f.file.size, 0),
  };
}

export interface ScanHandle {
  done: Promise<{ found: OwnedBlock[]; stats: ScanStats }>;
  cancel(): void;
}

export function scanFolder(folder: LegacyFolder, pubkeys: string[], onProgress: (done: number, total: number, found: OwnedBlock[]) => void): ScanHandle {
  const worker = new Worker(new URL('./storage-scan.worker.ts', import.meta.url), { type: 'module' });
  let settle: ((v: { found: OwnedBlock[]; stats: ScanStats }) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  const done = new Promise<{ found: OwnedBlock[]; stats: ScanStats }>((res, rej) => {
    settle = res;
    fail = rej;
  });
  worker.onmessage = (e: MessageEvent<ScanMessage>) => {
    const m = e.data;
    if (m.type === 'progress') onProgress(m.done, m.total, m.found);
    else {
      worker.terminate();
      if (m.type === 'done') settle?.({ found: m.found, stats: m.stats });
      else fail?.(new Error(m.message));
    }
  };
  worker.onerror = (e) => {
    worker.terminate();
    fail?.(new Error(e.message || 'scan failed'));
  };
  const estimatedChecks = (folder.storageBytes / 512) * pubkeys.length;
  const req: ScanRequest = { files: folder.storage, pubkeys, thorough: estimatedChecks <= THOROUGH_LIMIT, verifyBudget: VERIFY_BUDGET };
  worker.postMessage(req);
  return {
    done,
    cancel: () => {
      worker.terminate();
      fail?.(new Error('cancelled'));
    },
  };
}

export type BlockStatus = { state: 'loading' } | { state: 'ok'; balance: bigint } | { state: 'unknown' } | { state: 'error' } | { state: 'otherNet' };

/** Old testnet storage belongs to test networks (testnet or a devnet), mainnet storage to mainnet. */
export function netMatches(blockNet: LegacyNet, networkKind: string): boolean {
  return blockNet === 'mainnet' ? networkKind === 'mainnet' : networkKind !== 'mainnet';
}

/** Balance of every found block on the current node, a few requests at a time. */
export async function lookupBalances(
  rpc: XdagRpc,
  blocks: OwnedBlock[],
  networkKind: string,
  onStatus: (address: string, status: BlockStatus) => void,
  isAlive: () => boolean,
): Promise<void> {
  const queue = blocks.filter((b) => {
    if (netMatches(b.net, networkKind)) return true;
    onStatus(b.address, { state: 'otherNet' });
    return false;
  });
  const worker = async () => {
    for (let b = queue.shift(); b && isAlive(); b = queue.shift()) {
      try {
        onStatus(b.address, { state: 'ok', balance: await rpc.getBalance(b.address) });
      } catch (e) {
        // xdagj answers an error for a block it does not know
        onStatus(b.address, e instanceof RpcError && e.kind !== 'transport' ? { state: 'unknown' } : { state: 'error' });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
