/** JSON-RPC client for xdagj nodes (io.xdag.rpc.api.XdagApi). */
import { parseNodeAmount } from './amount';

export class RpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface TxLink {
  /** 0 input (sent), 1 output (received), 2 earning, 3 snapshot / other */
  direction: number;
  hashlow: string;
  /** block address of the transaction */
  address: string;
  amount: string;
  /** milliseconds */
  time: number;
  remark?: string | null;
}

export interface BlockLink {
  direction: number;
  address: string;
  hashlow: string;
  amount: string;
}

export interface BlockResponse {
  height?: number;
  balance?: string;
  blockTime?: number;
  timeStamp?: number;
  state?: string;
  hash?: string | null;
  address?: string;
  remark?: string | null;
  diff?: string;
  type?: string;
  flags?: string;
  totalPage?: number;
  refs?: BlockLink[] | null;
  transactions?: TxLink[] | null;
}

let rpcId = 1;

export class XdagRpc {
  constructor(readonly url: string, readonly timeoutMs = 20_000) {}

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (e) {
      throw new RpcError((e as Error).name === 'AbortError' ? 'Node request timed out' : 'Cannot reach node');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new RpcError(`Node responded with HTTP ${res.status}`);
    let body: { result?: T; error?: { code?: number; message?: string } | string };
    try {
      body = await res.json();
    } catch {
      throw new RpcError('Invalid response from node');
    }
    if (body.error) {
      const err = body.error;
      throw typeof err === 'string' ? new RpcError(err) : new RpcError(err.message ?? 'Node error', err.code);
    }
    return body.result as T;
  }

  /** Balance in nano-XDAG for an account address or a 32-char block address. */
  async getBalance(address: string): Promise<bigint> {
    return parseNodeAmount(await this.call<string>('xdag_getBalance', [address]));
  }

  async getNonce(address: string): Promise<bigint> {
    const r = await this.call<string>('xdag_getTransactionNonce', [address]);
    if (typeof r !== 'string' || !/^\d+$/.test(r)) throw new RpcError('Invalid nonce response');
    return BigInt(r);
  }

  /** Suggested fee in nano-XDAG (the node never reports less than 0.1). */
  async getAverageFee(): Promise<bigint> {
    return parseNodeAmount(await this.call<string>('xdag_getAverageFee', []));
  }

  async netType(): Promise<string> {
    return String(await this.call<string>('xdag_netType', [])).toLowerCase();
  }

  async blockNumber(): Promise<string> {
    return this.call<string>('xdag_blockNumber', []);
  }

  async getBlock(hashOrAddress: string, page = 1, pageSize = 20): Promise<BlockResponse | null> {
    try {
      return await this.call<BlockResponse | null>('xdag_getBlockByHash', [hashOrAddress, String(page), String(pageSize)]);
    } catch (e) {
      // older nodes only implement the (hash, page) overload
      if (e instanceof RpcError && /param/i.test(e.message)) return this.call('xdag_getBlockByHash', [hashOrAddress, String(page)]);
      throw e;
    }
  }

  /** Broadcasts a signed block. Resolves to the block address, rejects with the node's reason. */
  async sendRawTransaction(rawHex: string): Promise<string> {
    const r = await this.call<string>('xdag_sendRawTransaction', [rawHex]);
    if (typeof r === 'string' && /^[A-Za-z0-9+/]{32}$/.test(r)) return r;
    throw new RpcError(typeof r === 'string' && r ? r : 'Transaction rejected by node');
  }
}
