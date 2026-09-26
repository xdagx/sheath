# Chrome Web Store listing — paste-ready fields

Everything below matches the code in this repository (checked against `public/manifest.json`,
`src/background/*`, `src/ui/pages/Settings.tsx`). Keep it in sync when behaviour changes.

## Package (comes from the ZIP, not editable in the dashboard)

| Field | en | zh_CN | Limit |
| --- | --- | --- | --- |
| Name (`extName`) | Sheath — Self-Custody Wallet for XDAG | 藏锋 — XDAG 自托管钱包 | 75 chars |
| Summary (`extDescription`) | Community-built, self-custody XDAG wallet. Opens 2018 wallet.dat, xdagj wallet.data, recovery phrases and private keys. | 社区开发的 XDAG 自托管钱包（非官方）。支持导入 2018 版 wallet.dat、xdagj wallet.data、助记词和私钥。 | 132 chars |
| Short name | Sheath | 藏锋 | 12 chars |
| Store icon | `public/icons/icon-128.png` (96 px artwork, 16 px transparent padding) | | 128×128 |

Upload: `release/sheath-xdag-wallet-<version>.zip` (`npm run package`). Bump `version` in `public/manifest.json` for every upload.

## Store listing tab

- **Category:** Tools (alternative: Privacy & Security). There is no crypto category.
- **Language:** English (the package also ships zh_CN; add a Chinese listing via the language dropdown).
- **Homepage URL:** https://github.com/xdagx/sheath
- **Support URL:** https://github.com/xdagx/sheath/issues
- **Official URL:** leave empty (needs a domain verified in Search Console).
- **Mature content:** No.
- **Screenshots:** `store/assets/screenshot-en-1..5.png` for English, `screenshot-zh-1..5.png` for 中文 (1280×800, 24-bit PNG).
- **Small promo tile (required, global):** `store/assets/promo-small-440x280.png`
- **Marquee (optional, global):** `store/assets/promo-marquee-1400x560.png`

### Detailed description — English

```
Sheath is a self-custody wallet for the XDAG cryptocurrency. Your keys are encrypted on your own device and never leave it.

Community-built and open source. Not affiliated with or endorsed by the XDagger team.

WHAT YOU CAN DO
• Create a wallet with a 12-word recovery phrase, or import an existing phrase (12–24 words)
• Import a private key, or the encrypted wallet.data file of an xdagj node
• Open the original 2018 wallet folder: your old 32-character addresses and their balances are found automatically, and can be moved to your new address
• Send with a clear fee breakdown: see exactly what the recipient receives before you sign
• Receive with a QR code, browse your history, keep an address book
• Several accounts; mainnet, testnet or your own node; English and Chinese; dark and light themes
• Export an xdagj-compatible wallet.data backup

SECURITY
• Your recovery phrase and keys are stored only in this browser, encrypted with your password (PBKDF2-SHA256 + AES-256-GCM). The password itself is never stored.
• Auto-lock after inactivity and whenever your screen locks
• Before signing, the wallet checks that the node is on the network you selected
• No analytics, no tracking, no remote code and no content scripts: it never reads or changes the web pages you visit

NETWORK
The wallet talks only to the node you select (by default mainnet-rpc.xdagj.org). Your public addresses and the transactions you sign are sent to that node so it can show balances and broadcast transfers.

Source code, file-format documentation and test vectors: https://github.com/xdagx/sheath
Privacy policy: https://github.com/xdagx/sheath/blob/main/store/PRIVACY.md
```

### Detailed description — 中文

```
藏锋是 XDAG 的自托管钱包：私钥加密保存在你自己的设备上，从不离开本机。

社区开发、开源，与 XDagger 官方团队无隶属或背书关系。

主要功能
• 创建钱包（12 个单词的助记词），或导入已有助记词（12–24 个单词）
• 导入私钥，或导入 xdagj 节点的加密钱包文件 wallet.data
• 直接打开 2018 年原版客户端的钱包文件夹，自动找到旧的 32 位地址和余额，并可转到你的新地址
• 转账手续费一目了然：签名前就能看到对方实收金额
• 二维码收款、交易记录、地址簿
• 多账户；主网、测试网或自定义节点；中英文界面；深色 / 浅色主题
• 可导出与 xdagj 兼容的 wallet.data 备份

安全
• 助记词和私钥只保存在本浏览器中，并用你的密码加密（PBKDF2-SHA256 + AES-256-GCM），密码本身从不保存
• 闲置一段时间或系统锁屏时自动锁定
• 签名前核对节点所在网络与所选网络一致
• 无统计分析、无追踪、无远程代码、无内容脚本：不会读取或修改你浏览的网页

网络
钱包只与你选择的节点通信（默认 mainnet-rpc.xdagj.org）。为显示余额和广播转账，你的公开地址及你签名的交易会发送到该节点。

源代码、文件格式文档与测试向量：https://github.com/xdagx/sheath
隐私政策：https://github.com/xdagx/sheath/blob/main/store/PRIVACY.md
```

## Privacy practices tab

**Single purpose** (549 characters):

```
A self-custody wallet for the XDAG cryptocurrency. Users create or import XDAG accounts (recovery phrase, private key, xdagj wallet.data, or the original 2018 wallet.dat + dnet_key.dat), keep the keys encrypted on their own device, see balances and history, and sign and send XDAG transactions through an XDAG RPC node they choose. Moving funds from legacy 2018 block addresses to the current address format is part of the same wallet function. The extension has no content scripts, does not read or change web pages, and does not inject into sites.
```

**storage**

```
Keeps the wallet's data on the user's device in chrome.storage.local: the encrypted vault (recovery phrase, private keys and account list, encrypted with the user's password via PBKDF2-SHA256 + AES-256-GCM; the password itself is never stored), settings, the address book (contact names, XDAG addresses and notes the user types), any custom node the user adds, a short log of recently sent transfers (kept up to 3 days) and a failed-unlock counter. While the wallet is unlocked the derived session key and a cached balance list are held in chrome.storage.session (memory only) and cleared when the wallet locks. Nothing is sent to the publisher; public addresses and signed transactions are sent only to the XDAG node the user selects.
```

**alarms**

```
Runs the auto-lock timer. On unlock and on each user action the background service worker (re)schedules one chrome.alarms alarm for the auto-lock delay the user picks in Settings; when it fires, the wallet locks and the session key is cleared. An alarm is used because a Manifest V3 service worker can be suspended, so setTimeout cannot be relied on.
```

**idle**

```
Security lock. The extension listens to chrome.idle.onStateChanged and locks the wallet immediately when the operating system reports the "locked" state (the user locked the screen). No idle-state data is stored or transmitted.
```

**Host permissions** (one shared field)

```
https://mainnet-rpc.xdagj.org/* and https://testnet-rpc.xdagj.org/* are the default XDAG mainnet and testnet JSON-RPC nodes. The wallet sends JSON-RPC POST requests to them to read balances, nonces and history for the user's own addresses and to broadcast transactions the user has signed. No web page is read; there are no content scripts.

https://*/*, http://localhost/* and http://127.0.0.1/* are optional_host_permissions and are not granted at install. They are used only when the user adds their own XDAG RPC node in Settings: on that click the wallet calls chrome.permissions.request for that one origin (for example https://node.example.org/*) and uses it only to talk to that node. The node URL is not known in advance, so it cannot be listed. Plain http is accepted only for a node on the user's own computer (localhost / 127.0.0.1); remote nodes must use https.
```

**Remote code:** No, I am not using remote code.

**Data usage** (conservative; disclosures must match behaviour):

- [x] Personally identifiable information — address-book entries the user types (a contact name of up to 40 characters, an XDAG address, an optional note) and the names the user gives their own accounts; stored only on the device (account names inside the encrypted vault, the address book in chrome.storage.local), never transmitted to the publisher or to the node.
- [x] Authentication information — recovery phrase, private keys and password-derived vault; stored locally and encrypted, never transmitted to the publisher.
- [x] Financial and payment information — addresses, balances, history and signed transactions; addresses and transactions are sent to the XDAG node the user selects.
- [ ] Health, Personal communications, Location, Web history, User activity, Website content — not handled.

**Certifications:** tick all three (not sold / not used for unrelated purposes / not used for creditworthiness or lending).

**Privacy policy URL:** https://github.com/xdagx/sheath/blob/main/store/PRIVACY.md

## Distribution tab

- Payments: free, no in-app purchases.
- Visibility: Public (or Unlisted for a soft launch, then switch to Public).
- Regions: all regions.

## Test instructions tab (private note to reviewers)

```
This is a self-custody XDAG wallet. Reviewers do not need real funds.

1. After install a welcome tab opens. Click "Create a new wallet", set a password, reveal and confirm the recovery phrase.
2. Settings (slider icon) > Networks: "Testnet" (https://testnet-rpc.xdagj.org) avoids mainnet for the send test in step 6. The import test in step 4 reads balances only and works on either network; the labels below assume Mainnet.
3. Home: Receive shows the address and QR code; the activity list and address book are under Home and Settings.
4. Import flows with test-only files (no real funds). Test files: open https://github.com/xdagx/sheath, click "Code" > "Download ZIP", unzip it and use the folder sheath-main/store/reviewer-test-files (it contains wallet.dat, dnet_key.dat, storage/, storage-testnet/ and xdagj/wallet.data).
   Click the account name at the top left of Home (opens "Accounts") > Import, then choose the tab:
   - "2018 wallet": "Choose folder" and select that reviewer-test-files folder, password: xdag2018. 8 old addresses are found automatically from storage/ and storage-testnet/. None of them exists on the public networks: on Mainnet the 7 from storage/ show "Not on this node" and the one from storage-testnet/ shows "Other network" (on Testnet it is the other way round). "Balance unavailable" would only mean the node could not be reached. Chrome asks to confirm reading the folder; files are only read locally.
   - "xdagj file": xdagj/wallet.data, password: test-password-1
   In the toolbar popup these two tabs show "Open in full page to select files" (file pickers close popups); continue in that tab.
   A wrong password is rejected; the correct one shows the accounts contained in the file.
5. Auto-lock: Settings > Auto-lock > 1 min, wait one minute: the wallet locks. Locking the OS screen also locks it.
6. Sending requires a funded address. Without funds you can fill in the send form and see the fee breakdown and the "Recipient receives" preview; the Review button stays disabled with "Insufficient balance".

The extension has no content scripts and only makes JSON-RPC requests to the selected XDAG node.
Source: https://github.com/xdagx/sheath (tests compare its output with the official xdagj / xdag code).
```
