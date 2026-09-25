/**
 * xdagj wallet file (wallet/wallet.data, format version 4), see io.xdag.Wallet:
 *
 *   int    version (=4)                      big-endian
 *   bytes  salt (16)                         VLQ length prefix
 *   int    account count
 *   { bytes iv(16), bytes AES(privkey) }*    VLQ length prefixes
 *   bytes  iv(16), bytes AES(hdSeed)         hdSeed = string mnemonic, int nextAccountIndex
 *
 * key = BCrypt.generate(utf8(password), salt, 12) (24 bytes -> AES-192), AES/CBC/PKCS7.
 */
import { cbc } from '@noble/ciphers/aes.js';
import { bcryptRaw, BCRYPT_MAX_PASSWORD_BYTES } from './bcrypt';
import { concatBytes, randomBytes, utf8Decode, utf8ToBytes, wipe } from './bytes';
import { isValidPrivateKey } from './keys';

export const XDAGJ_WALLET_VERSION = 4;
export const XDAGJ_BCRYPT_COST = 12;

export class WrongPasswordError extends Error {
  constructor(message = 'Wrong password') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

class Decoder {
  private i = 0;
  constructor(private readonly b: Uint8Array) {}

  private need(n: number) {
    if (n < 0 || this.i + n > this.b.length) throw new InvalidFileError('Truncated wallet file');
  }

  int(): number {
    this.need(4);
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.i, 4).getInt32(0, false);
    this.i += 4;
    return v;
  }

  size(): number {
    let size = 0;
    for (let k = 0; k < 4; k++) {
      this.need(1);
      const byte = this.b[this.i++]!;
      size = (size << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return size;
  }

  bytes(): Uint8Array {
    const len = this.size();
    this.need(len);
    const out = this.b.slice(this.i, this.i + len);
    this.i += len;
    return out;
  }

  string(): string {
    return utf8Decode(this.bytes());
  }
}

class Encoder {
  private parts: Uint8Array[] = [];

  int(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setInt32(0, v, false);
    this.parts.push(b);
  }

  size(n: number) {
    if (n < 0 || n > 0x0fffffff) throw new Error('size out of range');
    const buf: number[] = [];
    do {
      buf.unshift(n & 0x7f);
      n >>>= 7;
    } while (n > 0);
    for (let k = 0; k < buf.length - 1; k++) buf[k]! |= 0x80;
    this.parts.push(Uint8Array.from(buf));
  }

  bytes(b: Uint8Array) {
    this.size(b.length);
    this.parts.push(b);
  }

  string(s: string) {
    this.bytes(utf8ToBytes(s));
  }

  toBytes(): Uint8Array {
    return concatBytes(...this.parts);
  }
}

function aesDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  if (iv.length !== 16 || data.length === 0 || data.length % 16) throw new WrongPasswordError();
  try {
    return cbc(key, iv).decrypt(data);
  } catch {
    // bad PKCS#7 padding: BouncyCastle's InvalidCipherTextException in xdagj
    throw new WrongPasswordError();
  }
}

export function aesCbcEncrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  return cbc(key, iv).encrypt(data);
}

export interface XdagjWalletContents {
  version: number;
  privateKeys: Uint8Array[];
  mnemonic: string;
  nextAccountIndex: number;
}

export function looksLikeXdagjWallet(file: Uint8Array): boolean {
  return file.length >= 4 + 17 + 4 && file[0] === 0 && file[1] === 0 && file[2] === 0 && file[3] === XDAGJ_WALLET_VERSION;
}

function passwordBytes(password: string): Uint8Array {
  const pw = utf8ToBytes(password);
  if (pw.length > BCRYPT_MAX_PASSWORD_BYTES) throw new WrongPasswordError('Password longer than 72 bytes cannot open an xdagj wallet');
  return pw;
}

/** Decrypts an xdagj wallet.data. Throws WrongPasswordError / InvalidFileError. */
export function decryptXdagjWallet(file: Uint8Array, password: string): XdagjWalletContents {
  const dec = new Decoder(file);
  const version = dec.int();
  if (version !== XDAGJ_WALLET_VERSION) throw new InvalidFileError(`Unsupported xdagj wallet version ${version}`);
  const salt = dec.bytes();
  if (salt.length !== 16) throw new InvalidFileError('Invalid salt');
  const key = bcryptRaw(passwordBytes(password), salt, XDAGJ_BCRYPT_COST);
  try {
    const total = dec.int();
    if (total < 0 || total > 100_000) throw new InvalidFileError('Invalid account count');
    const privateKeys: Uint8Array[] = [];
    for (let n = 0; n < total; n++) {
      const iv = dec.bytes();
      const plain = aesDecrypt(dec.bytes(), key, iv);
      // Numeric.toBigInt(): unsigned big-endian integer of any length
      let start = 0;
      while (start < plain.length - 32 && plain[start] === 0) start++;
      if (plain.length - start > 32) throw new WrongPasswordError();
      const priv = new Uint8Array(32);
      priv.set(plain.subarray(start), 32 - (plain.length - start));
      wipe(plain);
      if (!isValidPrivateKey(priv)) throw new WrongPasswordError();
      privateKeys.push(priv);
    }
    const iv = dec.bytes();
    const seedRaw = aesDecrypt(dec.bytes(), key, iv);
    let mnemonic = '';
    let nextAccountIndex = 0;
    try {
      const sd = new Decoder(seedRaw);
      mnemonic = sd.string();
      nextAccountIndex = sd.int();
    } catch {
      throw new WrongPasswordError();
    } finally {
      wipe(seedRaw);
    }
    return { version, privateKeys, mnemonic, nextAccountIndex };
  } finally {
    wipe(key);
  }
}

/** Serialises an xdagj-compatible wallet.data (fresh random salt and IVs). */
export function encryptXdagjWallet(contents: Omit<XdagjWalletContents, 'version'>, password: string): Uint8Array {
  const enc = new Encoder();
  enc.int(XDAGJ_WALLET_VERSION);
  const salt = randomBytes(16);
  enc.bytes(salt);
  const key = bcryptRaw(passwordBytes(password), salt, XDAGJ_BCRYPT_COST);
  try {
    enc.int(contents.privateKeys.length);
    for (const priv of contents.privateKeys) {
      const iv = randomBytes(16);
      enc.bytes(iv);
      enc.bytes(aesCbcEncrypt(priv, key, iv));
    }
    const seed = new Encoder();
    seed.string(contents.mnemonic);
    seed.int(contents.nextAccountIndex);
    const iv = randomBytes(16);
    enc.bytes(iv);
    enc.bytes(aesCbcEncrypt(seed.toBytes(), key, iv));
    return enc.toBytes();
  } finally {
    wipe(key);
  }
}
