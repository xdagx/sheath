// A small stand-in for an xdagj JSON-RPC node, for local UI development and E2E tests.
// It independently parses submitted 512-byte blocks, verifies the ECDSA signature,
// enforces nonce / balance / fee rules like xdagj, and keeps simple balances + history.
//
//   node scripts/mock-node.mjs [port]            (default 18545)
//   FUND=<address>:<xdag>[,<address>:<xdag>...]  pre-fund accounts or 32-char block addresses
import http from 'node:http';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { base64, createBase58check } from '@scure/base';

const b58 = createBase58check(sha256);
const NANO = 1_000_000_000n;
const MIN_FEE = 100_000_000n;
const sha256d = (b) => sha256(sha256(b));
const isAccount = (a) => {
  try {
    return b58.decode(a).length === 20;
  } catch {
    return false;
  }
};
const hex = (b) => Buffer.from(b).toString('hex');

export function createMockNode({ netType = 'mainnet', fund = {}, legacyOwners = {} } = {}) {
  const balances = new Map(); // address (base58 or 32-char block) -> nano
  const nonces = new Map(); // base58 -> executed tx count
  const history = new Map(); // address -> [{direction, address, hashlow, amount, time, remark}]
  const blocks = new Map(); // tx block address -> details
  const log = [];
  for (const [a, v] of Object.entries(fund)) balances.set(a, BigInt(Math.round(Number(v) * 1e9)));

  const fmt = (n) => `${n / NANO}.${(n % NANO).toString().padStart(9, '0')}`;
  const cheatoToNano = (c) => {
    // XAmount.ofXAmount: amount2xdagNew -> nano, HALF_UP
    const whole = c >> 32n;
    const frac = c & 0xffffffffn;
    return whole * NANO + (frac * NANO + (1n << 31n)) / (1n << 32n);
  };
  const push = (addr, entry) => history.set(addr, [entry, ...(history.get(addr) ?? [])]);

  function parse(raw) {
    const dv = new DataView(raw.buffer, raw.byteOffset);
    const types = dv.getBigUint64(8, true);
    const nib = (i) => Number((types >> BigInt(4 * i)) & 0xfn);
    const field = (i) => raw.subarray(32 * i, 32 * i + 32);
    const out = { head: nib(0), time: dv.getBigUint64(16, true), fee: dv.getBigUint64(24, true), inputs: [], outputs: [] };
    let sig = -1;
    for (let i = 1; i < 16; i++) {
      const t = nib(i), f = field(i);
      const amount = new DataView(f.buffer, f.byteOffset + 24).getBigUint64(0, true);
      if (t === 0xe) out.nonce = new DataView(f.buffer, f.byteOffset + 24).getBigUint64(0, true);
      else if (t === 0xc || t === 0xd) {
        if (f.subarray(0, 4).some((x) => x)) throw new Error('bad address field');
        const addr = b58.encode(Uint8Array.from(f.subarray(4, 24)).reverse());
        (t === 0xc ? out.inputs : out.outputs).push({ type: t, addr, amount });
      } else if (t === 0x2) out.inputs.push({ type: 2, addr: base64.encode(f.subarray(0, 24)), amount });
      else if (t === 0x9) out.remark = new TextDecoder().decode(f).replace(/\0+$/, '');
      else if (t === 6 || t === 7) {
        out.pub = new Uint8Array(33);
        out.pub[0] = t === 7 ? 3 : 2;
        out.pub.set(f, 1);
      } else if (t === 5 && sig < 0) sig = i;
    }
    if (!out.pub || sig < 0) throw new Error('missing key or signature');
    const unsigned = Uint8Array.from(raw);
    unsigned.fill(0, 32 * sig, 32 * sig + 64);
    const digest = sha256d(new Uint8Array([...unsigned, ...out.pub]));
    out.sigValid = secp256k1.verify(raw.slice(32 * sig, 32 * sig + 64), digest, out.pub, { prehash: false, lowS: true });
    out.pubAddress = b58.encode(ripemd160(sha256(out.pub)));
    return out;
  }

  function sendRaw(rawHex) {
    const raw = Uint8Array.from(Buffer.from(rawHex, 'hex'));
    if (raw.length !== 512) return 'INVALID_BLOCK size';
    let b;
    try {
      b = parse(raw);
    } catch (e) {
      return `INVALID_BLOCK ${e.message}`;
    }
    const expectedHead = netType === 'mainnet' ? 1 : 8;
    if (b.head !== expectedHead) return 'INVALID_BLOCK Block type error';
    if (!b.sigValid) return "INVALID_BLOCK Block's input can't be used";
    if (b.inputs.length !== 1 || b.outputs.length !== 1) return 'INVALID_BLOCK unsupported shape';
    const input = b.inputs[0], output = b.outputs[0];
    if (input.amount !== output.amount) return 'INVALID_BLOCK sumIn != sumOut';
    const amount = cheatoToNano(input.amount);
    const fee = b.fee === 0n ? MIN_FEE : b.fee + MIN_FEE;
    if (amount < fee) return 'INVALID_BLOCK Ref input amount < Gas';
    const nowXdag = BigInt(Math.ceil((Date.now() * 1024) / 1000 + 0.5));
    if (b.time > nowXdag + 16384n) return "INVALID_BLOCK Block's time is illegal";
    if (input.type === 0xc) {
      if (input.addr !== b.pubAddress) return "INVALID_BLOCK Block's input can't be used";
      const expected = (nonces.get(input.addr) ?? 0n) + 1n;
      if (b.nonce !== expected) return 'PLEASE FILL IN THE CORRECT NONCE ';
      if ((balances.get(input.addr) ?? 0n) < amount) return 'INVALID_BLOCK insufficient balance';
      nonces.set(input.addr, expected);
    } else {
      if (b.nonce !== undefined) return 'NO NONCE IS REQUIRED FOR MAIN BLOCK TRANSFER ';
      const owner = legacyOwners[input.addr];
      if (owner && owner !== hex(b.pub)) return "INVALID_BLOCK Block's input can't be used";
      if ((balances.get(input.addr) ?? 0n) < amount) return 'INVALID_BLOCK insufficient block balance';
    }
    const blockAddress = base64.encode(sha256d(raw).subarray(0, 24));
    balances.set(input.addr, (balances.get(input.addr) ?? 0n) - amount);
    balances.set(output.addr, (balances.get(output.addr) ?? 0n) + amount - fee);
    const time = Date.now();
    const hashlow = hex(Uint8Array.from(sha256d(raw)).reverse());
    push(input.addr, { direction: 0, address: blockAddress, hashlow, amount: fmt(amount), time, remark: b.remark ?? '' });
    push(output.addr, { direction: 1, address: blockAddress, hashlow, amount: fmt(amount - fee), time, remark: b.remark ?? '' });
    blocks.set(blockAddress, { input, output, amount, fee, remark: b.remark ?? '', time });
    log.push({ blockAddress, nonce: b.nonce?.toString(), from: input.addr, to: output.addr, amount: amount.toString(), fee: fee.toString(), remark: b.remark ?? null, head: b.head });
    return blockAddress;
  }

  function getBlock(id, page = 1, size = 20) {
    const tx = blocks.get(id);
    if (tx) {
      return {
        address: id,
        state: 'Accepted',
        remark: tx.remark,
        blockTime: tx.time,
        refs: [
          { direction: 2, address: id, hashlow: '', amount: fmt(tx.fee) },
          { direction: 0, address: tx.input.addr, hashlow: '', amount: fmt(tx.amount) },
          { direction: 1, address: tx.output.addr, hashlow: '', amount: fmt(tx.amount - tx.fee) },
        ],
        transactions: [],
      };
    }
    const all = history.get(id) ?? [];
    const p = Math.max(1, Number(page) || 1), s = Math.max(1, Number(size) || 20);
    return {
      address: id,
      balance: fmt(balances.get(id) ?? 0n),
      type: 'Wallet',
      state: 'Accepted',
      totalPage: Math.max(1, Math.ceil(all.length / s)),
      transactions: Number(page) === 0 ? [] : all.slice((p - 1) * s, p * s),
    };
  }

  const handlers = {
    xdag_netType: () => netType,
    xdag_blockNumber: () => '1843000',
    // like xdagj: an unknown old block address is an internal error (-32603), an unknown account is 0
    xdag_getBalance: ([a]) => {
      if (!balances.has(a) && !isAccount(a)) throw new Error('Internal error');
      return fmt(balances.get(a) ?? 0n);
    },
    xdag_getTransactionNonce: ([a]) => String((nonces.get(a) ?? 0n) + 1n),
    xdag_getAverageFee: () => '0.12',
    xdag_sendRawTransaction: ([raw]) => sendRaw(raw),
    xdag_getBlockByHash: ([id, page, size]) => getBlock(id, page, size),
  };

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        res.statusCode = 400;
        return res.end();
      }
      const h = handlers[msg.method];
      let reply;
      try {
        reply = h
          ? { jsonrpc: '2.0', id: msg.id, result: h(msg.params ?? []) }
          : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
      } catch (e) {
        reply = { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(reply));
    });
  });
  return { server, balances, nonces, log, fund: (a, v) => balances.set(a, BigInt(Math.round(Number(v) * 1e9))) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 18545);
  const fund = Object.fromEntries((process.env.FUND ?? '').split(',').filter(Boolean).map((p) => p.split(':')));
  const node = createMockNode({ netType: process.env.NET ?? 'mainnet', fund });
  node.server.listen(port, '127.0.0.1', () => console.log(`mock xdagj node on http://127.0.0.1:${port} (${process.env.NET ?? 'mainnet'})`));
}
