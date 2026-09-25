/**
 * At-rest encryption of the extension's key vault: PBKDF2-HMAC-SHA256 (600k iterations)
 * -> AES-256-GCM, via WebCrypto. The derived key (never the password) may be cached in
 * chrome.storage.session while the wallet is unlocked.
 */
import { fromBase64, randomBytes, toBase64 } from './bytes';

export const VAULT_KDF_ITERATIONS = 600_000;

export interface EncryptedVault {
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: 'AES-GCM';
  iv: string;
  data: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export async function deriveVaultKey(password: string, salt: Uint8Array, iterations = VAULT_KDF_ITERATIONS): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', buf(enc.encode(password.normalize('NFKC'))), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, 256);
  return new Uint8Array(bits);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealVault(plain: unknown, key: Uint8Array, salt: Uint8Array, iterations = VAULT_KDF_ITERATIONS): Promise<EncryptedVault> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, await aesKey(key), buf(enc.encode(JSON.stringify(plain))));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: 'AES-GCM',
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ct)),
  };
}

export class VaultDecryptError extends Error {
  constructor() {
    super('Incorrect password');
    this.name = 'VaultDecryptError';
  }
}

export async function openVault<T>(vault: EncryptedVault, key: Uint8Array): Promise<T> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(fromBase64(vault.iv)) }, await aesKey(key), buf(fromBase64(vault.data)));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new VaultDecryptError();
  }
}

export async function keyFromPassword(vault: EncryptedVault, password: string): Promise<Uint8Array> {
  return deriveVaultKey(password, fromBase64(vault.kdf.salt), vault.kdf.iterations);
}
