/**
 * secp256k1 keys, BIP39 mnemonics and the XDAG BIP44 path m/44'/586'/0'/0/i
 * (xdagj-crypto Bip44Wallet.deriveXdagKey, XDAG Pro Helper.getWalletByMnemonic).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, generateMnemonic as genMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { fromHex, toHex } from './bytes';
import { publicKeyToAddress } from './address';

export const XDAG_COIN_TYPE = 586;
export const hdPath = (index: number, account = 0) => `m/44'/${XDAG_COIN_TYPE}'/${account}'/0/${index}`;

export { wordlist };

export function normalizeMnemonic(m: string): string {
  return m.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
}

/** 12 words (128-bit) by default: the only length xdagj accepts. */
export function generateMnemonic(words: 12 | 24 = 12): string {
  return genMnemonic(wordlist, words === 24 ? 256 : 128);
}

export function mnemonicFromEntropy(entropy: Uint8Array): string {
  return entropyToMnemonic(entropy, wordlist);
}

export type MnemonicCheck = 'ok' | 'empty' | 'length' | 'word' | 'checksum';

export function checkMnemonic(m: string): { status: MnemonicCheck; badWord?: string } {
  const norm = normalizeMnemonic(m);
  if (!norm) return { status: 'empty' };
  const words = norm.split(' ');
  const bad = words.find((w) => !wordlist.includes(w));
  if (bad) return { status: 'word', badWord: bad };
  if (![12, 15, 18, 21, 24].includes(words.length)) return { status: 'length' };
  if (!validateMnemonic(norm, wordlist)) return { status: 'checksum' };
  return { status: 'ok' };
}

export function mnemonicToSeed(m: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(m), passphrase);
}

export function isValidPrivateKey(priv: Uint8Array): boolean {
  return priv.length === 32 && secp256k1.utils.isValidSecretKey(priv);
}

export function parsePrivateKey(input: string): Uint8Array {
  const priv = fromHex(input);
  if (!isValidPrivateKey(priv)) throw new Error('Invalid private key');
  return priv;
}

export function getPublicKey(priv: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(priv, true);
}

export function privateKeyToAddress(priv: Uint8Array): string {
  return publicKeyToAddress(getPublicKey(priv));
}

export function deriveHdKey(seed: Uint8Array, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new RangeError('Invalid index');
  const node = HDKey.fromMasterSeed(seed).derive(hdPath(index));
  if (!node.privateKey) throw new Error('Derivation failed');
  return Uint8Array.from(node.privateKey);
}

/** Deterministic RFC6979 ECDSA over a 32-byte digest, low-S, returns r||s. */
export function signDigest(digest: Uint8Array, priv: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new Error('Digest must be 32 bytes');
  return secp256k1.sign(digest, priv, { prehash: false, lowS: true, format: 'compact' });
}

export function verifyDigest(sig: Uint8Array, digest: Uint8Array, pub: Uint8Array): boolean {
  return secp256k1.verify(sig, digest, pub, { prehash: false, lowS: true, format: 'compact' });
}

export const keyToHex = toHex;
