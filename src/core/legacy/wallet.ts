/**
 * 2018 XDAG C-client wallet files:
 *
 *  - wallet.dat (wallet-testnet.dat): N x 32-byte secp256k1 private keys (big-endian, as written
 *    by OpenSSL BN_bn2bin), key n encrypted with dfslib_encrypt_array(crypt, key, 8 words, n).
 *    See client/wallet.c add_key() / xdag_wallet_init().
 *  - dnet_key.dat: 2 x 1024-byte dfsrsa keys (private, public) of the node, each 512-byte
 *    sector i encrypted with dfslib_encrypt_sector(crypt, sector, ~i). See dnet/dnet_crypt.c.
 *
 * Both use the same password-derived cipher. dnet_key.dat lets us verify the password: the
 * private and public RSA keys share their modulus (dfsrsa_keygen), so after a correct
 * decryption the upper halves of both keys are identical.
 */
import { DfsCrypt, makeUserCrypt } from './dfslib';
import { utf8ToBytes } from '../bytes';
import { isValidPrivateKey } from '../keys';
import { InvalidFileError, WrongPasswordError } from '../xdagj-wallet';

export const DNET_KEY_FILE_SIZE = 2048;
const DNET_KEYLEN = 256; // words per dfsrsa key (4096 * 2 / 32)

export interface LegacyWalletResult {
  privateKeys: Uint8Array[];
  /** false when the files were stored without encryption (empty password). */
  encrypted: boolean;
  /** true when dnet_key.dat confirmed the password (or confirmed plaintext storage). */
  passwordVerified: boolean;
}

function words(bytes: Uint8Array): Uint32Array {
  const copy = Uint8Array.from(bytes);
  return new Uint32Array(copy.buffer);
}

/** dnet_detect_keylen(): keys shorter than DNET_KEYLEN are stored repeated. */
function detectKeylen(key: Uint32Array, off: number, keylen: number): number {
  while (keylen >= 8) {
    const half = keylen / 2;
    let same = true;
    for (let i = 0; i < half; i++) {
      if (key[off + i] !== key[off + half + i]) {
        same = false;
        break;
      }
    }
    if (!same) break;
    keylen = half;
  }
  return keylen;
}

/** True when a (decrypted) dnet_key.dat holds a consistent dfsrsa key pair. */
export function dnetKeysLookValid(keys: Uint32Array): boolean {
  const privOff = 0, pubOff = DNET_KEYLEN;
  const keylen = detectKeylen(keys, pubOff, DNET_KEYLEN);
  if (keylen < 8) return false;
  const half = keylen / 2;
  let nonZero = false;
  for (let i = half; i < keylen; i++) {
    if (keys[privOff + i] !== keys[pubOff + i]) return false;
    if (keys[pubOff + i] !== 0) nonZero = true;
  }
  if (!nonZero) return false;
  // the private key must repeat with the same period as the public key
  for (let i = keylen; i < DNET_KEYLEN; i++) if (keys[privOff + i] !== keys[privOff + (i % keylen)]) return false;
  return true;
}

function splitKeys(walletDat: Uint8Array): Uint32Array {
  if (walletDat.length === 0 || walletDat.length % 32) throw new InvalidFileError('wallet.dat must contain whole 32-byte keys');
  if (walletDat.length > 32 * 65536) throw new InvalidFileError('wallet.dat is too large');
  return words(walletDat);
}

function collectKeys(data: Uint32Array): Uint8Array[] {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out: Uint8Array[] = [];
  for (let n = 0; n * 32 < bytes.length; n++) out.push(bytes.slice(n * 32, n * 32 + 32));
  return out;
}

export function looksLikeDnetKey(file: Uint8Array): boolean {
  return file.length === DNET_KEY_FILE_SIZE;
}

/**
 * Decrypts a legacy wallet. `dnetKeyDat` is optional but strongly recommended: without it a
 * wrong password cannot be detected (every 32-byte string is almost surely a valid key).
 */
export function decryptLegacyWallet(
  walletDat: Uint8Array,
  dnetKeyDat: Uint8Array | null,
  password: string,
  onProgress?: (fraction: number) => void,
): LegacyWalletResult {
  const data = splitKeys(walletDat);
  let crypt: DfsCrypt | null = null;
  let passwordVerified = false;
  let encrypted: boolean;

  if (dnetKeyDat) {
    if (dnetKeyDat.length !== DNET_KEY_FILE_SIZE) throw new InvalidFileError('dnet_key.dat must be 2048 bytes');
    const keys = words(dnetKeyDat);
    if (dnetKeysLookValid(keys)) {
      encrypted = false; // the node keys were stored in clear, so was wallet.dat
    } else {
      crypt = makeUserCrypt(utf8ToBytes(password), onProgress);
      if (!crypt.ispwd) throw new WrongPasswordError();
      for (let i = 0; i < DNET_KEY_FILE_SIZE / 512; i++) crypt.decryptSector(keys, i * 128, ~BigInt(i) & 0xffffffffffffffffn);
      if (!dnetKeysLookValid(keys)) throw new WrongPasswordError();
      encrypted = true;
    }
    keys.fill(0);
    passwordVerified = true;
  } else {
    crypt = makeUserCrypt(utf8ToBytes(password), onProgress);
    encrypted = crypt.ispwd === 1;
  }

  if (encrypted && crypt) {
    for (let n = 0; n * 8 < data.length; n++) crypt.decryptArray(data, n * 8, 8, BigInt(n));
  }
  crypt?.regs.fill(0);
  crypt?.pwd.fill(0);

  const privateKeys = collectKeys(data);
  data.fill(0);
  if (!privateKeys.every(isValidPrivateKey)) {
    if (passwordVerified) throw new InvalidFileError('wallet.dat does not belong to this dnet_key.dat');
    throw new WrongPasswordError();
  }
  return { privateKeys, encrypted, passwordVerified };
}

/** Test helper / exporter: produces a wallet.dat for the given keys (same cipher as the C client). */
export function encryptLegacyWalletKeys(privateKeys: Uint8Array[], password: string): Uint8Array {
  const crypt = makeUserCrypt(utf8ToBytes(password));
  const out = new Uint8Array(privateKeys.length * 32);
  privateKeys.forEach((k, n) => out.set(k, n * 32));
  const data = new Uint32Array(out.buffer);
  if (crypt.ispwd) for (let n = 0; n < privateKeys.length; n++) crypt.encryptArray(data, n * 8, 8, BigInt(n));
  return out;
}
