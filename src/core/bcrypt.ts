/**
 * Raw bcrypt key derivation, compatible with BouncyCastle
 * org.bouncycastle.crypto.generators.BCrypt.generate(password, salt, cost), which xdagj's
 * Wallet uses to derive the AES key of wallet.data. Unlike the OpenBSD string format this
 * returns all 24 output bytes and does not append a NUL terminator to the password.
 */
import { BLOWFISH_P, BLOWFISH_S } from './blowfish-tables';

// "OrpheanBeholderScryDoubt" as big-endian words
const MAGIC = Uint32Array.of(0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274);

export const BCRYPT_MAX_PASSWORD_BYTES = 72;

class Eks {
  readonly P = Uint32Array.from(BLOWFISH_P);
  readonly S = Uint32Array.from(BLOWFISH_S);
  private readonly lr = new Uint32Array(2);

  private encipher(lr: Uint32Array): void {
    const P = this.P, S = this.S;
    let l = lr[0]!, r = lr[1]!;
    l ^= P[0]!;
    for (let i = 1; i <= 16; i += 2) {
      r ^= (((S[l >>> 24]! + S[0x100 | ((l >>> 16) & 0xff)]!) ^ S[0x200 | ((l >>> 8) & 0xff)]!) + S[0x300 | (l & 0xff)]!) ^ P[i]!;
      l ^= (((S[r >>> 24]! + S[0x100 | ((r >>> 16) & 0xff)]!) ^ S[0x200 | ((r >>> 8) & 0xff)]!) + S[0x300 | (r & 0xff)]!) ^ P[i + 1]!;
    }
    lr[0] = r ^ P[17]!;
    lr[1] = l;
  }

  /** Blowfish ExpandKey(state, salt, key); pass salt = null for the salt-less variant. */
  expand(key: Uint32Array, salt: Uint32Array | null): void {
    const P = this.P, S = this.S, lr = this.lr;
    for (let i = 0; i < 18; i++) P[i] = P[i]! ^ key[i]!;
    lr[0] = 0;
    lr[1] = 0;
    let si = 0;
    for (let i = 0; i < 18; i += 2) {
      if (salt) {
        lr[0] = lr[0]! ^ salt[si]!;
        lr[1] = lr[1]! ^ salt[si + 1]!;
        si = (si + 2) & 3;
      }
      this.encipher(lr);
      P[i] = lr[0]!;
      P[i + 1] = lr[1]!;
    }
    for (let i = 0; i < 1024; i += 2) {
      if (salt) {
        lr[0] = lr[0]! ^ salt[si]!;
        lr[1] = lr[1]! ^ salt[si + 1]!;
        si = (si + 2) & 3;
      }
      this.encipher(lr);
      S[i] = lr[0]!;
      S[i + 1] = lr[1]!;
    }
  }

  encryptMagic(): Uint8Array {
    const ctext = Uint32Array.from(MAGIC);
    const lr = new Uint32Array(2);
    for (let round = 0; round < 64; round++) {
      for (let j = 0; j < 6; j += 2) {
        lr[0] = ctext[j]!;
        lr[1] = ctext[j + 1]!;
        this.encipher(lr);
        ctext[j] = lr[0]!;
        ctext[j + 1] = lr[1]!;
      }
    }
    const out = new Uint8Array(24);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < 6; i++) dv.setUint32(i * 4, ctext[i]!, false);
    return out;
  }
}

/** Repeats the key bytes cyclically into 18 big-endian words (Blowfish key schedule). */
function cyclicWords(bytes: Uint8Array): Uint32Array {
  const out = new Uint32Array(18);
  let k = 0;
  for (let i = 0; i < 18; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) {
      w = (w << 8) | bytes[k]!;
      k = (k + 1) % bytes.length;
    }
    out[i] = w >>> 0;
  }
  return out;
}

export function bcryptRaw(password: Uint8Array, salt: Uint8Array, cost: number): Uint8Array {
  if (salt.length !== 16) throw new Error('BCrypt salt must be 128 bits');
  if (password.length > BCRYPT_MAX_PASSWORD_BYTES) throw new Error('BCrypt password must be <= 72 bytes');
  if (!Number.isInteger(cost) || cost < 4 || cost > 31) throw new Error('BCrypt cost must be from 4..31');
  // BouncyCastle substitutes an empty password with four zero bytes.
  const psw = password.length === 0 ? new Uint8Array(4) : password;
  const key = cyclicWords(psw);
  const saltWords = new Uint32Array(4);
  const sv = new DataView(salt.buffer, salt.byteOffset, 16);
  for (let i = 0; i < 4; i++) saltWords[i] = sv.getUint32(i * 4, false);
  const saltKey = cyclicWords(salt);

  const eks = new Eks();
  eks.expand(key, saltWords);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    eks.expand(key, null);
    eks.expand(saltKey, null);
  }
  const out = eks.encryptMagic();
  key.fill(0);
  return out;
}
