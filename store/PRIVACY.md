# Sheath (藏锋) — Privacy Policy / 隐私政策

_Last updated / 最后更新：2026-09-25_

## English

Sheath — Self-Custody Wallet for XDAG ("the extension", Chinese name 藏锋) is a self-custody wallet for the XDAG cryptocurrency. It is developed by an
independent community publisher and is not affiliated with the XDAG / XDagger core team.

**What stays on your device.** Wallet files and folders you import (for example an old client folder with
its `storage/` directory) are read inside the extension on your device and are never uploaded. Your recovery phrase and private keys (including keys imported from wallet
files) and your account list are encrypted with your password (PBKDF2-SHA256 + AES-256-GCM) and stored only in
your browser's extension storage. The recovery phrase and private keys never leave the extension; your password
is never stored. Settings, your address book (names, addresses, notes) and a short list of recently sent
transfers (addresses, amounts, fees, remarks; at most 100 entries, kept up to three days) are kept in local
extension storage without encryption. While the wallet is unlocked, a cached balance list is kept in memory-only
session storage. None of this is sent to the publisher.

**What the extension sends over the network.** Only the requests needed to operate a wallet, and only to the
XDAG RPC node you have selected (by default `mainnet-rpc.xdagj.org` / `testnet-rpc.xdagj.org`, or a custom node
you add): your public addresses (to read balances, nonces and transaction history) and the transactions you
sign and choose to broadcast. The default nodes are operated by third parties, not by the publisher; like any
web server, the node you use can see your IP address and which addresses you query. Anything published to the
XDAG network is public by nature. When you open an external link (a block explorer, the exchange page behind "Buy", the project's
GitHub pages), that page is loaded by your browser from that website.

**What we do not do.** No analytics, telemetry, advertising, tracking, cookies or remote code. The publisher does
not receive, collect, sell, share or transfer personal or financial data, and data is never used for
creditworthiness or lending purposes or for anything other than operating the wallet.

**Limited Use.** The use of information received by Sheath adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/),
including the Limited Use requirements.

**Changes.** If these practices ever change, the change will be described here and announced in the extension
before it takes effect.

**Permissions.** `storage` (encrypted vault, settings, address book, recent transfers), `alarms` (auto-lock timer), `idle` (lock when your
screen locks), access to the default XDAG RPC nodes, and — only when you add a custom node — access to that
node's address.

**Your control.** You can export your keys, reset the wallet (Settings → Reset wallet) or uninstall the
extension at any time; uninstalling removes all locally stored data.

**Contact.** Please open an issue at https://github.com/xdagx/sheath/issues.

## 中文

藏锋 — XDAG 自托管钱包（英文名 Sheath，以下简称“本插件”）是 XDAG 加密货币的自托管钱包，由独立的社区开发者发布，与 XDAG / XDagger 核心团队无隶属关系。

**保存在本机的数据。** 你导入的钱包文件和文件夹（例如带 `storage/` 目录的旧客户端文件夹）只在本机由插件读取，从不上传。助记词、私钥（包括从钱包文件导入的密钥）和账户列表均使用你的密码加密（PBKDF2-SHA256 + AES-256-GCM），只保存在浏览器的扩展存储中；助记词和私钥绝不会离开本插件，你的密码不会被保存。设置、地址簿（名称、地址、备注）以及最近发出的转账记录（地址、金额、手续费、备注；最多 100 条、最长保留 3 天）以未加密形式保存在本地扩展存储中；钱包解锁期间，余额缓存保存在仅存于内存的会话存储中。以上内容都不会发送给开发者。

**网络通信。** 仅发送钱包运行所必需的请求，且只发送到你选择的 XDAG RPC 节点（默认 `mainnet-rpc.xdagj.org` / `testnet-rpc.xdagj.org`，或你自行添加的节点）：你的公开地址（用于查询余额、nonce 和交易记录），以及你签名并确认广播的交易。默认节点由第三方运营，而非本插件开发者；与任何网站服务器一样，你所使用的节点可以看到你的 IP 地址以及你查询的地址。写入 XDAG 网络的内容本身就是公开的。打开外部链接（区块浏览器、“购买”按钮对应的交易所页面、项目的 GitHub 页面）时，页面由你的浏览器从对应网站加载。

**我们不做的事。** 没有统计分析、遥测、广告、追踪、Cookie 或远程代码；开发者不接收、不收集、不出售、不共享也不转让任何个人或财务数据，数据只用于运行钱包本身，绝不用于信用评估、借贷或其它用途。

**有限使用（Limited Use）。** 本插件对所获取信息的使用遵守 [Chrome 网上应用店用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/)，包括其中的“有限使用”要求。

**变更。** 如果上述做法发生任何变化，会先在本页说明，并在插件内提前告知。

**权限。** `storage`（加密金库、设置、地址簿、最近转账记录）、`alarms`（自动锁定计时）、`idle`（系统锁屏时锁定钱包）、访问默认的 XDAG RPC 节点，以及仅在你添加自定义节点时访问该节点地址。

**你的控制权。** 你可以随时导出密钥、重置钱包（设置 → 重置钱包）或卸载插件；卸载会删除所有本地数据。

**联系方式。** 请在 https://github.com/xdagx/sheath/issues 提交 issue。
