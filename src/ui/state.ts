import { batch, computed, signal } from '@preact/signals';
import { RpcError, XdagRpc } from '@/core/rpc';
import { currentNetwork, DEFAULT_SETTINGS } from '@/shared/networks';
import type { Account, Contact, PendingTx, Settings, WalletState } from '@/shared/types';
import { call, WalletCallError } from './api';
import { errorText, languageSetting } from './i18n';

export const wallet = signal<WalletState | null>(null);
export const settings = computed<Settings>(() => wallet.value?.settings ?? DEFAULT_SETTINGS);
export const network = computed(() => currentNetwork(settings.value));
export const rpc = computed(() => new XdagRpc(network.value.rpcUrl));
export const accounts = computed<Account[]>(() => wallet.value?.accounts ?? []);
export const selectedAccount = computed<Account | null>(() => {
  const w = wallet.value;
  if (!w) return null;
  return w.accounts.find((a) => a.id === w.selectedAccountId) ?? w.accounts[0] ?? null;
});

export function applyState(st: WalletState): void {
  const prevNetwork = wallet.value?.settings.networkId;
  batch(() => {
    wallet.value = st;
    languageSetting.value = st.settings.language;
    if (prevNetwork !== st.settings.networkId) nodeError.value = null;
  });
  if (prevNetwork !== st.settings.networkId) {
    if (prevNetwork !== undefined) balances.value = {}; // another network: the old balances do not apply
    loadCachedBalances();
  }
  applyTheme(st.settings.theme);
}

export function applySettings(s: Settings): void {
  if (!wallet.value) return;
  applyState({ ...wallet.value, settings: s });
}

export async function refreshState(): Promise<WalletState> {
  const st = await call('getState');
  applyState(st);
  return st;
}

export function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* optional */
  }
}

/** Applies the last known theme synchronously to avoid a flash before settings load. */
export function applyCachedTheme(): void {
  let theme: Settings['theme'] = 'system';
  try {
    theme = (localStorage.getItem('theme') as Settings['theme']) || 'system';
  } catch {
    /* optional */
  }
  applyTheme(theme);
}

// ---------------------------------------------------------------- balances (cached)
// Kept in chrome.storage.session: RAM only, cleared on lock and when the browser closes.

interface CachedBalance {
  value: string;
  at: number;
}

function cacheKey(): string {
  return `balances:${network.value.id}`;
}

export const balances = signal<Record<string, CachedBalance>>({});
export const nodeError = signal<string | null>(null);
/** addresses the current node does not know (xdagj answers an error, e.g. an old block missing from its snapshot) */
export const unknownOnNode = signal<Record<string, true>>({});

export function loadCachedBalances(): void {
  const key = cacheKey();
  unknownOnNode.value = {};
  chrome.storage.session.get(key).then(
    (r) => {
      if (key !== cacheKey()) return;
      const cached = (r[key] ?? {}) as Record<string, CachedBalance>;
      balances.value = { ...cached, ...balances.value };
    },
    () => undefined,
  );
}

export function balanceOf(address: string): bigint | null {
  const b = balances.value[address];
  return b ? BigInt(b.value) : null;
}

export async function refreshBalance(address: string): Promise<bigint | null> {
  const netId = network.value.id;
  try {
    const value = await rpc.value.getBalance(address);
    if (network.value.id !== netId) return null; // the network changed meanwhile
    const next = { ...balances.value, [address]: { value: value.toString(), at: Date.now() } };
    balances.value = next;
    nodeError.value = null;
    if (unknownOnNode.value[address]) {
      const { [address]: _, ...rest } = unknownOnNode.value;
      unknownOnNode.value = rest;
    }
    if (wallet.value?.unlocked) void chrome.storage.session.set({ [cacheKey()]: next }).catch(() => undefined);
    return value;
  } catch (e) {
    if (network.value.id !== netId) return null;
    // a JSON-RPC error means the node answered (e.g. unknown block address): not a connectivity issue
    if (!(e instanceof RpcError) || e.kind === 'transport') nodeError.value = (e as Error).message;
    else {
      unknownOnNode.value = { ...unknownOnNode.value, [address]: true };
      if (balances.value[address]) {
        const { [address]: _, ...rest } = balances.value;
        balances.value = rest;
      }
    }
    return null;
  }
}

/** Forgets per-device UI caches (theme, balances) after the wallet was reset. */
export function clearLocalCaches(): void {
  balances.value = {};
  unknownOnNode.value = {};
  try {
    localStorage.clear();
  } catch {
    /* optional */
  }
}

// ---------------------------------------------------------------- contacts & pending

export const contacts = signal<Contact[]>([]);
export const pendingTxs = signal<PendingTx[]>([]);

export async function loadContacts(): Promise<void> {
  contacts.value = await call('getContacts');
}

export async function loadPending(): Promise<void> {
  pendingTxs.value = await call('getPending');
}

// ---------------------------------------------------------------- toast

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export const toasts = signal<Toast[]>([]);
let toastId = 1;

export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = toastId++;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), kind === 'error' ? 4500 : 2200);
}

export function toastError(e: unknown): void {
  toast(describeError(e), 'error');
}

export function errorInfo(e: unknown): { code: string; text: string; detail: string } {
  return e instanceof WalletCallError
    ? { code: e.code, text: describeError(e), detail: e.detail }
    : { code: 'internal', text: describeError(e), detail: '' };
}

export function describeError(e: unknown): string {
  if (e instanceof WalletCallError) return errorText(e.code, e.detail);
  return (e as Error)?.message ?? String(e);
}

// ---------------------------------------------------------------- onboarding (memory only)

export const onboardingPassword = signal<string | null>(null);

export function lookupName(address: string): string | null {
  const a = accounts.value.find((x) => x.address === address);
  if (a) return a.name;
  const c = contacts.value.find((x) => x.address === address);
  return c ? c.name : null;
}
