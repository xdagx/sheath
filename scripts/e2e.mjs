// End-to-end test: loads the built extension (dist/) into Chromium, drives the UI with
// Playwright against scripts/mock-node.mjs and checks what the node received.
//
//   npm run build && node scripts/e2e.mjs [--shots docs/screenshots]
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { createBase58check } from '@scure/base';
import { createMockNode } from './mock-node.mjs';
import { pickFolder } from './pick-folder.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright'));
} catch {
  console.error('Playwright is not installed (it is not a package.json dependency).\n' +
    'Run: npm i --no-save -D playwright && npx playwright install chromium\n' +
    'or set PLAYWRIGHT_MODULE to an existing playwright module directory.');
  process.exit(1);
}

const shotsArg = process.argv.indexOf('--shots');
const SHOTS = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b58 = createBase58check(sha256);
const addrOf = (privHex) => b58.encode(ripemd160(sha256(secp256k1.getPublicKey(Buffer.from(privHex, 'hex'), true))));
const pubHex = (privHex) => Buffer.from(secp256k1.getPublicKey(Buffer.from(privHex, 'hex'), true)).toString('hex');

const legacy = JSON.parse(readFileSync('tests/fixtures/legacy-vectors.json', 'utf8'))[0];
const K1 = legacy.privateKeys[0];
const K2 = legacy.privateKeys[1];
const K3 = legacy.privateKeys[2];
const DEST = addrOf('8c1b2a3f4e5d6c7b8a99a8b7c6d5e4f3021324354657687980a1b2c3d4e5f607');
const OLD_BLOCK = 'gKNRtSL1pUaTpzMuPMznKw49ILtP6qX3';
const PASSWORD = 'e2e-password-123';

// ---- mock node
// blocks of the same wallet in a storage/ folder written by the official C client code
const storageVectors = JSON.parse(readFileSync('tests/fixtures/legacy-storage/expected.json', 'utf8'));
const blockNamed = (n) => storageVectors.blocks.find((b) => b.name === n).address;
const MIDDLE_BLOCK = blockNamed('address_middle'); // owned by K2
const DEFAULT_BLOCK = blockNamed('address_default_lowS'); // owned by K3, the default key
const node = createMockNode({
  fund: { [addrOf(K1)]: 1000, [OLD_BLOCK]: 250.5, [MIDDLE_BLOCK]: 77.7, [DEFAULT_BLOCK]: 12 },
  legacyOwners: { [OLD_BLOCK]: pubHex(K2), [MIDDLE_BLOCK]: pubHex(K2), [DEFAULT_BLOCK]: pubHex(K3) },
});
await new Promise((r) => node.server.listen(0, '127.0.0.1', r));
const RPC = `http://127.0.0.1:${node.server.address().port}`;

// ---- extension copy with host access to the mock node (avoids an interactive permission prompt)
const work = mkdtempSync(join(tmpdir(), 'xdag-e2e-'));
const ext = join(work, 'ext');
cpSync('dist', ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(work, 'wallet.dat'), Buffer.from(legacy.walletDat, 'base64'));
writeFileSync(join(work, 'dnet_key.dat'), Buffer.from(legacy.dnetKeyDat, 'base64'));
// an old client folder: wallet files next to storage/ and storage-testnet/
const oldFolder = join(work, 'xdag-2018');
cpSync('tests/fixtures/legacy-storage', oldFolder, { recursive: true, filter: (p) => !p.endsWith('expected.json') });
cpSync(join(work, 'wallet.dat'), join(oldFolder, 'wallet.dat'));
cpSync(join(work, 'dnet_key.dat'), join(oldFolder, 'dnet_key.dat'));

const errors = [];
async function launch(name) {
  const ctx = await chromium.launchPersistentContext(join(work, `profile-${name}`), {
    channel: 'chromium',
    locale: 'en-US',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--lang=en-US'],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.setViewportSize({ width: 900, height: 820 });
  return { ctx, page, base: `chrome-extension://${id}` };
}

async function shot(page, name) {
  if (!SHOTS) return;
  await page.waitForTimeout(450); // let view / sheet transitions settle
  await page.locator('#app').screenshot({ path: join(SHOTS, `${name}.png`) });
}

const step = (s) => console.log(`• ${s}`);
let current = null; // page used for a failure screenshot

try {
  // ======================================================= create a new wallet
  {
    const { ctx, page, base } = await launch('create');
    await page.goto(`${base}/app.html#/welcome`);
    await page.getByText('Create a new wallet').waitFor();
    await shot(page, '01-welcome');
    step('create: password');
    await page.getByText('Create a new wallet').click();
    await page.getByLabel('New password').fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.locator('.checkbox').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    step('create: reveal and confirm phrase');
    await page.locator('.phrase').click();
    const words = await page.$$eval('.phrase-w', (els) => els.map((e) => e.textContent));
    assert.equal(words.length, 12);
    await shot(page, '02-phrase');
    await page.getByRole('button', { name: "I've written it down" }).click();
    for (const q of await page.locator('.quiz').all()) {
      const n = Number((await q.locator('.field-label').textContent()).match(/\d+/)[0]);
      await q.getByRole('button', { name: words[n - 1], exact: true }).first().click();
    }
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.locator('.balance-card').waitFor();
    step('create: home reached, no backup banner');
    assert.equal(await page.locator('.banner').count(), 0);
    await ctx.close();
  }

  // ======================================================= imports + transfers
  const { ctx, page, base } = await launch('main');
  current = page;
  await page.goto(`${base}/app.html#/welcome`);
  step('import private key during onboarding');
  await page.getByText('Import a wallet').click();
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.locator('.checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('tab', { name: 'Private key' }).click();
  await page.getByLabel('Private key (hex)').fill(K1);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Import 1 account/).click();
  await page.locator('.balance-card').waitFor();

  step('add the local node as a custom network');
  await page.goto(`${base}/app.html#/settings/networks`);
  await page.getByRole('button', { name: 'Add custom node' }).click();
  await page.getByLabel('Name').fill('Local node');
  await page.getByLabel('RPC URL').fill(RPC);
  await page.getByRole('button', { name: 'Test connection' }).click();
  await page.getByText(/Connected to mainnet/).waitFor();
  await shot(page, '08-network');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto(`${base}/app.html#/home`);
  await page.locator('.balance-value', { hasText: '1,000' }).waitFor();
  await shot(page, '03-home');

  step('send 12.5 XDAG with remark and priority fee');
  await page.getByRole('button', { name: 'Send' }).first().click();
  await page.getByLabel('To').fill(DEST);
  await page.getByLabel('Amount').fill('12.5');
  await page.getByLabel(/Remark/).fill('hello e2e');
  await page.getByRole('switch', { name: 'Priority fee' }).click();
  await page.locator('.fee-box input').fill('0.2');
  await page.getByText('12.2 XDAG').waitFor(); // recipient receives 12.5 - 0.1 - 0.2
  await shot(page, '04-send');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & send' }).waitFor();
  await shot(page, '05-review');
  await page.getByRole('button', { name: 'Confirm & send' }).click();
  await page.getByText('Transaction sent').waitFor();
  await shot(page, '06-sent');
  const tx1 = node.log.at(-1);
  assert.deepEqual(
    { from: tx1.from, to: tx1.to, amount: tx1.amount, fee: tx1.fee, remark: tx1.remark, nonce: tx1.nonce, head: tx1.head },
    { from: addrOf(K1), to: DEST, amount: '12500000000', fee: '300000000', remark: 'hello e2e', nonce: '1', head: 1 },
  );
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.tx-row', { hasText: 'Sent' }).first().waitFor();
  await page.locator('.balance-value', { hasText: '987.5' }).waitFor();
  await shot(page, '07-activity');

  step('second transfer uses the next nonce');
  await page.getByRole('button', { name: 'Send' }).first().click();
  await page.getByLabel('To').fill(DEST);
  await page.getByLabel('Amount').fill('1');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & send' }).click();
  await page.getByText('Transaction sent').waitFor();
  assert.equal(node.log.at(-1).nonce, '2');
  await page.getByRole('button', { name: 'Done' }).click();

  step('receive page');
  await page.getByRole('button', { name: 'Receive' }).first().click();
  await page.locator('.qr').waitFor();
  await shot(page, '09-receive');
  await page.goto(`${base}/app.html#/home`);

  step('import the 2018 wallet.dat + dnet_key.dat');
  await page.goto(`${base}/app.html#/import?tab=legacy`);
  const files = page.locator('.filedrop:not(.folderpick) input[type=file]');
  await files.nth(0).setInputFiles(join(work, 'wallet.dat'));
  await files.nth(1).setInputFiles(join(work, 'dnet_key.dat'));
  await page.getByLabel('Wallet file password').fill('wrong');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Wrong password for this wallet file').waitFor();
  await page.getByLabel('Wallet file password').fill(legacy.password);
  await shot(page, '10-legacy-import');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Select accounts').waitFor();
  assert.equal(await page.locator('.select-row').count(), 3);
  assert.equal(await page.locator('.select-row.disabled').count(), 1); // K1 already imported
  await page.getByLabel('Old wallet addresses').fill(OLD_BLOCK);
  await shot(page, '11-legacy-preview');
  await page.getByText(/Import 2 account/).click();
  await page.locator('.legacy-row').waitFor();
  await page.locator('.legacy-row', { hasText: '250.5' }).waitFor();
  await shot(page, '12-legacy-home');

  step('move the old block balance (key discovery: default key is not the owner)');
  await page.locator('.legacy-row').getByRole('button', { name: 'Move' }).click();
  await page.getByLabel('Amount').waitFor();
  await page.waitForFunction(() => document.querySelector('input[inputmode=decimal]')?.value === '250.5');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & send' }).click();
  await page.getByText('Transaction sent').waitFor();
  const tx3 = node.log.at(-1);
  assert.equal(tx3.from, OLD_BLOCK);
  assert.equal(tx3.to, addrOf(K3)); // default key of the old wallet
  assert.equal(tx3.nonce, undefined);
  assert.equal(tx3.amount, '250500000000');
  await page.getByRole('button', { name: 'Done' }).click();

  step('old client folder: addresses found in storage/ and attached to their keys');
  await page.goto(`${base}/app.html#/import?tab=legacy`);
  await pickFolder(page.locator('.folderpick input[type=file]'), oldFolder);
  await page.getByText(/block file\(s\) from storage\/ found/).waitFor();
  await page.getByLabel('Wallet file password').fill(legacy.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Select accounts').waitFor();
  const owned = storageVectors.blocks.filter((b) => b.owner >= 0);
  await page.locator('.found-blocks .select-row').nth(owned.length - 1).waitFor();
  assert.equal(await page.locator('.found-blocks .select-row').count(), owned.length);
  // pre-selected: the blocks the node knows with a balance; unknown and testnet ones are not
  await page.getByRole('button', { name: 'Add 2 old address(es)' }).waitFor();
  assert.equal(await page.locator('.found-blocks .select-row', { hasText: 'Not on this node' }).count(), owned.length - 3);
  assert.equal(await page.locator('.found-blocks .select-row', { hasText: 'Other network' }).count(), 1);
  await shot(page, '12b-legacy-folder-preview');
  await page.getByRole('button', { name: 'Add 2 old address(es)' }).click();
  await page.locator('.legacy-row', { hasText: DEFAULT_BLOCK.slice(0, 8) }).waitFor();
  await page.locator('.legacy-row', { hasText: '12 XDAG' }).waitFor();
  await page.locator('.account-chip').click();
  await page.locator('.account-item', { hasText: 'Legacy 2' }).click();
  await page.locator('.legacy-row', { hasText: MIDDLE_BLOCK.slice(0, 8) }).getByRole('button', { name: 'Move' }).click();
  await page.waitForFunction(() => document.querySelector('input[inputmode=decimal]')?.value === '77.7');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Confirm & send' }).click();
  await page.getByText('Transaction sent').waitFor();
  const tx4 = node.log.at(-1);
  assert.equal(tx4.from, MIDDLE_BLOCK);
  assert.equal(tx4.to, addrOf(K2));
  await page.getByRole('button', { name: 'Done' }).click();

  step('lock and unlock');
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByText('Welcome back').waitFor();
  await page.getByPlaceholder('Password').fill('nope-nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Incorrect password').waitFor();
  await shot(page, '13-unlock');
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.balance-card').waitFor();

  step('popup view + light theme + Chinese');
  const popup = await ctx.newPage();
  popup.on('pageerror', (e) => errors.push(`[popup] ${e.message}`));
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.goto(`${base}/popup.html#/home`);
  await popup.locator('.balance-card').waitFor();
  await popup.waitForTimeout(500);
  await popup.screenshot({ path: SHOTS ? join(SHOTS, '14-popup-dark.png') : join(work, 'p.png') });
  await popup.locator('.account-chip').click();
  await popup.waitForTimeout(500);
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, '16-popup-accounts-dark.png') });
  await popup.keyboard.press('Escape');
  await popup.goto(`${base}/popup.html#/send`);
  await popup.getByLabel('Amount').waitFor();
  await popup.waitForTimeout(500);
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, '17-popup-send-dark.png') });
  await popup.goto(`${base}/popup.html#/settings`);
  await popup.getByRole('tab', { name: 'Light' }).click();
  await popup.getByText('Language').click();
  await popup.getByRole('button', { name: '简体中文' }).click();
  await popup.goto(`${base}/popup.html#/home`);
  await popup.getByText('交易记录').waitFor();
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: SHOTS ? join(SHOTS, '15-popup-light-zh.png') : join(work, 'p2.png') });

  step('export xdagj wallet.data');
  await page.goto(`${base}/app.html#/settings`);
  await page.getByText('导出 xdagj wallet.data').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByLabel('当前密码').fill(PASSWORD);
      await page.getByLabel('文件密码').fill('file-pass-1');
      await page.getByLabel('确认密码').fill('file-pass-1');
      await page.locator('.sheet .btn-primary').click();
    })(),
  ]);
  const exported = readFileSync(await download.path());
  assert.equal(exported.readInt32BE(0), 4);
  step(`exported wallet.data (${exported.length} bytes)`);

  step('wallet built from imported keys only: "Create account" creates a recovery phrase');
  await page.goto(`${base}/app.html#/home`);
  await page.locator('.account-chip').click();
  await page.locator('.account-item').first().waitFor();
  const accountsBefore = await page.locator('.account-item').count();
  await page.getByRole('button', { name: '创建账户' }).click();
  await page.getByText('新的助记词').waitFor();
  await shot(page, '18-new-phrase');
  await page.getByRole('button', { name: '稍后提醒我' }).click();
  await page.getByText('你的助记词尚未备份。').waitFor();
  await page.locator('.account-chip', { hasText: '账户 1' }).waitFor();
  // now the wallet has a phrase: the same button adds its next account directly
  await page.locator('.account-chip').click();
  await page.locator('.account-item', { hasText: '账户 1' }).waitFor();
  assert.equal(await page.locator('.account-item').count(), accountsBefore + 1);
  await page.getByRole('button', { name: '创建账户' }).click();
  await page.locator('.account-chip', { hasText: '账户 2' }).waitFor();

  await ctx.close();
  const relevant = errors.filter((e) => !/Failed to load resource|ERR_/.test(e));
  if (relevant.length) {
    console.error('Console errors:\n' + relevant.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('\nE2E passed ✔');
  }
} catch (e) {
  if (current && process.env.FAIL_SHOT) await current.screenshot({ path: process.env.FAIL_SHOT, fullPage: true }).catch(() => undefined);
  throw e;
} finally {
  node.server.close();
  rmSync(work, { recursive: true, force: true });
}
