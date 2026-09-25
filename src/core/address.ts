/**
 * XDAG address formats.
 *
 * - Account address (xdagj / XDAG Pro, "new" format): Base58Check(hash160(compressedPubKey)),
 *   no version byte, 4-byte double-SHA256 checksum. See xdagj-crypto AddressUtils/Base58.
 * - Block address (2018 C client, "old" format): standard Base64 of the 24 significant bytes
 *   of a block hash (32 characters). See xdag client/address.c and xdagj BasicUtils.hash2Address.
 */
import { base64, createBase58check } from '@scure/base';
import { sha256, hash160, sha256d } from './hash';
import { equalBytes } from './bytes';

const b58check = createBase58check(sha256);

export const ADDRESS_BYTES = 20;

export function publicKeyToAddressBytes(compressedPubKey: Uint8Array): Uint8Array {
  if (compressedPubKey.length !== 33) throw new Error('Expected a compressed public key');
  return hash160(compressedPubKey);
}

export function encodeAddress(addr20: Uint8Array): string {
  if (addr20.length !== ADDRESS_BYTES) throw new Error('Invalid address length');
  return b58check.encode(addr20);
}

export function publicKeyToAddress(compressedPubKey: Uint8Array): string {
  return encodeAddress(publicKeyToAddressBytes(compressedPubKey));
}

/** Decodes an account address to its 20-byte id. Throws on bad checksum / length. */
export function decodeAddress(address: string): Uint8Array {
  const s = address.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(s)) throw new Error('Invalid address characters');
  const bytes = b58check.decode(s);
  if (bytes.length !== ADDRESS_BYTES) throw new Error('Invalid address length');
  return bytes;
}

export function isValidAddress(address: string): boolean {
  try {
    decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}

const LEGACY_RE = /^[A-Za-z0-9+/]{32}$/;

/**
 * True for a 32-character 2018-style block address. Base58 characters are a subset of the
 * Base64 alphabet and account addresses can also be 32 characters long, so — exactly like
 * xdagj's RPC (WalletUtils.checkAddress first) — a valid Base58Check address takes precedence.
 */
export function isLegacyAddress(address: string): boolean {
  const s = address.trim();
  return LEGACY_RE.test(s) && !isValidAddress(s);
}

/** Returns the 24 bytes stored in a block link field for an old block address. */
export function decodeLegacyAddress(address: string): Uint8Array {
  const s = address.trim();
  if (!isLegacyAddress(s)) throw new Error('Invalid block address');
  const bytes = base64.decode(s);
  if (bytes.length !== 24) throw new Error('Invalid block address length');
  return bytes;
}

export function encodeLegacyAddress(bytes24: Uint8Array): string {
  if (bytes24.length !== 24) throw new Error('Invalid block address length');
  return base64.encode(bytes24);
}

/** Address (as returned by xdag_sendRawTransaction) of a raw 512-byte block. */
export function blockAddressOfRaw(raw: Uint8Array): string {
  return encodeLegacyAddress(sha256d(raw).subarray(0, 24));
}

/** Block hash in xdagj's display order (reverse of the SHA256d digest). */
export function blockHashOfRaw(raw: Uint8Array): Uint8Array {
  return Uint8Array.from(sha256d(raw)).reverse();
}

export function sameAddress(a: string, b: string): boolean {
  try {
    return equalBytes(decodeAddress(a), decodeAddress(b));
  } catch {
    return false;
  }
}

export function shortAddress(address: string, head = 6, tail = 6): string {
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
