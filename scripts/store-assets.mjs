// Generates Chrome Web Store listing images from the real extension (dist/) driven against the
// mock node: 1280x800 screenshots (en + zh_CN), a 440x280 small promo tile and a 1400x560 marquee.
//
//   npm run build && node scripts/store-assets.mjs [--out store/assets]
//
// Branding (name, taglines) is read from store/brand.json.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : 'store/assets');
mkdirSync(OUT, { recursive: true });
const brand = JSON.parse(readFileSync('store/brand.json', 'utf8'));

const b58 = createBase58check(sha256);
const addrOf = (h) => b58.encode(ripemd160(sha256(secp256k1.getPublicKey(Buffer.from(h, 'hex'), true))));
const pubHex = (h) => Buffer.from(secp256k1.getPublicKey(Buffer.from(h, 'hex'), true)).toString('hex');

const legacy = JSON.parse(readFileSync('tests/fixtures/legacy-vectors.json', 'utf8'))[0];
const MAIN = '8c1b2a3f4e5d6c7b8a99a8b7c6d5e4f3021324354657687980a1b2c3d4e5f607';
const PEER = legacy.privateKeys[0];
// a wallet address block of the old wallet's default key, written by the official C client code
const OLD = JSON.parse(readFileSync('tests/fixtures/legacy-storage/expected.json', 'utf8')).blocks.find((b) => b.name === 'address_default_lowS');
const OLD_BLOCK = OLD.address;
// recipient for the send screenshot: not one of the wallet's own accounts
const STRANGER = '5f0e1d2c3b4a59687766554433221100ffeeddccbbaa99887766554433221101';
const PASSWORD = 'store-assets-pass';

const node = createMockNode({
  fund: { [addrOf(MAIN)]: 12850.42, [addrOf(PEER)]: 5000, [OLD_BLOCK]: 3276.8 },
  legacyOwners: { [OLD_BLOCK]: pubHex(legacy.privateKeys[2]) },
});
await new Promise((r) => node.server.listen(0, '127.0.0.1', r));
const RPC = `http://127.0.0.1:${node.server.address().port}`;

const work = mkdtempSync(join(tmpdir(), 'xdag-store-'));
const ext = join(work, 'ext');
cpSync('dist', ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(work, 'wallet.dat'), Buffer.from(legacy.walletDat, 'base64'));
// the old client folder: wallet files next to storage/AA/BB/CC/DD.dat holding the address block
const oldFolder = join(work, 'xdag');
{
  const t = Buffer.from(OLD.raw, 'hex').readBigUInt64LE(16);
  const hx = (shift) => ((t >> BigInt(shift)) & 0xffn).toString(16).padStart(2, '0');
  const dir = join(oldFolder, 'storage', hx(40), hx(32), hx(24));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${hx(16)}.dat`), Buffer.from(OLD.raw, 'hex'));
  writeFileSync(join(oldFolder, 'wallet.dat'), Buffer.from(legacy.walletDat, 'base64'));
  writeFileSync(join(oldFolder, 'dnet_key.dat'), Buffer.from(legacy.dnetKeyDat, 'base64'));
}
writeFileSync(join(work, 'dnet_key.dat'), Buffer.from(legacy.dnetKeyDat, 'base64'));

const settle = (p) => p.waitForTimeout(550);
const raw = {}; // name -> png buffer

let dbgPage = null;
let dbgPopup = null;
try {
  const ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
    channel: 'chromium',
    locale: 'en-US',
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--lang=en-US'],
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(sw.url()).host}`;
  const page = await ctx.newPage();
  dbgPage = page;
  await page.setViewportSize({ width: 900, height: 820 });

  // ---- onboarding: import the main key, point at the mock node (named "Mainnet" for the shots)
  await page.goto(`${base}/app.html#/welcome`);
  await page.getByText('Import a wallet').click();
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.locator('.checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('tab', { name: 'Private key' }).click();
  await page.getByLabel('Private key (hex)').fill(MAIN);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Import 1 account/).click();
  await page.locator('.balance-card').waitFor();
  await page.goto(`${base}/app.html#/settings/networks`);
  await page.getByRole('button', { name: 'Add custom node' }).click();
  await page.getByLabel('Name').fill('Mainnet');
  await page.getByLabel('RPC URL').fill(RPC);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto(`${base}/app.html#/accounts`);
  await page.locator('.account-item').first().click();
  await page.locator('.account-hero-name').click();
  await page.locator('.rename input').fill('Main');
  await page.getByRole('button', { name: 'Save' }).click();

  // ---- some history: incoming, outgoing
  const send = async (to, amount, remark) => {
    await page.goto(`${base}/app.html#/send`);
    await page.getByLabel('To').fill(to);
    await page.getByLabel('Amount').fill(amount);
    if (remark) await page.getByLabel(/Remark/).fill(remark);
    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Confirm & send' }).click();
    await page.getByText('Transaction sent').waitFor();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.balance-card').waitFor();
  };
  await send(addrOf(PEER), '250', 'coffee');
  await send(addrOf(PEER), '1200.5', 'rent');

  // ---- legacy wallet (tab page: file pickers), captured in both languages before importing
  const setLang = async (p, lang) => {
    await p.goto(`${base}/${p === page ? 'app' : 'popup'}.html#/settings`);
    await p.locator('.row', { hasText: /^(Language|语言)/ }).first().click();
    await p.getByRole('button', { name: lang === 'zh' ? '简体中文' : 'English', exact: true }).click();
  };
  const legacyFlow = async (lang, commit) => {
    const L = lang === 'zh'
      ? { pw: '钱包文件密码', cont: '继续', select: '选择账户', imp: /导入 \d 个账户/ }
      : { pw: 'Wallet file password', cont: 'Continue', select: 'Select accounts', imp: /Import \d account/ };
    await page.goto(`${base}/app.html#/import?tab=legacy`);
    await pickFolder(page.locator('.folderpick input[type=file]'), oldFolder);
    await page.locator('.notice-success').waitFor();
    await page.getByLabel(L.pw).fill(legacy.password);
    await page.locator('.page-body').evaluate((e) => (e.scrollTop = 0));
    await settle(page);
    raw[`legacy-import-${lang}`] = await page.locator('#app').screenshot();
    await page.getByRole('button', { name: L.cont }).click();
    await page.getByText(L.select).waitFor();
    await page.locator('.found-blocks .select-row.on', { hasText: '3,276.8' }).waitFor();
    await settle(page);
    raw[`legacy-preview-${lang}`] = await page.locator('#app').screenshot();
    if (commit) {
      await page.getByText(L.imp).click();
      await page.locator('.legacy-row', { hasText: '3,276.8' }).waitFor();
    } else {
      await page.locator('.page-header .icon-btn').first().click(); // back = cancel the staged import
    }
  };
  await setLang(page, 'zh');
  await legacyFlow('zh', false);
  await setLang(page, 'en');
  await legacyFlow('en', true);


  const popup = await ctx.newPage();
  dbgPopup = popup;
  await popup.setViewportSize({ width: 360, height: 600 });
  const selectAccount = async (name) => {
    await popup.goto(`${base}/popup.html#/home`);
    await popup.locator('.account-chip').click();
    await popup.locator('.account-item', { hasText: name }).first().locator('.account-item-name').click();
    await popup.locator('.account-chip', { hasText: name }).waitFor();
  };
  const capture = async (lang, mainName) => {
    await selectAccount(mainName);
    await popup.locator('.tx-row').first().waitFor();
    await settle(popup);
    raw[`home-${lang}`] = await popup.screenshot();
    await popup.locator('.account-chip').click();
    await settle(popup);
    raw[`accounts-${lang}`] = await popup.screenshot();
    await popup.keyboard.press('Escape');
    // the send form with its fee breakdown is taller than the popup: capture the full-page view
    await page.goto(`${base}/app.html#/send?to=${encodeURIComponent(addrOf(STRANGER))}`);
    await page.reload();
    await page.getByText(mainName).first().waitFor();
    await page.locator('input[inputmode=decimal]').first().fill('88.8');
    await page.locator('.field input').nth(2).fill('thanks');
    await settle(page);
    raw[`send-${lang}`] = await page.locator('#app').screenshot();
    await popup.goto(`${base}/popup.html#/receive`);
    await popup.locator('.qr').waitFor();
    await settle(popup);
    raw[`receive-${lang}`] = await popup.screenshot();
  };
  await capture('en', 'Main');

  // legacy account home (migrate card)
  await selectAccount('Legacy 1');
  await popup.locator('.legacy-row', { hasText: '3,276.8' }).waitFor();
  await settle(popup);
  raw['legacy-home-en'] = await popup.screenshot();

  // ---- Chinese: switch the UI and localise the demo data (account and node names)
  await setLang(popup, 'zh');
  const renameAccount = async (from, to) => {
    await page.goto(`${base}/app.html#/accounts`);
    await page.locator('.account-item', { hasText: from }).first().locator('.account-item-name').click();
    await page.locator('.account-hero-name').click();
    await page.locator('.rename input').fill(to);
    await page.getByRole('button', { name: '保存' }).click();
    await page.locator('.account-hero-name', { hasText: to }).waitFor();
  };
  await page.goto(`${base}/app.html#/accounts`);
  await page.reload(); // same-document hash navigation would keep the English UI
  await renameAccount('Main', '主账户');
  for (const n of [1, 2, 3]) await renameAccount(`Legacy ${n}`, `旧钱包 ${n}`);
  await page.goto(`${base}/app.html#/settings/networks`);
  await page.locator('.net-row', { hasText: RPC }).getByRole('button', { name: '编辑' }).click();
  await page.getByLabel('名称').fill('主网');
  await page.getByRole('button', { name: '保存' }).click();
  await page.locator('.net-row', { hasText: RPC }).locator('.row-title', { hasText: /^主网/ }).waitFor();
  await selectAccount('旧钱包 1');
  await popup.locator('.legacy-row').waitFor();
  await settle(popup);
  raw['legacy-home-zh'] = await popup.screenshot();
  await capture('zh', '主账户');

  // lock screen
  await popup.goto(`${base}/popup.html#/home`);
  await popup.getByRole('button', { name: '锁定' }).first().click();
  await popup.getByText('欢迎回来').waitFor();
  await settle(popup);
  raw['unlock-zh'] = await popup.screenshot();
  await ctx.close();

  // ---- compose marketing frames
  const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const logo = b64(readFileSync('public/icons/icon-128.png'));
  const frames = {
    en: [
      { shot: ['home-en'], title: 'Your XDAG, kept close', sub: 'Balance, activity and accounts at a glance. Open source, dark & light themes, English & 中文.' },
      { shot: ['legacy-import-en', 'legacy-home-en'], title: 'Rescue your 2018 XDAG wallet', sub: 'Choose the old wallet folder: your old addresses and balances are found automatically, ready to move to your new address.' },
      { shot: ['send-en'], title: 'Clear fees, no surprises', sub: 'See exactly what the recipient receives before you sign. Nonce and network are checked for you.' },
      { shot: ['accounts-en', 'legacy-preview-en'], title: 'Every XDAG wallet format', sub: 'Recovery phrase, private key, xdagj wallet.data and 2018 wallet.dat — plus export to wallet.data.' },
      { shot: ['receive-en'], title: 'Keys never leave your device', sub: 'Encrypted vault, auto-lock, no tracking, no remote code. Open source.' },
    ],
    zh: [
      { shot: ['home-zh'], title: '你的 XDAG，稳稳藏好', sub: '余额、交易记录、多账户一目了然。开源，深浅主题，中英文界面。' },
      { shot: ['legacy-import-zh', 'legacy-home-zh'], title: '找回 2018 年的 XDAG 老钱包', sub: '选择老钱包文件夹，自动找到旧地址和余额，一键转到新地址。' },
      { shot: ['send-zh'], title: '手续费清清楚楚', sub: '签名前就能看到对方实收金额；nonce 与网络由钱包自动校验。' },
      { shot: ['accounts-zh', 'legacy-preview-zh'], title: '新老钱包格式全兼容', sub: '助记词、私钥、xdagj wallet.data、2018 wallet.dat，并可导出 wallet.data。' },
      { shot: ['unlock-zh', 'receive-zh'], title: '私钥只在你的设备上', sub: '本地加密金库、自动锁定、无追踪、无远程代码，开源可审计。' },
    ],
  };

  const browser = await chromium.launch();
  const render = async (html, w, h, path) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0}
      body{width:${w}px;height:${h}px;overflow:hidden;font-family:-apple-system,'Segoe UI','PingFang SC','Noto Sans CJK SC','Microsoft YaHei',Roboto,sans-serif;color:#eef1f7;
        background:radial-gradient(900px 600px at 0% 0%,rgba(30,167,236,.35),transparent 60%),radial-gradient(900px 700px at 100% 100%,rgba(107,92,255,.38),transparent 60%),#0c0f16}
      .brand{display:flex;align-items:center;gap:12px;font-weight:700}
      .brand img{border-radius:22%}
      .shot{border-radius:22px;box-shadow:0 30px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);display:block}
    </style></head><body>${html}</body></html>`);
    await p.waitForTimeout(150);
    await p.screenshot({ path });
    await p.close();
  };

  for (const [lang, list] of Object.entries(frames)) {
    let i = 1;
    for (const f of list) {
      const shots = f.shot.map((k) => raw[k]).filter(Boolean);
      const imgs = shots
        .map((s, j) => {
          // full-page (420x760) captures are shown a little larger when they are the only device
          const isTab = /^(legacy-import|legacy-preview|send)-/.test(f.shot[j]);
          const hgt = isTab && shots.length === 1 ? 680 : 600;
          return `<img class="shot" src="${b64(s)}" style="height:${hgt}px;${shots.length > 1 && j === 0 ? 'transform:translateY(-18px)' : 'transform:translateY(18px)'}">`;
        })
        .join('');
      await render(
        `<div style="display:flex;height:100%;align-items:center;padding:0 80px;gap:56px">
           <div style="flex:1;min-width:0">
             <div class="brand" style="font-size:24px;margin-bottom:40px"><img src="${logo}" width="48" height="48"><div style="display:flex;flex-direction:column;gap:2px">${lang === 'zh' ? brand.nameZh : brand.name}<span style="font-weight:500;color:#9aa4b6;font-size:16px;white-space:nowrap">${lang === 'zh' ? brand.descriptorZh : brand.descriptorEn}</span></div></div>
             <h1 style="font-size:${lang === 'zh' ? 50 : 48}px;line-height:1.15;letter-spacing:-.02em;font-weight:800">${f.title}</h1>
             <p style="margin-top:22px;font-size:${lang === 'zh' ? 23 : 22}px;line-height:1.55;color:#a9b2c3;max-width:520px">${f.sub}</p>
           </div>
           <div style="display:flex;gap:26px;align-items:center">${imgs}</div>
         </div>
         <div style="position:absolute;left:80px;bottom:26px;font-size:14px;color:#6f7a8e">${lang === 'zh' ? '社区开发 · 与 XDagger 官方团队无隶属关系' : 'Community-built · not affiliated with the XDagger team'}</div>`,
        1280,
        800,
        join(OUT, `screenshot-${lang}-${i++}.png`),
      );
    }
  }

  // promo tiles cannot be localized in the store: one bilingual, text-light design per size
  await render(
    `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 36px;gap:14px">
       <div class="brand" style="font-size:40px;gap:16px"><img src="${logo}" width="72" height="72">${brand.name}<span style="font-weight:600;color:#c7cfdd">${brand.nameZh}</span></div>
       <div style="font-size:18px;color:#aab3c4;line-height:1.45">${brand.descriptorEn}<br>${brand.descriptorZh}</div>
     </div>`,
    440,
    280,
    join(OUT, 'promo-small-440x280.png'),
  );
  await render(
    `<div style="display:flex;height:100%;align-items:center;padding:0 90px;gap:60px">
       <div style="flex:1">
         <div class="brand" style="font-size:64px;gap:22px"><img src="${logo}" width="112" height="112">${brand.name}<span style="font-weight:600;color:#c7cfdd">${brand.nameZh}</span></div>
         <div style="margin-top:28px;font-size:28px;color:#c3cbda;line-height:1.4">${brand.descriptorEn}<br>${brand.descriptorZh}</div>
       </div>
       <img class="shot" src="${b64(raw['home-en'])}" style="height:470px;transform:translateY(70px)">
     </div>`,
    1400,
    560,
    join(OUT, 'promo-marquee-1400x560.png'),
  );
  await browser.close();
  // the store wants 24-bit images without alpha
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
    const buf = readFileSync(join(OUT, f));
    if (buf[25] !== 2) throw new Error(`${f}: PNG colour type ${buf[25]} (expected 2 = RGB, no alpha)`);
  }
  writeFileSync(join(OUT, 'README.txt'), 'Generated by scripts/store-assets.mjs — Chrome Web Store listing images (24-bit PNG, no alpha).\n');
  console.log(`store assets written to ${OUT}`);
} catch (e) {
  if (dbgPage && process.env.FAIL_SHOT) await dbgPage.screenshot({ path: process.env.FAIL_SHOT }).catch(() => undefined);
  if (dbgPopup && process.env.FAIL_SHOT) await dbgPopup.screenshot({ path: process.env.FAIL_SHOT.replace(/\.png$/, '') + '-popup.png' }).catch(() => undefined);
  throw e;
} finally {
  node.server.close();
  rmSync(work, { recursive: true, force: true });
}
