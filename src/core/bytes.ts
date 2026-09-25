import { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, concatBytes, hexToBytes, randomBytes, utf8ToBytes };

const HEX_RE = /^(0x)?[0-9a-fA-F]*$/;

/** Parses a hex string (optional 0x prefix, even length). Throws on malformed input. */
export function fromHex(hex: string): Uint8Array {
  const s = hex.trim();
  if (!HEX_RE.test(s)) throw new Error('Invalid hex string');
  const body = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  if (body.length % 2) throw new Error('Invalid hex string length');
  return hexToBytes(body.toLowerCase());
}

export function toHex(bytes: Uint8Array): string {
  return bytesToHex(bytes);
}

export function reversed(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse();
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Overwrites a buffer with zeros (best effort secret hygiene). */
export function wipe(...buffers: (Uint8Array | undefined | null)[]): void {
  for (const b of buffers) if (b) b.fill(0);
}

export function u64le(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 64n) throw new RangeError('u64 out of range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function readU64le(bytes: Uint8Array, offset = 0): bigint {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** Strict UTF-8 decode; throws on invalid sequences. */
export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
