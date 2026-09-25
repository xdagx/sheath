import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

export { sha256 };

export function sha256d(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

/** RIPEMD160(SHA256(data)) — the 20-byte account id used by xdagj addresses. */
export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}
