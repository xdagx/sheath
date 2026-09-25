/**
 * Keyring integration test: in-memory chrome.storage + a fake xdagj JSON-RPC node.
 */
import legacyVectors from './fixtures/legacy-vectors.json';
import xdagjVectors from './fixtures/xdagj-vectors.json';
import { blockAddressOfRaw, decodeAddress, encodeAddress, encodeLegacyAddress } from '@/core/address';
import { fromBase64, fromHex, readU64le, toBase64, toHex } from '@/core/bytes';
import { sha256d } from '@/core/hash';
import { getPublicKey, verifyDigest } from '@/core/keys';
import { decryptXdagjWallet } from '@/core/xdagj-wallet';
import { nanoToCheato, parseXdag } from '@/core/amount';

function memoryArea() {
  let data: Record<string, unknown> = {};
  return {
    async get(key: string) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(obj: Record<string, unknown>) {
      data = { ...data, ...structuredClone(obj) };
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async clear() {
      data = {};
    },
    dump: () => data,
  };
}

const local = memoryArea();
const session = memoryArea();
(globalThis as any).chrome = { storage: { local, session } };

// ---- fake node --------------------------------------------------------------------------
interface Sent {
  raw: Uint8Array;
}
const node = {
  netType: 'mainnet',
  balances: new Map<string, bigint>(),
  nonces: new Map<string, bigint>(),
  sent: [] as Sent[],
  rejectUnlessOwner: null as string | null, // compressed pubkey hex that owns legacy blocks
  sendMode: 'ok' as 'ok' | 'http500' | 'wrongAddress',
  netTypeError: false,
};

function parseBlock(raw: Uint8Array) {
  const types = readU64le(raw, 8);
  const nib = (i: number) => Number((types >> BigInt(4 * i)) & 0xfn);
  const fields = Array.from({ length: 16 }, (_, i) => raw.subarray(32 * i, 32 * i + 32));
  let sigIdx = -1, pubIdx = -1;
  for (let i = 1; i < 16; i++) {
    if (nib(i) === 5 && sigIdx < 0) sigIdx = i;
    if (nib(i) === 6 || nib(i) === 7) pubIdx = i;
  }
  const pub = new Uint8Array(33);
  pub[0] = nib(pubIdx) === 7 ? 3 : 2;
  pub.set(fields[pubIdx]!, 1);
  const unsigned = Uint8Array.from(raw);
  unsigned.fill(0, 32 * sigIdx, 32 * sigIdx + 64);
  const digest = sha256d(new Uint8Array([...unsigned, ...pub]));
  const sig = raw.slice(32 * sigIdx, 32 * sigIdx + 64);
  return { nib, fields, pub, valid: verifyDigest(sig, digest, pub) };
}

globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const req = JSON.parse(init.body as string);
  const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
  switch (req.method) {
    case 'xdag_netType':
      if (node.netTypeError) return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }));
      return reply(node.netType);
    case 'xdag_getBalance': {
      const b = node.balances.get(req.params[0]) ?? 0n;
      return reply(`${b / 1_000_000_000n}.${(b % 1_000_000_000n).toString().padStart(9, '0')}`);
    }
    case 'xdag_getTransactionNonce':
      return reply(String(node.nonces.get(req.params[0]) ?? 1n));
    case 'xdag_sendRawTransaction': {
      if (node.sendMode === 'http500') return new Response('oops', { status: 502 });
      if (node.sendMode === 'wrongAddress') return reply('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const raw = fromHex(req.params[0]);
      const blk = parseBlock(raw);
      if (!blk.valid) return reply('INVALID_BLOCK signature');
      if (blk.nib(1) === 2 && node.rejectUnlessOwner && toHex(blk.pub) !== node.rejectUnlessOwner) {
        return reply("INVALID_BLOCK Block's input can't be used");
      }
      node.sent.push({ raw });
      return reply(blockAddressOfRaw(raw));
    }
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }));
}) as typeof fetch;

const { Keyring } = await import('@/background/keyring');

const PASSWORD = 'correct horse battery';

describe('keyring', () => {
  let kr = new Keyring();

  it('creates a vault from a generated mnemonic', async () => {
    const mnemonic = kr.generateMnemonic();
    expect(mnemonic.split(' ')).toHaveLength(12);
    await kr.createVault(PASSWORD, mnemonic, false);
    const st = await kr.state();
    expect(st.initialized).toBe(true);
    expect(st.unlocked).toBe(true);
    expect(st.accounts).toHaveLength(1);
    expect(st.needsBackup).toBe(true);
    expect(JSON.stringify(local.dump())).not.toContain(mnemonic.split(' ')[0] + ' ' + mnemonic.split(' ')[1]);
  });

  it('survives a service worker restart via the session key, and locks', async () => {
    kr = new Keyring();
    expect((await kr.state()).unlocked).toBe(true);
    await kr.lock();
    kr = new Keyring();
    expect((await kr.state()).unlocked).toBe(false);
    await expect(kr.unlock('wrong password')).rejects.toThrow('Incorrect password');
    const st = await kr.unlock(PASSWORD);
    expect(st.unlocked).toBe(true);
  });

  it('adds HD accounts on m/44\'/586\'/0\'/0/i', async () => {
    await kr.addHdAccount();
    const st = await kr.state();
    expect(st.accounts.map((a) => a.hdIndex)).toEqual([0, 1]);
  });

  it('imports a 2018 legacy wallet (wallet.dat + dnet_key.dat)', async () => {
    const v = legacyVectors[0]!;
    await expect(
      kr.previewImport({
        kind: 'legacy',
        walletDat: { name: 'wallet.dat', data: v.walletDat },
        dnetKeyDat: { name: 'dnet_key.dat', data: v.dnetKeyDat },
        filePassword: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'wrong_file_password' });
    const preview = await kr.previewImport({
      kind: 'legacy',
      walletDat: { name: 'wallet.dat', data: v.walletDat },
      dnetKeyDat: { name: 'dnet_key.dat', data: v.dnetKeyDat },
      filePassword: v.password,
    });
    expect(preview.passwordVerified).toBe(true);
    expect(preview.accounts).toHaveLength(3);
    const expected = [...v.privateKeys].reverse().map((h) => encodeAddress(decodeAddress(addrOf(h))));
    expect(preview.accounts.map((a) => a.address)).toEqual(expected);
    await kr.commitImport({ token: preview.token, addresses: expected, legacyBlocks: ['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3'] });
    const st = await kr.state();
    const legacy = st.accounts.filter((a) => a.source === 'legacy');
    expect(legacy).toHaveLength(3);
    expect(legacy[0]!.legacyBlocks).toEqual(['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3']);
    expect(await kr.exportPrivateKey(legacy[1]!.id, PASSWORD)).toBe(v.privateKeys[1]);
  });

  it('attaches old addresses found in the storage folder to the accounts of their owning keys', async () => {
    const v = legacyVectors[0]!;
    const preview = await kr.previewImport({
      kind: 'legacy',
      walletDat: { name: 'wallet.dat', data: v.walletDat },
      dnetKeyDat: { name: 'dnet_key.dat', data: v.dnetKeyDat },
      filePassword: v.password,
    });
    // the preview exposes the public keys the storage scan needs (default key first)
    expect(preview.accounts.map((a) => a.publicKey)).toEqual([...v.privateKeys].reverse().map((h) => toHex(getPublicKey(fromHex(h)))));
    expect(preview.accounts.every((a) => a.alreadyExists)).toBe(true);
    const [def, mid] = preview.accounts;
    await expect(
      kr.commitImport({ token: preview.token, addresses: [], ownedBlocks: [{ block: 'Wjvq3/JkRUom0LtTE/uyAa4V7ipvqDyK', owner: addrOf('11'.repeat(32)) }] }),
    ).rejects.toMatchObject({ code: 'invalid_block_address' });
    await expect(kr.commitImport({ token: preview.token, addresses: [], ownedBlocks: [{ block: 'not-a-block', owner: mid!.address }] })).rejects.toMatchObject({
      code: 'invalid_block_address',
    });
    await expect(kr.commitImport({ token: preview.token, addresses: [] })).rejects.toMatchObject({ code: 'nothing_to_import' });
    // the wallet was imported before (previous test): the blocks are merged into those accounts
    await kr.commitImport({
      token: preview.token,
      addresses: [],
      ownedBlocks: [
        { block: 'Wjvq3/JkRUom0LtTE/uyAa4V7ipvqDyK', owner: mid!.address },
        { block: 'uotbpDiYMURy7SbX2VoJTpyIo9GvZGkr', owner: def!.address },
        { block: 'oumX+GaqhVixMUBFIazAgtzfBqCXOg1U', owner: def!.address },
      ],
    });
    const st = await kr.state();
    const byAddr = (a: string) => st.accounts.find((x) => x.address === a)!;
    expect(byAddr(def!.address).legacyBlocks).toEqual(['gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3', 'uotbpDiYMURy7SbX2VoJTpyIo9GvZGkr', 'oumX+GaqhVixMUBFIazAgtzfBqCXOg1U']);
    expect(byAddr(mid!.address).legacyBlocks).toEqual(['Wjvq3/JkRUom0LtTE/uyAa4V7ipvqDyK']);
    expect(st.selectedAccountId).toBe(byAddr(mid!.address).id);
    expect(st.accounts.filter((a) => a.source === 'legacy')).toHaveLength(3);
  });

  it('caps the old addresses per account', async () => {
    const v = legacyVectors[0]!;
    const preview = await kr.previewImport({
      kind: 'legacy',
      walletDat: { name: 'wallet.dat', data: v.walletDat },
      dnetKeyDat: { name: 'dnet_key.dat', data: v.dnetKeyDat },
      filePassword: v.password,
    });
    const many = Array.from({ length: 60 }, (_, i) => encodeLegacyAddress(sha256d(Uint8Array.of(i)).subarray(0, 24)));
    await expect(
      kr.commitImport({ token: preview.token, addresses: [], ownedBlocks: many.map((block) => ({ block, owner: preview.accounts[2]!.address })) }),
    ).rejects.toMatchObject({ code: 'too_many_blocks' });
    kr.cancelImport(preview.token);
  });

  it('imports an xdagj wallet.data including its mnemonic', async () => {
    const w = xdagjVectors.walletFiles[0]!;
    const preview = await kr.previewImport({ kind: 'xdagj', file: { name: 'wallet.data', data: w.file }, filePassword: w.password });
    expect(preview.hasMnemonic).toBe(true);
    expect(preview.accounts.map((a) => a.address).sort()).toEqual(w.accounts.map((a) => a.address).sort());
    expect(preview.accounts.filter((a) => a.hdIndex !== undefined)).toHaveLength(2);
    await kr.commitImport({ token: preview.token, addresses: preview.accounts.map((a) => a.address) });
    const st = await kr.state();
    expect(st.accounts.filter((a) => a.source === 'xdagj')).toHaveLength(3);
  });

  it('signs and broadcasts a nonce transfer', async () => {
    const st = await kr.state();
    const from = st.accounts[0]!;
    const to = st.accounts[1]!.address;
    node.balances.set(from.address, parseXdag('100'));
    node.nonces.set(from.address, 7n);
    await expect(kr.send({ accountId: from.id, to, amount: parseXdag('1000').toString(), fee: '0', remark: '' })).rejects.toMatchObject({ code: 'insufficient_funds' });
    await expect(kr.send({ accountId: from.id, to, amount: parseXdag('0.1').toString(), fee: '0', remark: '' })).rejects.toMatchObject({ code: 'amount_below_fee' });
    const res = await kr.send({ accountId: from.id, to, amount: parseXdag('12.5').toString(), fee: parseXdag('0.2').toString(), remark: 'hi' });
    const raw = node.sent.at(-1)!.raw;
    expect(res.blockAddress).toBe(blockAddressOfRaw(raw));
    const blk = parseBlock(raw);
    expect(blk.valid).toBe(true);
    expect([0, 1, 2, 3, 4].map(blk.nib)).toEqual([1, 0xe, 0xc, 0xd, 9]);
    expect(readU64le(blk.fields[0]!, 24)).toBe(parseXdag('0.2'));
    expect(readU64le(blk.fields[1]!, 24)).toBe(7n);
    expect(readU64le(blk.fields[3]!, 24)).toBe(nanoToCheato(parseXdag('12.5')));
    expect(encodeAddress(Uint8Array.from(blk.fields[3]!.subarray(4, 24)).reverse())).toBe(to);
    const pending = await local.get('pending');
    expect((pending as any).pending[0].blockAddress).toBe(res.blockAddress);
  });

  it('refuses to sign for a node on the wrong network', async () => {
    const st = await kr.state();
    node.netType = 'testnet';
    try {
      await expect(
        kr.send({ accountId: st.accounts[0]!.id, to: st.accounts[1]!.address, amount: parseXdag('1').toString(), fee: '0', remark: '' }),
      ).rejects.toMatchObject({ code: 'network_mismatch' });
    } finally {
      node.netType = 'mainnet';
    }
  });

  it('migrates a legacy block balance, trying every key of the wallet', async () => {
    const st = await kr.state();
    const legacy = st.accounts.filter((a) => a.source === 'legacy');
    const block = 'gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3';
    node.balances.set(block, parseXdag('50'));
    // the block belongs to the 3rd key of the file
    node.rejectUnlessOwner = toHex(getPublicKey(fromHex(legacyVectors[0]!.privateKeys[2]!)));
    const res = await kr.sendLegacy({ accountId: legacy[0]!.id, fromBlock: block, to: legacy[0]!.address, amount: parseXdag('50').toString(), remark: '' });
    const blk = parseBlock(node.sent.at(-1)!.raw);
    expect([0, 1, 2, 3].map(blk.nib)).toEqual([1, 2, 0xd, 7 - (blk.pub[0] === 2 ? 1 : 0)]);
    expect(encodeLegacyAddress(blk.fields[1]!.subarray(0, 24))).toBe(block);
    expect(res.blockAddress).toHaveLength(32);
    node.rejectUnlessOwner = toHex(getPublicKey(fromHex(xdagjVectors.walletFiles[0]!.accounts[0]!.privateKey)));
    await expect(
      kr.sendLegacy({ accountId: legacy[0]!.id, fromBlock: block, to: legacy[0]!.address, amount: parseXdag('5').toString(), remark: '' }),
    ).rejects.toMatchObject({ code: 'block_not_owned' });
    node.rejectUnlessOwner = null;
  });

  it('exports an xdagj-compatible wallet.data with every key', async () => {
    const st = await kr.state();
    const { file, count } = await kr.exportXdagjWallet(PASSWORD, 'file-pass');
    expect(count).toBe(st.accounts.length);
    const res = decryptXdagjWallet(fromBase64(file), 'file-pass');
    expect(res.mnemonic.split(' ')).toHaveLength(12);
    const addrs = res.privateKeys.map((k) => addrOf(toHex(k))).sort();
    expect(addrs).toEqual(st.accounts.map((a) => a.address).sort());
  }, 120_000);

  it('never reports an ambiguous broadcast as a failure', async () => {
    const st = await kr.state();
    const from = st.accounts[0]!;
    const to = st.accounts[1]!.address;
    for (const mode of ['http500', 'wrongAddress'] as const) {
      node.sendMode = mode;
      try {
        await expect(kr.send({ accountId: from.id, to, amount: parseXdag('2').toString(), fee: '0', remark: '' })).rejects.toMatchObject({
          code: 'broadcast_unknown',
        });
      } finally {
        node.sendMode = 'ok';
      }
      const pending = ((await local.get('pending')) as any).pending;
      expect(pending[0].uncertain).toBe(true);
      expect(pending[0].blockAddress).toHaveLength(32);
    }
  });

  it('refuses to sign when the node network cannot be confirmed', async () => {
    const st = await kr.state();
    node.netTypeError = true;
    try {
      await expect(
        kr.send({ accountId: st.accounts[0]!.id, to: st.accounts[1]!.address, amount: parseXdag('1').toString(), fee: '0', remark: '' }),
      ).rejects.toMatchObject({ code: 'network_unverified' });
    } finally {
      node.netTypeError = false;
    }
  });

  it('rejects malformed or out-of-range amounts in the background', async () => {
    const st = await kr.state();
    const base = { accountId: st.accounts[0]!.id, to: st.accounts[1]!.address, fee: '0', remark: '' };
    for (const amount of ['-5', '1e9', '12.5', '99999999999999999999999']) {
      await expect(kr.send({ ...base, amount })).rejects.toMatchObject({ code: 'invalid_amount' });
    }
  });

  it('bounds the account index read from a crafted xdagj wallet.data', async () => {
    const { encryptXdagjWallet } = await import('@/core/xdagj-wallet');
    const file = encryptXdagjWallet(
      { privateKeys: [fromHex(xdagjVectors.walletFiles[0]!.accounts[0]!.privateKey)], mnemonic: xdagjVectors.walletFiles[0]!.mnemonic, nextAccountIndex: 0x7fffffff },
      'crafted',
    );
    const started = Date.now();
    const preview = await kr.previewImport({ kind: 'xdagj', file: { name: 'wallet.data', data: toBase64(file) }, filePassword: 'crafted' });
    expect(Date.now() - started).toBeLessThan(20_000);
    kr.cancelImport(preview.token);
  }, 60_000);

  it('keeps the vault openable when writes race a password change', async () => {
    const st = await kr.state();
    const id = st.accounts[0]!.id;
    await Promise.all([
      kr.changePassword(PASSWORD, 'raced password 1'),
      kr.renameAccount(id, 'renamed during change'),
      kr.selectAccount(st.accounts[1]!.id),
      kr.renameAccount(id, 'renamed again'),
    ]);
    await kr.lock();
    const fresh = new Keyring();
    const after = await fresh.unlock('raced password 1');
    expect(after.accounts.find((a) => a.id === id)!.name).toBe('renamed again');
    await kr.unlock('raced password 1');
    await kr.changePassword('raced password 1', PASSWORD);
  });

  it('does not come back unlocked when lock() races a restore', async () => {
    const restarted = new Keyring(); // service worker restart: memory empty, session key present
    const restoring = restarted.state();
    await restarted.lock();
    await restoring;
    expect((await restarted.state()).unlocked).toBe(false);
    kr = new Keyring();
    await kr.unlock(PASSWORD);
  });

  it('serialises password guesses so the rate limit holds', async () => {
    await kr.lock();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => kr.unlock('bad guess')));
    const codes = results.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'wrong_password')).toHaveLength(5);
    expect(codes.filter((c) => c === 'rate_limited')).toHaveLength(3);
    const failures = ((await local.get('unlockFailures')) as any).unlockFailures;
    expect(failures.count).toBe(5);
    await local.remove('unlockFailures');
    kr = new Keyring(); // fresh memory counter
    await kr.unlock(PASSWORD);
  }, 120_000);

  it('requires the password to reset an unlocked wallet', async () => {
    await expect(kr.reset()).rejects.toMatchObject({ code: 'wrong_password' });
    await expect(kr.reset('nope nope nope')).rejects.toMatchObject({ code: 'wrong_password' });
    expect((await kr.state()).initialized).toBe(true);
  });

  it('changes the password', async () => {
    await kr.changePassword(PASSWORD, 'another password');
    await kr.lock();
    await expect(kr.unlock(PASSWORD)).rejects.toThrow();
    await kr.unlock('another password');
  });
});

describe('old address import edge cases', () => {
  const v = legacyVectors[0]!;
  const legacyPreview = (kr: InstanceType<typeof Keyring>) =>
    kr.previewImport({ kind: 'legacy', walletDat: { name: 'wallet.dat', data: v.walletDat }, dnetKeyDat: { name: 'dnet_key.dat', data: v.dnetKeyDat }, filePassword: v.password });
  const many = (n: number, salt: number) => Array.from({ length: n }, (_, i) => encodeLegacyAddress(sha256d(Uint8Array.of(salt, i)).subarray(0, 24)));

  it('a rejected first import does not leave an empty wallet behind', async () => {
    await local.clear();
    await session.clear();
    const kr = new Keyring();
    const preview = await legacyPreview(kr);
    await expect(
      kr.commitImport({
        token: preview.token,
        addresses: preview.accounts.map((a) => a.address),
        newVaultPassword: PASSWORD,
        ownedBlocks: many(51, 1).map((block) => ({ block, owner: preview.accounts[0]!.address })),
      }),
    ).rejects.toMatchObject({ code: 'too_many_blocks', message: '50' });
    expect((await kr.state()).initialized).toBe(false);
    expect(local.dump().vault).toBeUndefined();
    // the same staged import still commits once the selection is valid
    await kr.commitImport({
      token: preview.token,
      addresses: [preview.accounts[1]!.address],
      newVaultPassword: PASSWORD,
      ownedBlocks: many(3, 2).map((block) => ({ block, owner: preview.accounts[1]!.address })),
    });
    const st = await kr.state();
    expect(st.accounts).toHaveLength(1);
    expect(st.accounts[0]!.legacyBlocks).toHaveLength(3);
  });

  it('typed addresses go to an existing account of the wallet when no new account is chosen', async () => {
    const kr = new Keyring();
    const preview = await legacyPreview(kr); // key #2 exists (previous test), the default key does not
    const [typedOne] = many(1, 3);
    const found = many(1, 2)[0]!; // already attached to key #2
    await kr.commitImport({ token: preview.token, addresses: [], legacyBlocks: [typedOne!, found], ownedBlocks: [{ block: found, owner: preview.accounts[1]!.address }] });
    const st = await kr.state();
    expect(st.accounts).toHaveLength(1);
    expect(st.accounts[0]!.legacyBlocks).toContain(typedOne);
    expect(st.accounts[0]!.legacyBlocks.filter((b) => b === found)).toHaveLength(1);
  });

  it('a typed address that was also found stays with the key that owns it', async () => {
    const kr = new Keyring();
    const preview = await legacyPreview(kr);
    const [block] = many(1, 4);
    // the default key is new and chosen first, but the block was found under key #2
    await kr.commitImport({
      token: preview.token,
      addresses: [preview.accounts[0]!.address],
      legacyBlocks: [block!],
      ownedBlocks: [{ block: block!, owner: preview.accounts[1]!.address }],
    });
    const st = await kr.state();
    expect(st.accounts.find((a) => a.address === preview.accounts[1]!.address)!.legacyBlocks).toContain(block);
    expect(st.accounts.find((a) => a.address === preview.accounts[0]!.address)!.legacyBlocks).not.toContain(block);
  });
});

import { privateKeyToAddress } from '@/core/keys';
function addrOf(privHex: string): string {
  return privateKeyToAddress(fromHex(privHex));
}
