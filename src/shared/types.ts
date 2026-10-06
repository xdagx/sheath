import type { NetworkKind } from '@/core/tx';

export type AccountSource = 'created' | 'mnemonic' | 'privateKey' | 'xdagj' | 'legacy';

/** Public account metadata (kept inside the encrypted vault, exposed to the UI when unlocked). */
export interface Account {
  id: string;
  name: string;
  address: string;
  source: AccountSource;
  /** Keyring holding the secret. */
  keyringId: string;
  /** BIP44 index for HD accounts. */
  hdIndex?: number;
  /** Accounts imported together (same wallet file) share a group id. */
  groupId: string;
  /** 2018-style block addresses (32 chars) owned by this key or its group. */
  legacyBlocks: string[];
  createdAt: number;
}

export type Keyring =
  | { id: string; type: 'hd'; mnemonic: string; nextIndex: number; createdAt: number; backedUp: boolean }
  | { id: string; type: 'key'; privateKey: string; createdAt: number };

export interface VaultData {
  version: 1;
  keyrings: Keyring[];
  accounts: Account[];
  selectedAccountId: string | null;
}

export interface NetworkConfig {
  id: string;
  name: string;
  kind: NetworkKind;
  rpcUrl: string;
  explorerUrl: string;
  builtin: boolean;
}

export type ThemeSetting = 'system' | 'dark' | 'light';
export type LanguageSetting = 'auto' | 'zh-CN' | 'en';

export interface Settings {
  networkId: string;
  customNetworks: NetworkConfig[];
  autoLockMinutes: number;
  theme: ThemeSetting;
  language: LanguageSetting;
  hideBalance: boolean;
}

export interface Contact {
  id: string;
  name: string;
  address: string;
  note?: string;
}

export interface PendingTx {
  blockAddress: string;
  from: string;
  to: string;
  amount: string; // nano as decimal string
  fee: string; // nano
  remark: string;
  time: number;
  networkId: string;
  legacyFrom?: string;
  /** broadcast outcome unknown (timeout / unexpected answer) */
  uncertain?: boolean;
}

export interface WalletState {
  initialized: boolean;
  unlocked: boolean;
  accounts: Account[];
  selectedAccountId: string | null;
  needsBackup: boolean;
  hasMnemonic: boolean;
  settings: Settings;
}

export interface ImportPreviewAccount {
  address: string;
  /** account name carried by a Sheath backup */
  name?: string;
  /** number of 2018 old addresses carried by a Sheath backup */
  legacyBlocks?: number;
  /** compressed public key (hex), used to recognise the account's old blocks */
  publicKey: string;
  /** index in the imported file, for display */
  index: number;
  alreadyExists: boolean;
  hdIndex?: number;
}

export interface ImportPreview {
  token: string;
  kind: 'xdagj' | 'legacy' | 'mnemonic' | 'privateKey' | 'sheath';
  accounts: ImportPreviewAccount[];
  hasMnemonic: boolean;
  passwordVerified: boolean;
  encrypted: boolean;
}

export interface SendResult {
  blockAddress: string;
  pending: PendingTx;
}

/** old block addresses kept per account (each one is refreshed on the home screen) */
export const MAX_LEGACY_BLOCKS = 50;
