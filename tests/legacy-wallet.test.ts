/**
 * 2018 C-client wallet files generated with the original dfslib/dfsrsa sources
 * (tools/vectors/legacy/gen_legacy.c -> tests/fixtures/legacy-vectors.json).
 */
import vectors from './fixtures/legacy-vectors.json';
import { fromBase64, toHex } from '@/core/bytes';
import { decryptLegacyWallet, encryptLegacyWalletKeys } from '@/core/legacy/wallet';
import { WrongPasswordError } from '@/core/xdagj-wallet';

describe('legacy wallet.dat + dnet_key.dat', () => {
  for (const v of vectors) {
    const walletDat = fromBase64(v.walletDat);
    const dnetKey = fromBase64(v.dnetKeyDat);

    it(`${v.name}: decrypts with password ${JSON.stringify(v.password)}`, () => {
      const res = decryptLegacyWallet(walletDat, dnetKey, v.password);
      expect(res.encrypted).toBe(v.encrypted);
      expect(res.passwordVerified).toBe(true);
      expect(res.privateKeys.map(toHex)).toEqual(v.privateKeys);
    });

    if (v.encrypted) {
      it(`${v.name}: rejects a wrong password`, () => {
        expect(() => decryptLegacyWallet(walletDat, dnetKey, v.password + '1')).toThrow(WrongPasswordError);
        expect(() => decryptLegacyWallet(walletDat, dnetKey, '')).toThrow(WrongPasswordError);
      });

      it(`${v.name}: decrypts wallet.dat alone`, () => {
        const res = decryptLegacyWallet(walletDat, null, v.password);
        expect(res.passwordVerified).toBe(false);
        expect(res.privateKeys.map(toHex)).toEqual(v.privateKeys);
      });

      it(`${v.name}: our encryptor reproduces the C bytes`, () => {
        const keys = v.privateKeys.map((h) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))));
        expect(toHex(encryptLegacyWalletKeys(keys, v.password))).toBe(toHex(walletDat));
      });
    }
  }
});
