/**
 * Finds the block addresses of a 2018 XDAG wallet in the C client's local storage/ folder,
 * so users do not have to remember their old 32-character address.
 *
 * Layout (xdag client/storage.c): storage/AA/BB/CC/DD.dat (storage-testnet/… on testnet) with
 * AA..DD the hex bytes of xtime>>40, >>32, >>24, >>16; every file is a sequence of raw 512-byte
 * blocks of one 64-second frame, appended in arrival order. Each directory level also holds a
 * 4096-byte sums.dat, which is not block data. A wallet/miner-mode client stores only its own
 * blocks; a full node stores the whole network.
 *
 * A block is "ours" exactly when the C client would mark it BI_OURS (client/block.c
 * add_block_nolock + valid_signature + hash_for_signature): one of its output-signature pairs
 * verifies against one of the wallet.dat keys over
 *   SHA256d(block with bytes 0..7 and every SIGN_IN/SIGN_OUT field from the pair on zeroed
 *           ‖ 33-byte compressed public key of the candidate key).
 * Address blocks carry no public key, so every wallet key is tried. 2018 signatures come from
 * OpenSSL without S normalisation, so high-S signatures must verify.
 * The address is Base64 of the first 24 bytes of SHA256d(block with bytes 0..7 zeroed).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blockAddressOfRaw } from '../address';
import { equalBytes } from '../bytes';

export type LegacyNet = 'mainnet' | 'testnet';
export type OwnedBlockKind = 'address' | 'tx' | 'mined' | 'other';

export interface StorageFileRef {
  net: LegacyNet;
  /** xtime >> 16 of every block in the file, from its path */
  frame: number;
}

export interface OwnedBlock {
  address: string;
  /** index into the public keys given to the scanner */
  owner: number;
  net: LegacyNet;
  /** block time, milliseconds since the epoch */
  time: number;
  kind: OwnedBlockKind;
  /** the output signature is not in canonical low-S form (xdagj may refuse to spend it) */
  highS: boolean;
}

export interface ScanStats {
  files: number;
  blocks: number;
  candidates: number;
  verifications: number;
  /** files that could not be used (unreadable, empty or not a whole number of blocks) */
  damagedFiles: number;
  /** candidates skipped because they carry only foreign public keys (see `thorough`) */
  skipped: number;
  budgetExhausted: boolean;
  /** more owned blocks were found than `maxOwned`; the rest were dropped */
  ownedLimitReached: boolean;
}

export interface ScanOptions {
  /** maximum number of ECDSA verifications (block × key) */
  verifyBudget?: number;
  /** also verify blocks that embed only foreign public keys (needed only for merged wallets) */
  thorough?: boolean;
  /** maximum number of owned blocks kept */
  maxOwned?: number;
  /** current time in ms, for the "not in the future" check */
  now?: number;
}

export const BLOCK_SIZE = 512;
const MAIN_ERA = 0x16940000000n;
const TEST_ERA = 0x16900000000n;
const N = secp256k1.Point.CURVE().n;
const HALF_N = N >> 1n;

const T_HEAD = 1, T_IN = 2, T_SIGN_IN = 4, T_SIGN_OUT = 5, T_PUB0 = 6, T_PUB1 = 7, T_HEAD_TEST = 8;

const PATH_RE = /(?:^|\/)(storage|storage-testnet)\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{2})\.dat$/i;

/** Recognises a block file of the C client's storage folder from its (relative) path. */
export function parseStoragePath(path: string): StorageFileRef | null {
  const m = PATH_RE.exec(path.replace(/\\/g, '/'));
  if (!m) return null;
  const [, dir, a, b, c, d] = m;
  return {
    net: dir!.toLowerCase() === 'storage-testnet' ? 'testnet' : 'mainnet',
    frame: ((parseInt(a!, 16) << 24) | (parseInt(b!, 16) << 16) | (parseInt(c!, 16) << 8) | parseInt(d!, 16)) >>> 0,
  };
}

/** Standard xtime (1/1024 s units) to milliseconds. */
export function xtimeToMs(t: bigint): number {
  return Number((t * 1000n) / 1024n);
}

function u64le(b: Uint8Array, o: number): bigint {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[o + i]!);
  return x;
}

function beInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

export class StorageScanner {
  readonly stats: ScanStats = { files: 0, blocks: 0, candidates: 0, verifications: 0, damagedFiles: 0, skipped: 0, budgetExhausted: false, ownedLimitReached: false };
  private readonly found = new Map<string, OwnedBlock>();
  private readonly budget: number;
  private readonly thorough: boolean;
  private readonly maxOwned: number;
  private readonly nowX: bigint;

  constructor(
    private readonly pubkeys: Uint8Array[],
    opts: ScanOptions = {},
  ) {
    if (pubkeys.some((p) => p.length !== 33)) throw new Error('Expected compressed public keys');
    this.budget = opts.verifyBudget ?? 200_000;
    this.thorough = opts.thorough ?? false;
    this.maxOwned = opts.maxOwned ?? 5_000;
    this.nowX = (BigInt(Math.floor(opts.now ?? Date.now())) * 1024n) / 1000n;
  }

  /** Owned blocks found so far, oldest first. */
  results(): OwnedBlock[] {
    return [...this.found.values()].sort((a, b) => a.time - b.time || a.address.localeCompare(b.address));
  }

  /** Scans one storage file. Never throws on malformed content. */
  scanFile(bytes: Uint8Array, ref: StorageFileRef): OwnedBlock[] {
    this.stats.files++;
    if (bytes.length === 0 || bytes.length % BLOCK_SIZE !== 0) this.stats.damagedFiles++;
    const out: OwnedBlock[] = [];
    const count = Math.floor(bytes.length / BLOCK_SIZE);
    for (let j = 0; j < count; j++) {
      this.stats.blocks++;
      const block = Uint8Array.from(bytes.subarray(j * BLOCK_SIZE, (j + 1) * BLOCK_SIZE));
      const owned = this.checkBlock(block, ref);
      if (owned) out.push(owned);
    }
    return out;
  }

  private checkBlock(b: Uint8Array, ref: StorageFileRef): OwnedBlock | null {
    b.fill(0, 0, 8); // transport header: zero on disk, and zeroed by the client before hashing
    const types = u64le(b, 8);
    const time = u64le(b, 16);
    const nib = (k: number) => Number((types >> BigInt(4 * k)) & 0xfn);

    // the checks add_block_nolock applies before a block is stored at all
    const head = nib(0);
    if (ref.net === 'mainnet' ? head !== T_HEAD : head !== T_HEAD_TEST && head !== T_HEAD) return null;
    if (time >> 16n !== BigInt(ref.frame)) return null;
    if (time < (ref.net === 'mainnet' ? MAIN_ERA : TEST_ERA) || time > this.nowX + 0x10000n) return null;
    const pairs: Array<[number, number]> = [];
    let outs = 0;
    for (let k = 1; k < 16; k++) {
      const t = nib(k);
      if (t === T_HEAD_TEST) return null;
      if (t !== T_SIGN_OUT) continue;
      if (++outs & 1) {
        let s = k + 1;
        while (s < 16 && nib(s) !== T_SIGN_OUT) s++;
        if (s < 16) pairs.push([k, s]);
      }
    }
    if (outs < 2 || outs & 1 || !pairs.length) return null;
    this.stats.candidates++;

    const embedded: Uint8Array[] = [];
    let hasIn = false;
    let hasSignIn = false;
    for (let k = 1; k < 16; k++) {
      const t = nib(k);
      if (t === T_IN) hasIn = true;
      if (t === T_SIGN_IN) hasSignIn = true;
      if (t === T_PUB0 || t === T_PUB1) {
        const pk = new Uint8Array(33);
        pk[0] = 2 | (t - T_PUB0);
        pk.set(b.subarray(32 * k, 32 * k + 32), 1);
        embedded.push(pk);
      }
    }
    // Blocks whose embedded keys are all foreign were made by another wallet: the C client
    // embeds the input keys and signs the output with one of them or with its newest key.
    if (!this.thorough && embedded.length && !embedded.some((e) => this.pubkeys.some((p) => equalBytes(p, e)))) {
      this.stats.skipped++;
      return null;
    }

    for (const [r, s] of pairs) {
      const R = beInt(b.subarray(32 * r, 32 * r + 32));
      const S = beInt(b.subarray(32 * s, 32 * s + 32));
      if (R < 1n || R >= N || S < 1n || S >= N) continue;
      const msg = Uint8Array.from(b);
      for (let k = r; k < 16; k++) {
        const t = nib(k);
        if (t === T_SIGN_IN || t === T_SIGN_OUT) msg.fill(0, 32 * k, 32 * k + 32);
      }
      const sig = new Uint8Array(64);
      sig.set(b.subarray(32 * r, 32 * r + 32), 0);
      sig.set(b.subarray(32 * s, 32 * s + 32), 32);
      const mid = sha256.create().update(msg); // shared by every candidate key
      for (let i = 0; i < this.pubkeys.length; i++) {
        if (this.stats.verifications >= this.budget) {
          this.stats.budgetExhausted = true;
          return null;
        }
        this.stats.verifications++;
        const digest = sha256(mid.clone().update(this.pubkeys[i]!).digest());
        let ok = false;
        try {
          ok = secp256k1.verify(sig, digest, this.pubkeys[i]!, { prehash: false, lowS: false, format: 'compact' });
        } catch {
          ok = false;
        }
        if (!ok) continue;
        const address = blockAddressOfRaw(b);
        if (this.found.has(address)) return null;
        if (this.found.size >= this.maxOwned) {
          this.stats.ownedLimitReached = true;
          return null;
        }
        // address: the wallet's own first block (0x551 / 0x558), or a pool's first block (links + signature)
        const kind: OwnedBlockKind = hasIn
          ? 'tx'
          : nib(15) === T_SIGN_IN && (time & 0xffffn) === 0xffffn
            ? 'mined'
            : !embedded.length && !hasSignIn
              ? 'address'
              : 'other';
        const owned: OwnedBlock = { address, owner: i, net: ref.net, time: xtimeToMs(time), kind, highS: S > HALF_N };
        this.found.set(address, owned);
        return owned;
      }
    }
    return null;
  }
}

export interface FolderFile {
  /** path relative to the selected folder, "/"-separated, starting with the folder name */
  path: string;
}

/**
 * Picks the wallet files of an old client folder: wallet.dat (or wallet-testnet.dat) and
 * dnet_key.dat, preferring those that sit next to a storage folder, then the shallowest ones.
 * A client run on both networks leaves wallet.dat and wallet-testnet.dat side by side (same
 * dnet_key.dat and password): the mainnet wallet is preferred, the other one is reported.
 */
export function findLegacyWalletFiles<T extends FolderFile>(
  files: T[],
): { walletDat: T | null; otherWalletDat: T | null; dnetKeyDat: T | null; storage: Array<T & StorageFileRef> } {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const storage: Array<T & StorageFileRef> = [];
  const roots = new Set<string>();
  for (const f of files) {
    const ref = parseStoragePath(norm(f.path));
    if (!ref) continue;
    storage.push({ ...f, ...ref });
    const p = norm(f.path);
    const i = p.search(/(?:^|\/)storage(?:-testnet)?\//i);
    roots.add(i <= 0 ? '' : p.slice(0, i));
  }
  storage.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const nameOf = (f: T) => norm(f.path).split('/').pop() ?? '';
  const dirOf = (f: T) => norm(f.path).split('/').slice(0, -1).join('/');
  const depth = (f: T) => norm(f.path).split('/').length;
  const ranked = (re: RegExp): T[] =>
    files
      .filter((f) => re.test(nameOf(f)))
      .sort(
        (a, b) =>
          Number(roots.has(dirOf(b))) - Number(roots.has(dirOf(a))) ||
          depth(a) - depth(b) ||
          Number(/-testnet/i.test(nameOf(a))) - Number(/-testnet/i.test(nameOf(b))),
      );
  const wallets = ranked(/^wallet(-testnet)?\.dat$/i);
  const walletDat = wallets[0] ?? null;
  const otherWalletDat = walletDat ? (wallets.find((w) => dirOf(w) === dirOf(walletDat) && nameOf(w).toLowerCase() !== nameOf(walletDat).toLowerCase()) ?? null) : null;
  return { walletDat, otherWalletDat, dnetKeyDat: ranked(/^dnet_key\.dat$/i)[0] ?? null, storage };
}
