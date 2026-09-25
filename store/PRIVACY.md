# __NAME__ — Privacy Policy / 隐私政策

_Last updated / 最后更新：2026-09-25_

## English

__NAME__ ("the extension") is a self-custody wallet for the XDAG cryptocurrency. It is developed by an
independent community publisher and is not affiliated with the XDAG / XDagger core team.

**What stays on your device.** Your recovery phrase, private keys, imported wallet files and account list
are encrypted with your password (PBKDF2-SHA256 + AES-256-GCM) and stored only in your browser's extension
storage. They are never sent to the publisher or to any third party. Your password is never stored.

**What the extension sends over the network.** Only the requests needed to operate a wallet, and only to the
XDAG RPC node you have selected (by default `mainnet-rpc.xdagj.org` / `testnet-rpc.xdagj.org`, or a custom node
you add): your public addresses (to read balances, nonces and transaction history) and the transactions you
sign and choose to broadcast. Anything published to the XDAG network is public by nature. When you open a block
explorer link, that page is loaded by your browser from the explorer's website.

**What we do not do.** No analytics, telemetry, advertising, tracking, cookies or remote code. We do not
collect, sell, share or transfer personal or financial data, and we do not use data for creditworthiness or
lending purposes.

**Permissions.** `storage` (encrypted vault and settings), `alarms` (auto-lock timer), `idle` (lock when your
screen locks), access to the default XDAG RPC nodes, and — only when you add a custom node — access to that
node's address.

**Your control.** You can export your keys, reset the wallet (Settings → Reset wallet) or uninstall the
extension at any time; uninstalling removes all locally stored data.

**Contact.** Please open an issue at https://github.com/xdagx/xdagx/issues.

## 中文

__NAME_ZH__（以下简称“本插件”）是 XDAG 加密货币的自托管钱包，由独立的社区开发者发布，与 XDAG / XDagger 核心团队无隶属关系。

**保存在本机的数据。** 助记词、私钥、导入的钱包文件和账户列表均使用你的密码加密（PBKDF2-SHA256 + AES-256-GCM），只保存在浏览器的扩展存储中，绝不会发送给开发者或任何第三方。你的密码不会被保存。

**网络通信。** 仅发送钱包运行所必需的请求，且只发送到你选择的 XDAG RPC 节点（默认 `mainnet-rpc.xdagj.org` / `testnet-rpc.xdagj.org`，或你自行添加的节点）：你的公开地址（用于查询余额、nonce 和交易记录），以及你签名并确认广播的交易。写入 XDAG 网络的内容本身就是公开的。打开区块浏览器链接时，页面由你的浏览器从浏览器网站加载。

**我们不做的事。** 没有统计分析、遥测、广告、追踪、Cookie 或远程代码；不收集、出售、共享或转让任何个人或财务数据，也不将数据用于信用评估或借贷。

**权限。** `storage`（加密金库与设置）、`alarms`（自动锁定计时）、`idle`（系统锁屏时锁定钱包）、访问默认的 XDAG RPC 节点，以及仅在你添加自定义节点时访问该节点地址。

**你的控制权。** 你可以随时导出密钥、重置钱包（设置 → 重置钱包）或卸载插件；卸载会删除所有本地数据。

**联系方式。** 请在 https://github.com/xdagx/xdagx/issues 提交 issue。
