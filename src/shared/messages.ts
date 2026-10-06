/**
 * Typed request/response protocol between the UI (popup / tab) and the background keyring.
 * Secrets only travel UI -> background (imports) or background -> UI on explicit export.
 */
import type { Account, Contact, ImportPreview, NetworkConfig, PendingTx, SendResult, Settings, WalletState } from './types';

export interface FilePayload {
  name: string;
  /** base64 contents */
  data: string;
}

export interface RequestMap {
  getState: [{}, WalletState];
  /** user activity: postpones auto-lock */
  touch: [{}, { ok: true }];
  /** passive keep-alive while a page is open (does not postpone auto-lock) */
  ping: [{}, { ok: true }];
  generateMnemonic: [{ words?: 12 | 24 }, { mnemonic: string }];
  createVault: [{ password: string; mnemonic: string; backedUp: boolean }, WalletState];
  unlock: [{ password: string }, WalletState];
  lock: [{}, WalletState];
  verifyPassword: [{ password: string }, { ok: true }];
  changePassword: [{ oldPassword: string; newPassword: string }, { ok: true }];
  /** password required while unlocked; while locked this is the forgot-password path */
  resetWallet: [{ password?: string }, WalletState];

  /** Stage an import; returns a preview with addresses. `password` is the vault password during onboarding. */
  previewImport: [
    | { kind: 'mnemonic'; mnemonic: string; count: number; allowBadChecksum?: boolean }
    | { kind: 'privateKey'; privateKey: string }
    | { kind: 'xdagj'; file: FilePayload; filePassword: string }
    | { kind: 'sheath'; file: FilePayload; filePassword: string }
    | { kind: 'legacy'; walletDat: FilePayload; dnetKeyDat: FilePayload | null; filePassword: string },
    ImportPreview,
  ];
  /**
   * Commit a staged import. If the vault does not exist yet, `newVaultPassword` creates it.
   * `legacyBlocks` are old block addresses typed by the user (attached to the first account);
   * `ownedBlocks` were found in the old client's storage folder together with the key that owns
   * them, and are attached to that key's account — also when it was imported before.
   */
  commitImport: [
    { token: string; addresses: string[]; newVaultPassword?: string; legacyBlocks?: string[]; ownedBlocks?: Array<{ block: string; owner: string }> },
    WalletState,
  ];
  cancelImport: [{ token: string }, { ok: true }];

  addHdAccount: [{ name?: string }, WalletState];
  /** Adds a new recovery phrase and its first account to a wallet that has none yet (e.g. built from imported keys). */
  createHdWallet: [{ mnemonic: string; backedUp: boolean }, WalletState];
  renameAccount: [{ id: string; name: string }, WalletState];
  removeAccount: [{ id: string; password: string }, WalletState];
  selectAccount: [{ id: string }, WalletState];
  setLegacyBlocks: [{ id: string; blocks: string[] }, WalletState];
  markBackedUp: [{ password: string }, WalletState];

  exportPrivateKey: [{ id: string; password: string }, { privateKey: string }];
  exportMnemonic: [{ password: string; keyringId?: string }, { mnemonic: string }];
  exportXdagjWallet: [{ password: string; filePassword: string }, { file: string; count: number }];
  /** Sheath's own encrypted backup: keys, account names, 2018 old addresses and the address book. */
  exportBackup: [{ password: string; filePassword: string }, { file: string; count: number }];

  send: [{ accountId: string; to: string; amount: string; fee: string; remark: string }, SendResult];
  sendLegacy: [{ accountId: string; fromBlock: string; to: string; amount: string; remark: string }, SendResult];

  getSettings: [{}, Settings];
  updateSettings: [{ patch: Partial<Settings> }, Settings];
  upsertNetwork: [{ network: NetworkConfig }, Settings];
  removeNetwork: [{ id: string }, Settings];

  getContacts: [{}, Contact[]];
  saveContact: [{ contact: Contact }, Contact[]];
  deleteContact: [{ id: string }, Contact[]];

  getPending: [{}, PendingTx[]];
  dropPending: [{ blockAddresses: string[] }, PendingTx[]];
}

export type RequestType = keyof RequestMap;
export type RequestOf<K extends RequestType> = RequestMap[K][0];
export type ResponseOf<K extends RequestType> = RequestMap[K][1];

export interface Envelope<K extends RequestType = RequestType> {
  target: 'xdag-wallet';
  type: K;
  payload: RequestOf<K>;
}

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };

export type { Account };
