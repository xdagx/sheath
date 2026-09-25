import type { Envelope, Reply, RequestOf, RequestType, ResponseOf } from '@/shared/messages';

export class WalletCallError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(detail || code);
    this.name = 'WalletCallError';
  }
}

export async function call<K extends RequestType>(type: K, payload: RequestOf<K> = {} as RequestOf<K>): Promise<ResponseOf<K>> {
  const envelope: Envelope<K> = { target: 'xdag-wallet', type, payload };
  let reply: Reply<ResponseOf<K>> | undefined;
  try {
    reply = await chrome.runtime.sendMessage(envelope);
  } catch (e) {
    throw new WalletCallError('internal', (e as Error).message);
  }
  if (!reply) throw new WalletCallError('internal', 'No response from background');
  if (!reply.ok) throw new WalletCallError(reply.code ?? 'internal', reply.error);
  return reply.value;
}

export const isPopup = () => document.documentElement.dataset.mode === 'popup';

export function openInTab(hash: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`app.html${hash}`) });
  if (isPopup()) window.close();
}

export function openExternal(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  void chrome.tabs.create({ url });
}
