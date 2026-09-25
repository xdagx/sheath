import type { NetworkConfig, Settings } from './types';

/** Public RPC endpoints used by the official XDAG Pro wallet (lib/common/global.dart); the community block explorer. */
export const BUILTIN_NETWORKS: NetworkConfig[] = [
  {
    id: 'mainnet',
    name: 'Mainnet',
    kind: 'mainnet',
    rpcUrl: 'https://mainnet-rpc.xdagj.org',
    explorerUrl: 'https://explorer.xdag.io',
    builtin: true,
  },
  {
    id: 'testnet',
    name: 'Testnet',
    kind: 'testnet',
    rpcUrl: 'https://testnet-rpc.xdagj.org',
    explorerUrl: 'https://testexplorer.xdag.io',
    builtin: true,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  networkId: 'mainnet',
  customNetworks: [],
  autoLockMinutes: 15,
  theme: 'system',
  language: 'auto',
  hideBalance: false,
};

export function allNetworks(settings: Settings): NetworkConfig[] {
  return [...BUILTIN_NETWORKS, ...settings.customNetworks];
}

export function currentNetwork(settings: Settings): NetworkConfig {
  return allNetworks(settings).find((n) => n.id === settings.networkId) ?? BUILTIN_NETWORKS[0]!;
}

/**
 * Explorer page of an address or block. The XDAG explorer (github.com/XDagger/explorer,
 * BlockController) takes the id from the raw request path without URL-decoding it, and its route
 * accepts '/' in the id: a 2018 block address, which may contain '+' and '/', must be put in the
 * path as it is ('%2B' is not found). Only address / hash characters are allowed through.
 */
export function explorerLink(net: NetworkConfig, addressOrBlock: string): string | null {
  const id = addressOrBlock.trim();
  if (!net.explorerUrl || !/^[A-Za-z0-9+/]{20,128}$/.test(id)) return null;
  return `${net.explorerUrl.replace(/\/+$/, '')}/block/${id}`;
}

/** Accepts only http(s) URLs; plain http is allowed for localhost nodes only. */
export function validateNodeUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'invalid';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return null;
  return u.protocol === 'http:' ? 'insecure' : 'invalid';
}

export function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}
