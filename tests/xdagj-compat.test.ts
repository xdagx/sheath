/**
 * Cross-checks against vectors produced by the official xdagj code base
 * (tools/vectors/xdagj/VectorGen.java -> tests/fixtures/xdagj-vectors.json).
 */
import vectors from './fixtures/xdagj-vectors.json';
import { fromBase64, fromHex, toHex } from '@/core/bytes';
import { deriveHdKey, getPublicKey, mnemonicToSeed, privateKeyToAddress, signDigest, verifyDigest } from '@/core/keys';
import { decodeAddress, encodeAddress, isValidAddress, publicKeyToAddress } from '@/core/address';
import { bcryptRaw } from '@/core/bcrypt';
import { aesCbcEncrypt, decryptXdagjWallet, encryptXdagjWallet, WrongPasswordError } from '@/core/xdagj-wallet';
import { buildAccountTransfer, buildLegacyTransfer, msToXdagTime } from '@/core/tx';
import { formatXdag, nanoToCheato, parseXdag } from '@/core/amount';

describe('BIP39 / BIP44 (m/44\'/586\'/0\'/0/i)', () => {
  for (const hd of vectors.hd) {
    it(`derives accounts for "${hd.mnemonic.slice(0, 20)}…"`, () => {
      const seed = mnemonicToSeed(hd.mnemonic);
      expect(toHex(seed)).toBe(hd.seed);
      for (const acct of hd.accounts) {
        const priv = deriveHdKey(seed, acct.index);
        expect(toHex(priv)).toBe(acct.privateKey);
        expect(toHex(getPublicKey(priv))).toBe(acct.publicKey);
        expect(privateKeyToAddress(priv)).toBe(acct.address);
      }
    });
  }
});

describe('addresses', () => {
  it('round-trips Base58Check account addresses', () => {
    for (const s of vectors.signatures) {
      expect(publicKeyToAddress(fromHex(s.publicKey))).toBe(s.address);
      expect(encodeAddress(decodeAddress(s.address))).toBe(s.address);
      expect(isValidAddress(s.address)).toBe(true);
      const broken = s.address.slice(0, -1) + (s.address.endsWith('a') ? 'b' : 'a');
      expect(isValidAddress(broken)).toBe(false);
    }
  });
});

describe('ECDSA (RFC6979, low-S) matches xdagj Signer', () => {
  for (const v of vectors.signatures) {
    it(`signs ${v.hash.slice(0, 12)}`, () => {
      const sig = signDigest(fromHex(v.hash), fromHex(v.privateKey));
      expect(toHex(sig.subarray(0, 32))).toBe(v.r);
      expect(toHex(sig.subarray(32))).toBe(v.s);
      expect(verifyDigest(sig, fromHex(v.hash), fromHex(v.publicKey))).toBe(true);
    });
  }
});

describe('BouncyCastle raw BCrypt', () => {
  for (const v of vectors.bcrypt) {
    it(`cost ${v.cost} password ${JSON.stringify(v.password).slice(0, 24)}`, () => {
      const key = bcryptRaw(new TextEncoder().encode(v.password), fromHex(v.salt), v.cost);
      expect(toHex(key)).toBe(v.key);
    });
  }
});

describe('AES-192-CBC-PKCS7', () => {
  for (const v of vectors.aes) {
    it(`encrypts ${v.plain.length / 2} bytes`, () => {
      expect(toHex(aesCbcEncrypt(fromHex(v.plain), fromHex(v.key), fromHex(v.iv)))).toBe(v.cipher);
    });
  }
});

describe('xdagj wallet.data (v4)', () => {
  for (const w of vectors.walletFiles) {
    it(`opens a file written by xdagj (password ${JSON.stringify(w.password)})`, () => {
      const file = fromBase64(w.file);
      const res = decryptXdagjWallet(file, w.password);
      expect(res.mnemonic).toBe(w.mnemonic);
      expect(res.nextAccountIndex).toBe(w.nextAccountIndex);
      expect(res.privateKeys.map(toHex).sort()).toEqual(w.accounts.map((a) => a.privateKey).sort());
      expect(() => decryptXdagjWallet(file, w.password + 'x')).toThrow(WrongPasswordError);
    });
  }

  it('writes files that decrypt back', () => {
    const w = vectors.walletFiles[0]!;
    const keys = w.accounts.map((a) => fromHex(a.privateKey));
    const file = encryptXdagjWallet({ privateKeys: keys, mnemonic: w.mnemonic, nextAccountIndex: 2 }, 'new-pass');
    const res = decryptXdagjWallet(file, 'new-pass');
    expect(res.privateKeys.map(toHex)).toEqual(keys.map(toHex));
    expect(res.mnemonic).toBe(w.mnemonic);
    expect(res.nextAccountIndex).toBe(2);
  });
});

describe('amount conversion (XAmount.toXAmount)', () => {
  for (const a of vectors.amounts) {
    it(a.xdag, () => {
      const nano = parseXdag(a.xdag);
      expect(nano.toString()).toBe(a.nano);
      expect(nanoToCheato(nano).toString()).toBe(a.cheato);
      expect(formatXdag(nano, { minDecimals: 9 })).toBe(parseFloat(a.xdag) === 0 ? '0.000000000' : a.xdag.includes('.') ? a.xdag.padEnd(a.xdag.indexOf('.') + 10, '0') : `${a.xdag}.000000000`);
    });
  }
});

describe('transaction blocks are byte-identical to xdagj Block', () => {
  for (const t of vectors.transactions) {
    it(`${t.kind} ${t.network} ${t.amount} XDAG remark=${t.remark ?? '-'}`, () => {
      expect(msToXdagTime(t.timeMs).toString()).toBe(t.xdagTime);
      const common = {
        network: t.network as 'mainnet' | 'testnet',
        privateKey: fromHex(t.privateKey),
        to: t.to,
        amountNano: parseXdag(t.amount),
        remark: t.remark,
        timestampMs: t.timeMs,
      };
      const block =
        t.kind === 'account'
          ? buildAccountTransfer({ ...common, feeNano: BigInt(t.feeNano), nonce: BigInt(t.nonce!) })
          : buildLegacyTransfer({ ...common, fromBlock: t.from });
      if (t.kind === 'account') expect(privateKeyToAddress(fromHex(t.privateKey))).toBe(t.from);
      expect(block.rawHex).toBe(t.raw);
      expect(block.hash).toBe(t.hash);
      expect(block.blockAddress).toBe(t.blockAddress);
    });
  }
});

describe('address kind precedence', () => {
  it('treats a 32-char Base58Check account address as an account, not a block', async () => {
    const { isLegacyAddress } = await import('@/core/address');
    const acct = vectors.transactions.find((t) => t.to.length === 32)!.to;
    expect(isValidAddress(acct)).toBe(true);
    expect(isLegacyAddress(acct)).toBe(false);
    expect(isLegacyAddress('gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3')).toBe(true);
  });
});
