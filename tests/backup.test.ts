/**
 * Sheath's own encrypted backup file (core/backup.ts): round trip, tamper detection, detection.
 */
import { describe, expect, it } from 'vitest';
import {
  BackupFormatError,
  BackupPasswordError,
  decryptBackup,
  encryptBackup,
  looksLikeSheathBackup,
  parseBackupFile,
  type BackupPayload,
} from '@/core/backup';
import { publicKeyToAddress } from '@/core/address';
import { fromHex, toHex } from '@/core/bytes';
import { deriveHdKey, getPublicKey, mnemonicToSeed } from '@/core/keys';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PRIV = '1f4e2d9a7c3b5e8f0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778';
const seed = mnemonicToSeed(MNEMONIC);
const hd0 = deriveHdKey(seed, 0);
const payload: BackupPayload = {
  version: 1,
  createdAt: 1_700_000_000_000,
  keyrings: [
    { id: 'hd1', type: 'hd', mnemonic: MNEMONIC, nextIndex: 1, createdAt: 1, backedUp: true },
    { id: 'k1', type: 'key', privateKey: PRIV, createdAt: 2 },
  ],
  accounts: [
    {
      id: 'a1',
      name: 'Account 1',
      address: publicKeyToAddress(getPublicKey(hd0)),
      source: 'created',
      keyringId: 'hd1',
      hdIndex: 0,
      groupId: 'hd1',
      legacyBlocks: [],
      createdAt: 3,
    },
    {
      id: 'a2',
      name: '旧钱包',
      address: publicKeyToAddress(getPublicKey(fromHex(PRIV))),
      source: 'legacy',
      keyringId: 'k1',
      groupId: 'g2',
      legacyBlocks: ['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3'],
      createdAt: 4,
    },
  ],
  selectedAccountId: 'a2',
  contacts: [{ id: 'c1', name: 'Alice', address: publicKeyToAddress(getPublicKey(fromHex('11'.repeat(32)))), note: 'friend' }],
};

describe('Sheath backup file', () => {
  it('round-trips and reveals nothing in the clear', async () => {
    const bytes = await encryptBackup(payload, 'file-pass-123', 'Sheath test');
    expect(looksLikeSheathBackup(bytes)).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain('abandon');
    expect(text).not.toContain(PRIV);
    expect(text).not.toContain(payload.accounts[1]!.address);
    expect(parseBackupFile(bytes)).toMatchObject({ format: 'sheath-wallet-backup', version: 1, app: 'Sheath test', createdAt: payload.createdAt });
    const back = await decryptBackup(bytes, 'file-pass-123');
    expect(back).toEqual(payload);
  });

  it('rejects a wrong password and damaged or edited files', async () => {
    const bytes = await encryptBackup(payload, 'file-pass-123', 'Sheath test');
    await expect(decryptBackup(bytes, 'file-pass-124')).rejects.toBeInstanceOf(BackupPasswordError);
    const flipped = Uint8Array.from(bytes);
    const i = new TextDecoder().decode(bytes).indexOf('"data":') + 12;
    flipped[i] = flipped[i] === 65 ? 66 : 65;
    await expect(decryptBackup(flipped, 'file-pass-123')).rejects.toBeInstanceOf(BackupPasswordError);
    expect(() => parseBackupFile(new TextEncoder().encode('{"format":"other"}'))).toThrow(BackupFormatError);
    expect(() => parseBackupFile(new Uint8Array([0, 1, 2]))).toThrow(BackupFormatError);
    expect(looksLikeSheathBackup(new TextEncoder().encode('{"hello":1}'))).toBe(false);
  });

  it('refuses a payload whose account does not belong to its key', async () => {
    const bad: BackupPayload = { ...payload, accounts: [{ ...payload.accounts[0]!, address: payload.accounts[1]!.address }] };
    const bytes = await encryptBackup(bad, 'file-pass-123', 'x');
    await expect(decryptBackup(bytes, 'file-pass-123')).rejects.toThrow(/does not match/);
    const orphan: BackupPayload = { ...payload, accounts: [{ ...payload.accounts[1]!, keyringId: 'missing' }] };
    await expect(decryptBackup(await encryptBackup(orphan, 'p-p-p-p-p', 'x'), 'p-p-p-p-p')).rejects.toThrow(/missing key/);
  });

  it('normalises what it keeps: names, old addresses, contacts', async () => {
    const messy = {
      ...payload,
      accounts: [
        {
          ...payload.accounts[1]!,
          name: '  x'.padEnd(60, 'y'),
          legacyBlocks: ['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3', 'not-a-block', 'gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3'],
        },
      ],
      contacts: [...payload.contacts, { id: 'c2', name: '', address: payload.contacts[0]!.address }, { id: 'c3', name: 'Bad', address: 'nope' }],
    } as BackupPayload;
    const back = await decryptBackup(await encryptBackup(messy, 'file-pass-123', 'x'), 'file-pass-123');
    expect(back.accounts[0]!.name.length).toBe(40);
    expect(back.accounts[0]!.legacyBlocks).toEqual(['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3']);
    expect(back.contacts).toHaveLength(1);
    expect(back.selectedAccountId).toBe('a2');
    expect(toHex(fromHex(PRIV))).toBe(PRIV);
  });
});
