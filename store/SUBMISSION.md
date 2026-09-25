# 上架 Chrome 网上应用店：操作步骤

产品名：**藏锋 · Sheath**（商店标题 `Sheath — Self-Custody Wallet for XDAG` / `藏锋 — XDAG 自托管钱包`）。
各字段的可直接粘贴文本见 [LISTING.md](LISTING.md)；图片素材在 `store/assets/`；隐私政策在 [PRIVACY.md](PRIVACY.md)。

> 以下信息整理自 2026 年 9 月可查到的 Google 官方文档副本与开发者记录；本环境无法直接访问 developer.chrome.com 与商店后台，提交时请以后台实际界面为准。

## 0. 提交前检查（本仓库已完成）

- [x] 独立品牌名，XDAG 只作描述词；商店描述、欢迎页、设置“关于”、隐私政策都写明“社区开发，与 XDagger 官方团队无隶属关系”（避免被判“冒充”）
- [x] 128×128 图标为 96×96 图案 + 16px 透明边距；截图与宣传图为 24 位 PNG、无透明通道
- [x] 代码不混淆、不压缩（便于审核），无远程代码，CSP `script-src 'self'`
- [x] 隐私政策含 Limited Use 声明，并说明节点运营方可见 IP；网络设置页有同样的提示
- [x] 权限最小化：`storage`、`alarms`、`idle` + 两个默认 RPC 节点；`https://*/*` 仅为可选权限，添加自定义节点时才按单个域名申请

提交前再做：

0. **仓库必须公开，且默认分支为 `main`。** 商店描述里的主页 / 支持链接、隐私政策链接、审核用测试文件链接都指向 `main`，仓库私有时未登录访问会 404，“开源”的说法也不成立。代码已在 `main` 分支上；请在 GitHub 仓库 **Settings → General → Default branch** 把默认分支切换为 `main`（之后可删除旧的 `claude/cool-cerf-ipb93y` 分支），再在同一页底部 **Danger Zone → Change visibility** 设为 Public，然后**退出 GitHub 登录**逐个打开这些链接确认可访问。如果仓库要保持私有，请把隐私政策和测试文件放到其它公开地址，替换 LISTING.md 与 PRIVACY.md 中的链接，并删掉描述和截图说明里的“开源”。
1. 确认 `mainnet-rpc.xdagj.org`、`testnet-rpc.xdagj.org` 可以正常访问（审核期间节点不可用会被判“功能无法使用”）。
2. `npm ci && npm test && npm run package`，得到 `release/sheath-xdag-wallet-<版本>.zip`。
3. 如需重新生成素材：`npm run build && node scripts/store-assets.mjs`。
4. 建议再做一次商标检索（USPTO / 中国商标网）确认 “Sheath / 藏锋” 在第 9、36 类没有冲突；另外可手动在商店里搜一下同名扩展。

## 1. 公开隐私政策

商店要求在专门的字段里填写一个**可公开访问的 HTTPS 链接**（只写在描述里会被拒）。任选其一：

- 仓库公开并已合并到 `main` 时，直接用 `https://github.com/xdagx/xdagx/blob/main/store/PRIVACY.md`；
- 或开启 GitHub Pages（从 `main` 分支根目录发布），地址为 `https://xdagx.github.io/xdagx/store/PRIVACY.html`。

把链接同时填进 LISTING.md 英文描述末尾的 `<PRIVACY POLICY URL>` 和中文描述末尾的 `<隐私政策链接>` 两处占位。

## 2. 准备 Google 账号

- 用一个**专用**的 Google 账号（开发者邮箱之后不能修改）。
- **必须开启两步验证**，否则无法发布或更新。

## 3. 注册开发者（一次性 5 美元）

打开 <https://chrome.google.com/webstore/devconsole>，同意开发者协议并支付 **US$5** 注册费。
中国大陆开发者注意：有开发者反映银联 / 部分双币卡会支付失败，付款资料的国家也不能选中国大陆（港澳台可以）。请使用本人名下、信息真实的卡和地址。

## 4. 填写账号资料

- **发布者名称**：例如 `xdagx community`，不要只写 `XDAG` 或 `XDagger`。
- 验证联系邮箱（审核结果、警告都会发到这里）。
- **欧盟 DSA 声明**：免费的社区钱包通常选 **非交易者（Non-trader）**；以后若加入付费或捐赠功能需重新评估。
- 可邀请第二位维护者作为成员，避免单点风险。

## 5. 上传 ZIP

控制台 → **Add new item** → 选择 `release/sheath-xdag-wallet-<版本>.zip` → Upload。
上传后会自动做安装检查；记下 32 位扩展 ID。名称、简介、图标来自压缩包，后台不能直接改，改动需要提高版本号重新上传。

## 6. 商店信息（Store listing）

按 LISTING.md 填写：
- 类别：**Tools**（没有加密货币分类）；语言：English，另在语言下拉框中添加 **中文（简体）** 版本的描述和截图。
- 截图：英文用 `screenshot-en-1..5.png`，中文用 `screenshot-zh-1..5.png`（1280×800）。
- 小宣传图 440×280（必填，全局只有一张）：`promo-small-440x280.png`；大宣传图 1400×560（可选）：`promo-marquee-1400x560.png`。
- 主页：`https://github.com/xdagx/xdagx`；支持：`https://github.com/xdagx/xdagx/issues`；Official URL 留空。

## 7. 隐私权规范（Privacy practices）

逐项粘贴 LISTING.md 中的：单一用途说明、`storage` / `alarms` / `idle` 说明、主机权限说明（共用一个字段）；
远程代码选 **No**；数据类型勾选 **Authentication information** 与 **Financial and payment information**；三项承诺全部勾选；填入隐私政策链接。
出现 “Due to the Host Permission, your extension may require an in-depth review” 提示属正常，只是审核会慢一些。

## 8. 发布设置（Distribution）

免费；可见性选 **Public**（想先小范围测试可选 **Unlisted**，之后再改公开）；地区选全部。

## 9. 审核说明（Test instructions，强烈建议填写）

粘贴 LISTING.md 中的英文说明（其中的测试文件链接依赖第 0 步：仓库公开且有 `main` 分支）。审核员无法使用真实资金，所以提供了测试网步骤和
[测试用钱包文件](reviewer-test-files/)（`wallet.dat` 密码 `xdag2018`，`xdagj/wallet.data` 密码 `test-password-1`，均为公开测试密钥，切勿转入真实资产）。

## 10. 提交审核

点击 **Submit for review**。如想自己决定上线时间，在确认框里取消“审核通过后自动发布”——通过后 30 天内需手动点 Publish。
审核通常几天，最长可能数周（新开发者、新扩展、带主机权限都会更严格）。超过约 3 周可通过 One Stop Support 联系支持；**不要撤回重交**，会重新排队。

## 11. 上线之后

- 分享直达链接 `https://chromewebstore.google.com/detail/<扩展ID>`（新扩展进入搜索结果最多需要 7 天）。
- 把商店链接和 ID 写进 README。
- 大陆用户无法直接访问 Chrome 网上应用店：同一个 ZIP 也可以上架 **Microsoft Edge 加载项**（注册免费），并在 GitHub Releases 提供 ZIP 供手动安装。
- 每次更新都要提高 `manifest.json` 的版本号并重新审核；新增**必需**权限会让老用户的扩展被停用直到同意，尽量用可选权限。
- 钱包是供应链攻击的高价值目标（2025 年有钱包扩展因发布凭据泄露被植入恶意版本）：开发者账号务必开启两步验证，发布凭据不要放在 CI 明文中，发布的 ZIP 应与带标签的版本构建一致。

## 名称备选

若不想用 Sheath（英式英语中它也是避孕套的旧称），可换成 **Scabbard**，中文名 **藏锋** 保持不变。
运行 `grep -rn "Sheath\|sheath" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=release .` 找出所有出现的位置并逐一替换
（包括 `public/_locales/*/messages.json`、`store/brand.json`、`src/ui/i18n.ts`、`popup.html`、`app.html`、`store/*.md`、`README.md`、`LICENSE`、`package.json`、`scripts/package.mjs`、`.github/workflows/ci.yml`），
然后 `npm install --package-lock-only`、`npm run build && node scripts/store-assets.mjs`、`npm run package`。
