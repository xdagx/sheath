/**
 * MV3 service worker: routes typed messages from extension pages to the keyring,
 * and enforces auto-lock (inactivity alarm, OS screen lock).
 */
import type { Envelope, Reply, RequestOf, RequestType, ResponseOf } from '@/shared/messages';
import { allNetworks, validateNodeUrl } from '@/shared/networks';
import type { Contact, NetworkConfig, Settings } from '@/shared/types';
import { isValidAddress } from '@/core/address';
import { Keyring, WalletError } from './keyring';
import { getLocal, loadSettings, setLocal } from './store';

const keyring = new Keyring();
const AUTO_LOCK_ALARM = 'xdag-auto-lock';

async function scheduleAutoLock(): Promise<void> {
  const settings = await loadSettings();
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes > 0) {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: Math.max(0.5, settings.autoLockMinutes) });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void keyring.lock();
});

chrome.idle?.onStateChanged.addListener((state) => {
  if (state === 'locked') void keyring.lock();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('app.html#/welcome') });
});

function sanitizeSettingsPatch(patch: Partial<Settings>, current: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (patch.networkId !== undefined) {
    if (!allNetworks(current).some((n) => n.id === patch.networkId)) throw new WalletError('unknown_network');
    out.networkId = patch.networkId;
  }
  if (patch.autoLockMinutes !== undefined) {
    const m = Number(patch.autoLockMinutes);
    if (![0, 1, 5, 15, 30, 60, 240].includes(m)) throw new WalletError('invalid_setting');
    out.autoLockMinutes = m;
  }
  if (patch.theme !== undefined) {
    if (!['system', 'dark', 'light'].includes(patch.theme)) throw new WalletError('invalid_setting');
    out.theme = patch.theme;
  }
  if (patch.language !== undefined) {
    if (!['auto', 'zh-CN', 'en'].includes(patch.language)) throw new WalletError('invalid_setting');
    out.language = patch.language;
  }
  if (patch.hideBalance !== undefined) out.hideBalance = !!patch.hideBalance;
  return out;
}

type Handler<K extends RequestType> = (payload: RequestOf<K>) => Promise<ResponseOf<K>>;
type Handlers = { [K in RequestType]: Handler<K> };

const handlers: Handlers = {
  getState: () => keyring.state(),
  touch: async () => ({ ok: true }),
  ping: async () => ({ ok: true }),
  generateMnemonic: async ({ words }) => ({ mnemonic: keyring.generateMnemonic(words ?? 12) }),
  createVault: async ({ password, mnemonic, backedUp }) => {
    await keyring.createVault(password, mnemonic, backedUp);
    return keyring.state();
  },
  unlock: ({ password }) => keyring.unlock(password),
  lock: async () => {
    await keyring.lock();
    return keyring.state();
  },
  verifyPassword: async ({ password }) => {
    await keyring.verifyPassword(password);
    return { ok: true };
  },
  changePassword: async ({ oldPassword, newPassword }) => {
    await keyring.changePassword(oldPassword, newPassword);
    return { ok: true };
  },
  resetWallet: async () => {
    await keyring.reset();
    return keyring.state();
  },
  previewImport: (p) => keyring.previewImport(p),
  commitImport: async (p) => {
    await keyring.commitImport(p);
    return keyring.state();
  },
  cancelImport: async ({ token }) => {
    keyring.cancelImport(token);
    return { ok: true };
  },
  addHdAccount: async ({ name }) => {
    await keyring.addHdAccount(name);
    return keyring.state();
  },
  renameAccount: async ({ id, name }) => {
    await keyring.renameAccount(id, name);
    return keyring.state();
  },
  removeAccount: async ({ id, password }) => {
    await keyring.removeAccount(id, password);
    return keyring.state();
  },
  selectAccount: async ({ id }) => {
    await keyring.selectAccount(id);
    return keyring.state();
  },
  setLegacyBlocks: async ({ id, blocks }) => {
    await keyring.setLegacyBlocks(id, blocks);
    return keyring.state();
  },
  markBackedUp: async ({ password }) => {
    await keyring.markBackedUp(password);
    return keyring.state();
  },
  exportPrivateKey: async ({ id, password }) => ({ privateKey: await keyring.exportPrivateKey(id, password) }),
  exportMnemonic: async ({ password, keyringId }) => ({ mnemonic: await keyring.exportMnemonic(password, keyringId) }),
  exportXdagjWallet: ({ password, filePassword }) => keyring.exportXdagjWallet(password, filePassword),
  send: (p) => keyring.send(p),
  sendLegacy: (p) => keyring.sendLegacy(p),
  getSettings: () => loadSettings(),
  updateSettings: async ({ patch }) => {
    const current = await loadSettings();
    const next = { ...current, ...sanitizeSettingsPatch(patch, current) };
    await setLocal('settings', next);
    if (patch.autoLockMinutes !== undefined) await scheduleAutoLock();
    return next;
  },
  upsertNetwork: async ({ network }) => {
    const current = await loadSettings();
    const err = validateNodeUrl(network.rpcUrl);
    if (err) throw new WalletError(`node_url_${err}`);
    if (network.explorerUrl && validateNodeUrl(network.explorerUrl)) throw new WalletError('explorer_url_invalid');
    if (!['mainnet', 'testnet', 'devnet'].includes(network.kind)) throw new WalletError('invalid_setting');
    const clean: NetworkConfig = {
      id: network.id && !network.builtin ? network.id : `custom-${Date.now().toString(36)}`,
      name: network.name.trim().slice(0, 32) || 'Custom',
      kind: network.kind,
      rpcUrl: network.rpcUrl.trim(),
      explorerUrl: network.explorerUrl.trim(),
      builtin: false,
    };
    if (current.customNetworks.length >= 10 && !current.customNetworks.some((n) => n.id === clean.id)) throw new WalletError('too_many_networks');
    const customNetworks = [...current.customNetworks.filter((n) => n.id !== clean.id), clean];
    const next = { ...current, customNetworks, networkId: clean.id };
    await setLocal('settings', next);
    return next;
  },
  removeNetwork: async ({ id }) => {
    const current = await loadSettings();
    const customNetworks = current.customNetworks.filter((n) => n.id !== id);
    const next = { ...current, customNetworks, networkId: current.networkId === id ? 'mainnet' : current.networkId };
    await setLocal('settings', next);
    return next;
  },
  getContacts: async () => (await getLocal('contacts')) ?? [],
  saveContact: async ({ contact }) => {
    if (!isValidAddress(contact.address)) throw new WalletError('invalid_address');
    const name = contact.name.trim().slice(0, 40);
    if (!name) throw new WalletError('invalid_name');
    const list = (await getLocal('contacts')) ?? [];
    const id = contact.id || crypto.randomUUID();
    const clean: Contact = { id, name, address: contact.address.trim(), note: (contact.note ?? '').slice(0, 100) };
    const next = [...list.filter((c) => c.id !== id), clean].sort((a, b) => a.name.localeCompare(b.name));
    await setLocal('contacts', next);
    return next;
  },
  deleteContact: async ({ id }) => {
    const next = ((await getLocal('contacts')) ?? []).filter((c) => c.id !== id);
    await setLocal('contacts', next);
    return next;
  },
  getPending: async () => (await getLocal('pending')) ?? [],
  dropPending: async ({ blockAddresses }) => {
    const drop = new Set(blockAddresses);
    const next = ((await getLocal('pending')) ?? []).filter((p) => !drop.has(p.blockAddress));
    await setLocal('pending', next);
    return next;
  },
};

// Requests that count as user activity and postpone the auto-lock.
const PASSIVE = new Set<RequestType>(['ping', 'getState', 'getSettings', 'getPending', 'getContacts']);

chrome.runtime.onMessage.addListener((message: Envelope, sender, sendResponse: (r: Reply<unknown>) => void) => {
  // Only our own extension pages may talk to the keyring (no content scripts exist).
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (!message || message.target !== 'xdag-wallet' || !(message.type in handlers)) return false;
  const handler = handlers[message.type] as Handler<RequestType>;
  (async () => {
    try {
      const value = await handler(message.payload as never);
      if (!PASSIVE.has(message.type)) await scheduleAutoLock();
      sendResponse({ ok: true, value });
    } catch (e) {
      if (e instanceof WalletError) sendResponse({ ok: false, error: e.message, code: e.code });
      else sendResponse({ ok: false, error: (e as Error)?.message ?? String(e), code: 'internal' });
    }
  })();
  return true;
});
