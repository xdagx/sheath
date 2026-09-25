/**
 * Faithful port of dfslib_crypt.c / dfslib_string.c from the original XDAG C client
 * (https://github.com/XDagger/xdag/tree/master/dfslib), used by the 2018 wallet to encrypt
 * dnet_key.dat and wallet.dat with the user's password.
 *
 * All arithmetic is unsigned 32-bit as in C; `>>> 0` normalises JS int32 results.
 */

const DFS_MAGIC0 = 572035291;
const DFS_MAGIC1 = 2626708081;
const DFS_MAGIC2 = 2471573851;
const DFS_MAGIC3 = 3569250857;
const DFS_MAGIC4 = 1971772241n;
const DFS_MAGIC5 = 1615037507;
const DFS_MAGIC6 = 43385317;
const DFS_MAGIC78 = (3433359571n << 0n) | (1229426917n << 32n); // (MAGIC7 << 32) | MAGIC8
const U64 = (1n << 64n) - 1n;

export const DFSLIB_NAME_TOO_LONG = -12;
export const DFSLIB_INVALID_NAME = -11;

if (new Uint8Array(Uint32Array.of(1).buffer)[0] !== 1) {
  throw new Error('dfslib port requires a little-endian platform');
}

/** dfslib_utf8_to_unicode(): returns [codepoint | error, bytesConsumed]. */
function utf8ToUnicode(buf: Uint8Array, pos: number): [number, number] {
  let plen = buf.length - pos;
  let p = pos;
  if (!plen) return [DFSLIB_NAME_TOO_LONG, p];
  --plen;
  let c = buf[p++]!;
  if (c < 0x80) return [c, p];
  if (c < 0xc0) return [DFSLIB_INVALID_NAME, p];
  if (c < 0xe0) {
    if (!plen) return [DFSLIB_INVALID_NAME, p];
    c = (c & 0x1f) << 6;
    --plen;
    const d = buf[p++]!;
    if (d < 0x80 || d >= 0xc0) return [DFSLIB_INVALID_NAME, p];
    return [c | (d & 0x3f), p];
  }
  if (c < 0xf0) {
    if (plen < 2) return [DFSLIB_INVALID_NAME, p];
    c = (c & 0xf) << 12;
    --plen;
    let d = buf[p++]!;
    if (d < 0x80 || d >= 0xc0) return [DFSLIB_INVALID_NAME, p];
    c |= (d & 0x3f) << 6;
    --plen;
    d = buf[p++]!;
    if (d < 0x80 || d >= 0xc0) return [DFSLIB_INVALID_NAME, p];
    return [c | (d & 0x3f), p];
  }
  return [DFSLIB_INVALID_NAME, p];
}

/** Splits a 64-bit value into four 16-bit limbs (most significant first). */
function limbs(v: bigint): [number, number, number, number] {
  return [Number((v >> 48n) & 0xffffn), Number((v >> 32n) & 0xffffn), Number((v >> 16n) & 0xffffn), Number(v & 0xffffn)];
}

function modLimbs(l: [number, number, number, number], m: number): number {
  let r = l[0] % m;
  r = (r * 65536 + l[1]) % m;
  r = (r * 65536 + l[2]) % m;
  return (r * 65536 + l[3]) % m;
}

export class DfsCrypt {
  readonly regs = new Uint32Array(0x10000);
  readonly pwd = new Uint32Array(4);
  ispwd = 0;
  private readonly limbCache = new Map<bigint, [number, number, number, number]>();

  /** dfslib_crypt_set_password(); `password` is the raw UTF-8 byte string. */
  setPassword(password: Uint8Array | null): number {
    let ptr = 0;
    this.ispwd = 0;
    this.pwd[0] = DFS_MAGIC0;
    this.pwd[1] = DFS_MAGIC1;
    this.pwd[2] = DFS_MAGIC2;
    this.pwd[3] = DFS_MAGIC3;
    if (password) {
      let err: number;
      for (;;) {
        [err, ptr] = utf8ToUnicode(password, ptr);
        if (err < 0) break;
        let res = BigInt(err);
        for (let i = 0; i < 4; i++) {
          res += BigInt(this.pwd[i]!) * DFS_MAGIC4;
          this.pwd[i] = Number(res & 0xffffffffn);
          res >>= 32n;
        }
      }
      if (err !== DFSLIB_NAME_TOO_LONG) return err;
    }
    return (this.ispwd = ptr ? 1 : 0);
  }

  private f(X: number, Y: number, Z: number, T: number): number {
    const regs = this.regs;
    const w = (Z + regs[X >>> 16]!) >>> 0;
    const yh = Y >>> 16, yl = Y & 0xffff, wh = w >>> 16, wl = w & 0xffff;
    const hi = ((Math.imul(yh, wh) << 16) + yh * wl + yl * wh + ((yl * wl) >>> 16)) >>> 0;
    return (hi ^ regs[T & 0xffff]!) >>> 0;
  }

  /** dfs_prepare(): returns the x, y, z, t state for a sector number. */
  private prepare(sectorNo: bigint): [number, number, number, number] {
    let l = this.limbCache.get(sectorNo);
    if (!l) {
      l = limbs((sectorNo * DFS_MAGIC78) & U64);
      if (this.limbCache.size < 4096) this.limbCache.set(sectorNo, l);
    }
    const regs = this.regs, pwd = this.pwd;
    let x = (pwd[0]! ^ regs[modLimbs(l, 65479) + 31]!) >>> 0;
    let y = (pwd[1]! ^ regs[modLimbs(l, 65497) + 11]!) >>> 0;
    let z = (pwd[2]! ^ regs[modLimbs(l, 65519) + 5]!) >>> 0;
    let t = (pwd[3]! ^ regs[modLimbs(l, 65521) + 3]!) >>> 0;
    let a: number, b: number, c: number, d: number;
    for (let i = 0; i < 8; i++) {
      a = this.f(x, y, z, t); b = this.f(y, z, t, x); c = this.f(z, t, x, y); d = this.f(t, x, y, z);
      x = this.f(a, b, c, d); y = this.f(b, c, d, a); z = this.f(c, d, a, b); t = this.f(d, a, b, c);
    }
    return [x, y, z, t];
  }

  private static enmix(data: Uint32Array, off: number, size: number): void {
    let c = DFS_MAGIC5;
    for (let k = off + size - 1; k >= off; k--) {
      data[k] = data[k]! ^ Math.imul(c, DFS_MAGIC6);
      c = data[k]!;
    }
  }

  private static unmix(data: Uint32Array, off: number, size: number): void {
    let c = DFS_MAGIC5;
    for (let k = off + size - 1; k >= off; k--) {
      c = Math.imul(c, DFS_MAGIC6);
      data[k] = data[k]! ^ c;
      c = (c ^ data[k]!) >>> 0;
    }
  }

  /** Core of dfslib_encrypt_sector/array: `words` must be even. */
  private encryptWords(data: Uint32Array, off: number, words: number, sectorNo: bigint): void {
    let [x, y, z, t] = this.prepare(sectorNo);
    DfsCrypt.enmix(data, off, words);
    let a: number, b: number, c: number, d: number;
    for (let k = off, end = off + words; k < end; k += 2) {
      a = (this.f(x, y, z, t) ^ ~data[k]!) >>> 0;
      b = this.f(y, z, t, x);
      c = this.f(z, t, x, y);
      d = this.f(t, x, y, z);
      data[k] = data[k]! - d;
      x = (this.f(a, b, c, d) ^ ~data[k + 1]!) >>> 0;
      y = this.f(b, c, d, a);
      z = this.f(c, d, a, b);
      t = this.f(d, a, b, c);
      data[k + 1] = data[k + 1]! - t;
    }
  }

  private decryptWords(data: Uint32Array, off: number, words: number, sectorNo: bigint): void {
    let [x, y, z, t] = this.prepare(sectorNo);
    let a = 0, b = 0, c: number, d: number;
    for (let k = off, end = off + words; k < end; k += 2) {
      c = this.f(z, t, x, y);
      d = this.f(t, x, y, z);
      data[k] = data[k]! + d;
      a = (this.f(x, y, z, t) ^ ~data[k]!) >>> 0;
      b = this.f(y, z, t, x);
      z = this.f(c, d, a, b);
      t = this.f(d, a, b, c);
      data[k + 1] = data[k + 1]! + t;
      x = (this.f(a, b, c, d) ^ ~data[k + 1]!) >>> 0;
      y = this.f(b, c, d, a);
    }
    DfsCrypt.unmix(data, off, words);
  }

  encryptSector(data: Uint32Array, off: number, sectorNo: bigint): boolean {
    if (!this.ispwd) return false;
    this.encryptWords(data, off, 128, sectorNo);
    return true;
  }

  decryptSector(data: Uint32Array, off: number, sectorNo: bigint): boolean {
    if (!this.ispwd) return false;
    this.decryptWords(data, off, 128, sectorNo);
    return true;
  }

  encryptArray(data: Uint32Array, off: number, size: number, sectorNo: bigint): boolean {
    if (!this.ispwd || size & 1) return false;
    this.encryptWords(data, off, size, sectorNo);
    return true;
  }

  decryptArray(data: Uint32Array, off: number, size: number, sectorNo: bigint): boolean {
    if (!this.ispwd || size & 1) return false;
    this.decryptWords(data, off, size, sectorNo);
    return true;
  }

  /** dfslib_crypt_set_sector0(): 512 rotated copies of the sector, each encrypted in place. */
  setSector0(sector: Uint8Array): boolean {
    if (!this.ispwd) return false;
    if (sector.length !== 512) throw new Error('sector must be 512 bytes');
    const bytes = new Uint8Array(this.regs.buffer);
    for (let i = 0; i < 512; i++) {
      bytes.set(sector.subarray(i, 512), i << 9);
      bytes.set(sector.subarray(0, i), ((i + 1) << 9) - i);
    }
    for (let i = 0; i < 512; i++) this.encryptSector(this.regs, i << 7, BigInt(i));
    return true;
  }
}

/**
 * set_user_crypt() from dnet/dnet_crypt.c: derives the wallet cipher from a password.
 * Note: C skips this entirely for an empty password, and dfslib leaves `ispwd == 0` for
 * passwords containing characters outside the BMP (4-byte UTF-8); both mean "no encryption".
 */
export function makeUserCrypt(password: Uint8Array, onProgress?: (fraction: number) => void): DfsCrypt {
  const crypt = new DfsCrypt();
  if (password.length === 0) return crypt;
  crypt.setPassword(password);
  if (!crypt.ispwd) return crypt;
  const sector0 = new Uint32Array(128);
  for (let i = 0; i < 128; i++) sector0[i] = (0x4ab29f51 + Math.imul(i, 0xc3807e6d)) >>> 0;
  const sectorBytes = new Uint8Array(sector0.buffer);
  for (let i = 0; i < 128; i++) {
    crypt.setSector0(sectorBytes);
    crypt.encryptSector(sector0, 0, (0x3e9c1d624a8b570fn + BigInt(i) * 0x9d2e61fc538704abn) & U64);
    onProgress?.((i + 1) / 128);
  }
  return crypt;
}
