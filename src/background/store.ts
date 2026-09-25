/** Thin typed wrappers around chrome.storage. */
import type { EncryptedVault } from '@/core/vault';
import type { Contact, PendingTx, Settings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/networks';

interface LocalSchema {
  vault: EncryptedVault;
  settings: Settings;
  contacts: Contact[];
  pending: PendingTx[];
  unlockFailures: { count: number; until: number };
}

interface SessionSchema {
  vaultKey: string;
}

export async function getLocal<K extends keyof LocalSchema>(key: K): Promise<LocalSchema[K] | undefined> {
  const r = await chrome.storage.local.get(key);
  return r[key] as LocalSchema[K] | undefined;
}

export async function setLocal<K extends keyof LocalSchema>(key: K, value: LocalSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal(...keys: (keyof LocalSchema)[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

export async function getSession<K extends keyof SessionSchema>(key: K): Promise<SessionSchema[K] | undefined> {
  const r = await chrome.storage.session.get(key);
  return r[key] as SessionSchema[K] | undefined;
}

export async function setSession<K extends keyof SessionSchema>(key: K, value: SessionSchema[K]): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.clear();
}

export async function loadSettings(): Promise<Settings> {
  const s = await getLocal('settings');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
