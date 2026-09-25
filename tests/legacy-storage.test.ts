/**
 * Old-address discovery from the 2018 client's storage/ folder, checked against a folder written
 * by the official C client code (tools/vectors/legacy/gen_storage.c: real xdag_create_block field
 * layout, xdag_sign, xdag_storage_save, and the client's own valid_signature as the oracle).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { findLegacyWalletFiles, parseStoragePath, StorageScanner, xtimeToMs } from '@/core/legacy/storage';
import { decryptLegacyWallet } from '@/core/legacy/wallet';
import { blockAddressOfRaw } from '@/core/address';
import { fromHex, toHex } from '@/core/bytes';

const DIR = join(import.meta.dirname, 'fixtures/legacy-storage');
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as {
  keys: Array<{ priv: string; pub: string }>;
  blocks: Array<{ name: string; net: 'mainnet' | 'testnet'; types: string; address: string; owner: number; highS: boolean; raw: string }>;
};
const pubs = expected.keys.map((k) => fromHex(k.pub));
const NOW = Date.UTC(2026, 0, 1);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function scanFixture(scanner: StorageScanner) {
  const files = walk(DIR).map((p) => ({ path: relative(DIR, p).split('\\').join('/'), abs: p }));
  const { storage } = findLegacyWalletFiles(files);
  for (const f of storage) scanner.scanFile(readFileSync(f.abs), f);
  return storage;
}

describe('storage folder scan (C client vectors)', () => {
  it('wallet.dat keys of the reviewer test folder are the keys used for the vectors, in file order', () => {
    const w = decryptLegacyWallet(
      readFileSync(join(import.meta.dirname, '../store/reviewer-test-files/wallet.dat')),
      readFileSync(join(import.meta.dirname, '../store/reviewer-test-files/dnet_key.dat')),
      'xdag2018',
    );
    expect(w.privateKeys.map(toHex)).toEqual(expected.keys.map((k) => k.priv));
    expect(w.privateKeys.map((p) => toHex(secp256k1.getPublicKey(p, true)))).toEqual(expected.keys.map((k) => k.pub));
  });

  it('computes the same block address as xdag_hash2address', () => {
    for (const b of expected.blocks) expect(blockAddressOfRaw(fromHex(b.raw)), b.name).toBe(b.address);
  });

  it('finds exactly the blocks the C client marks as ours, with the owning key', () => {
    const scanner = new StorageScanner(pubs, { now: NOW, thorough: true });
    const storage = scanFixture(scanner);
    expect(storage.map((f) => f.path)).not.toContain('storage/sums.dat');
    const found = scanner.results();
    const want = expected.blocks.filter((b) => b.owner >= 0);
    expect(found.map((f) => f.address).sort()).toEqual(want.map((b) => b.address).sort());
    for (const b of want) {
      const f = found.find((x) => x.address === b.address)!;
      expect(f.owner, b.name).toBe(b.owner);
      expect(f.net, b.name).toBe(b.net);
      expect(f.highS, b.name).toBe(b.highS);
    }
    // the foreign block is in the folder but not ours
    expect(found.some((f) => f.address === expected.blocks.find((b) => b.name === 'foreign')!.address)).toBe(false);
    // both signature forms occur and are accepted
    expect(found.some((f) => f.highS)).toBe(true);
    expect(found.some((f) => !f.highS)).toBe(true);
  });

  it('classifies the blocks', () => {
    const scanner = new StorageScanner(pubs, { now: NOW, thorough: true });
    scanFixture(scanner);
    const kindOf = (name: string) => scanner.results().find((f) => f.address === expected.blocks.find((b) => b.name === name)!.address)?.kind;
    expect(kindOf('address_default_lowS')).toBe('address');
    expect(kindOf('address_middle')).toBe('address');
    expect(kindOf('pool_first_key0')).toBe('address');
    expect(kindOf('testnet_address_key0')).toBe('address');
    expect(kindOf('xfer_in_middle_out_default')).toBe('tx');
    expect(kindOf('mined_default')).toBe('mined');
  });

  it('reports block times from the header', () => {
    const scanner = new StorageScanner(pubs, { now: NOW, thorough: true });
    scanFixture(scanner);
    const b = expected.blocks.find((x) => x.name === 'address_middle')!;
    const t = BigInt('0x' + b.raw.slice(32, 48).match(/../g)!.reverse().join(''));
    expect(scanner.results().find((f) => f.address === b.address)!.time).toBe(xtimeToMs(t));
    expect(new Date(xtimeToMs(t)).getUTCFullYear()).toBe(2018);
  });

  it('survives damaged files and skips sums.dat', () => {
    const scanner = new StorageScanner(pubs, { now: NOW });
    const storage = scanFixture(scanner);
    expect(storage.some((f) => f.path.endsWith('sums.dat'))).toBe(false);
    expect(scanner.stats.damagedFiles).toBe(2); // 05.dat with trailing bytes, empty fd.dat
    expect(scanner.results().length).toBe(expected.blocks.filter((b) => b.owner >= 0).length);
  });

  it('without `thorough`, skips blocks that embed only foreign keys', () => {
    const xfer = expected.blocks.find((b) => b.name === 'xfer_in_middle_out_default')!;
    const ref = { net: 'mainnet' as const, frame: Number(BigInt('0x' + xfer.raw.slice(32, 48).match(/../g)!.reverse().join('')) >> 16n) };
    const noMiddle = [pubs[0]!, pubs[2]!]; // the embedded input key is unknown, the signer (default key) is known
    const quick = new StorageScanner(noMiddle, { now: NOW });
    expect(quick.scanFile(fromHex(xfer.raw), ref)).toEqual([]);
    expect(quick.stats.skipped).toBe(1);
    const thorough = new StorageScanner(noMiddle, { now: NOW, thorough: true });
    expect(thorough.scanFile(fromHex(xfer.raw), ref).map((f) => [f.address, f.owner])).toEqual([[xfer.address, 1]]);
  });

  it('rejects a block from the wrong frame file or network', () => {
    const b = expected.blocks.find((x) => x.name === 'address_default_lowS')!;
    const frame = Number(BigInt('0x' + b.raw.slice(32, 48).match(/../g)!.reverse().join('')) >> 16n);
    const s = new StorageScanner(pubs, { now: NOW });
    expect(s.scanFile(fromHex(b.raw), { net: 'mainnet', frame: frame + 1 })).toEqual([]);
    const t = expected.blocks.find((x) => x.name === 'testnet_address_key0')!;
    const tframe = Number(BigInt('0x' + t.raw.slice(32, 48).match(/../g)!.reverse().join('')) >> 16n);
    expect(s.scanFile(fromHex(t.raw), { net: 'mainnet', frame: tframe })).toEqual([]);
    expect(s.scanFile(fromHex(t.raw), { net: 'testnet', frame: tframe }).length).toBe(1);
  });

  it('reports when more owned blocks exist than it keeps', () => {
    const scanner = new StorageScanner(pubs, { now: NOW, thorough: true, maxOwned: 2 });
    scanFixture(scanner);
    expect(scanner.results()).toHaveLength(2);
    expect(scanner.stats.ownedLimitReached).toBe(true);
  });

  it('stops at the verification budget', () => {
    const scanner = new StorageScanner(pubs, { now: NOW, verifyBudget: 2 });
    scanFixture(scanner);
    expect(scanner.stats.verifications).toBe(2);
    expect(scanner.stats.budgetExhausted).toBe(true);
  });

  it('ignores a transport header on disk', () => {
    const b = expected.blocks.find((x) => x.name === 'address_middle')!;
    const raw = fromHex(b.raw);
    raw.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    const frame = Number(BigInt('0x' + b.raw.slice(32, 48).match(/../g)!.reverse().join('')) >> 16n);
    const s = new StorageScanner(pubs, { now: NOW });
    expect(s.scanFile(raw, { net: 'mainnet', frame }).map((f) => f.address)).toEqual([b.address]);
  });
});

describe('goXdagWallet vector (wallet/components/wallet_test.go TestVerify)', () => {
  it('verifies the light-wallet address block signature against its key', () => {
    const priv = fromHex('eb7bc32833bc7f9e80b74303e97846d802a82cd0e9b1bcc81a9bb257ac6e118c');
    const block = new Uint8Array(512);
    block.set([0x51, 0x05], 8);
    block.set(fromHex('8a3c6efd84010000'), 16);
    block.set(fromHex('9af60175f278b5066fb236703ddfa340d75584825f5428e496c3367831cf93ab'), 32);
    block.set(fromHex('57226c8e903f7a7066c65e13458a3e1686d00256f9b1e40b6e620ad35dffe10e'), 64);
    const time = 0x184fd6e3c8an;
    const s = new StorageScanner([secp256k1.getPublicKey(fromHex('11'.repeat(32)), true), secp256k1.getPublicKey(priv, true)], { now: NOW });
    const found = s.scanFile(block, { net: 'mainnet', frame: Number(time >> 16n) });
    expect(found.map((f) => [f.owner, f.kind])).toEqual([[1, 'address']]);
    expect(found[0]!.address).toBe(blockAddressOfRaw(block));
  });
});

describe('folder selection', () => {
  it('recognises storage files only', () => {
    expect(parseStoragePath('xdag/storage/01/6a/00/05.dat')).toEqual({ net: 'mainnet', frame: 0x016a0005 });
    expect(parseStoragePath('storage-testnet/01/6A/00/0F.DAT')).toEqual({ net: 'testnet', frame: 0x016a000f });
    expect(parseStoragePath('C:\\xdag\\storage\\01\\6a\\00\\05.dat')).toEqual({ net: 'mainnet', frame: 0x016a0005 });
    expect(parseStoragePath('storage/01/6a/00/sums.dat')).toBeNull();
    expect(parseStoragePath('storage/sums.dat')).toBeNull();
    expect(parseStoragePath('storage/01/6a/05.dat')).toBeNull();
    expect(parseStoragePath('mystorage/01/6a/00/05.dat')).toBeNull();
    expect(parseStoragePath('wallet.dat')).toBeNull();
  });

  it('prefers the wallet files next to the storage folder', () => {
    const files = [
      { path: 'old/backup/wallet.dat' },
      { path: 'old/xdag/wallet.dat' },
      { path: 'old/xdag/dnet_key.dat' },
      { path: 'old/xdag/storage/01/6a/00/00.dat' },
      { path: 'old/xdag/storage/01/6a/00/sums.dat' },
      { path: 'old/xdag/pool.log' },
    ];
    const r = findLegacyWalletFiles(files);
    expect(r.walletDat?.path).toBe('old/xdag/wallet.dat');
    expect(r.dnetKeyDat?.path).toBe('old/xdag/dnet_key.dat');
    expect(r.storage.map((f) => f.path)).toEqual(['old/xdag/storage/01/6a/00/00.dat']);
  });

  it('prefers wallet.dat when the client also left a wallet-testnet.dat, in any listing order', () => {
    const base = [{ path: 'xdag/dnet_key.dat' }, { path: 'xdag/storage/01/6a/00/00.dat' }, { path: 'xdag/storage-testnet/01/6a/00/06.dat' }];
    for (const order of [
      [{ path: 'xdag/wallet-testnet.dat' }, { path: 'xdag/wallet.dat' }],
      [{ path: 'xdag/wallet.dat' }, { path: 'xdag/wallet-testnet.dat' }],
    ]) {
      const r = findLegacyWalletFiles([...base, ...order]);
      expect(r.walletDat?.path).toBe('xdag/wallet.dat');
      expect(r.otherWalletDat?.path).toBe('xdag/wallet-testnet.dat');
    }
    const only = findLegacyWalletFiles([{ path: 'x/wallet-testnet.dat' }, { path: 'x/storage-testnet/01/6a/00/06.dat' }]);
    expect(only.walletDat?.path).toBe('x/wallet-testnet.dat');
    expect(only.otherWalletDat).toBeNull();
  });

  it('works without a storage folder', () => {
    const r = findLegacyWalletFiles([{ path: 'x/wallet.dat' }, { path: 'x/dnet_key.dat' }]);
    expect(r.walletDat?.path).toBe('x/wallet.dat');
    expect(r.storage).toEqual([]);
  });
});
