# XDAG 钱包 · Chrome 浏览器插件

一个安全、轻快、界面精致的 **XDAG 浏览器插件钱包**（Chrome / Edge / Brave 等 Chromium 内核浏览器，Manifest V3）。
依据 XDAG 官方代码实现：[xdag](https://github.com/XDagger/xdag)（2018 C 客户端）、[xdagj](https://github.com/XDagger/xdagj) / [xdagj-crypto](https://github.com/XDagger/xdagj-crypto) 与 [XDAG Pro](https://github.com/XDagger/xdag-pro)，**同时兼容新旧两代钱包文件**。

<p align="center">
  <img src="docs/screenshots/14-popup-dark.png" width="240" alt="主页（深色）" />
  <img src="docs/screenshots/15-popup-light-zh.png" width="240" alt="主页（浅色 · 中文）" />
  <img src="docs/screenshots/17-popup-send-dark.png" width="240" alt="转账" />
</p>

## 功能

| 类别 | 功能 |
| --- | --- |
| 钱包 | 创建钱包（12 词 BIP39 助记词 + 备份校验）；多账户（HD 派生 `m/44'/586'/0'/0/i`）；账户重命名 / 移除 |
| 导入 | 助记词（12/15/18/21/24 词）· 私钥（hex）· **xdagj `wallet.data`** · **2018 版 `wallet.dat` + `dnet_key.dat`** |
| 旧钱包 | 查看 2018 版 32 位区块地址余额，并一键**迁移到新地址**（等价于 xdagj `xfertonew`），自动识别该区块属于钱包里的哪把密钥 |
| 转账 | 地址校验（Base58Check）、全部金额、备注（ASCII ≤ 32）、加速手续费（参考节点平均手续费）、确认页、对方实收金额预览 |
| 收款 | 二维码、复制地址 |
| 记录 | 交易记录（分页、按日期分组）、待确认交易跟踪、交易详情（状态 / 对手方 / 手续费 / 备注）、区块浏览器链接 |
| 其它 | 地址簿、主网 / 测试网 / 自定义节点（连接测试、链校验）、简体中文 / English、深色 / 浅色 / 跟随系统、隐藏余额 |
| 备份 | 查看助记词、导出私钥、**导出 xdagj 兼容的 `wallet.data`**（可被 xdagj 节点或本插件重新导入） |

## 钱包文件兼容性

| 格式 | 来源 | 支持 |
| --- | --- | --- |
| `wallet.dat`（及 `wallet-testnet.dat`）+ `dnet_key.dat` | 2018 年原版 C 客户端 / Windows XDagWallet | 导入（dfslib 加密算法逐位移植；用 `dnet_key.dat` 校验密码；兼容无密码钱包、ARM 版短密钥） |
| `wallet/wallet.data`（版本 4） | xdagj 节点 | 导入 + 导出（BCrypt(cost 12) → AES-192-CBC；包含助记词与 HD 序号） |
| BIP39 助记词 | xdagj、XDAG Pro | 导入 / 创建（路径 `m/44'/586'/0'/0/i`） |
| 私钥 hex | 所有客户端 | 导入 / 导出 |

地址：新格式为 `Base58Check(RIPEMD160(SHA256(压缩公钥)))`；旧格式为区块哈希的 32 位 Base64。
交易：512 字节区块，与 xdagj `io.xdag.core.Block` **逐字节一致**（账户转账带 nonce；旧区块余额转移使用 `XDAG_FIELD_IN` 且无 nonce）。
详见 [docs/FORMATS.md](docs/FORMATS.md)。

> 2018 旧钱包说明：旧网络中余额记录在“区块地址”上（钱包界面显示的 32 位地址）。导入 `wallet.dat` 后，每把私钥会得到一个新格式地址；把旧界面显示的 32 位地址填入“旧钱包地址”，即可看到该区块余额并转移到新地址。

## 安全设计

- **私钥只在后台 Service Worker 中使用**：界面只拿到地址；签名、广播在后台完成。
- **本地加密**：PBKDF2-HMAC-SHA256（600,000 次）派生密钥 + AES-256-GCM 加密整个金库；从不保存明文密码。
- **会话**：解锁后派生密钥只存于 `chrome.storage.session`（仅内存、仅扩展可信上下文），浏览器关闭即清除。
- **自动锁定**：可设置 1 分钟 – 4 小时或从不；系统锁屏时立即锁定；连续输错密码指数退避。
- **签名前校验**：后台再次验证地址、金额、手续费、余额，并用 `xdag_netType` 确认节点所在链与所选网络一致，防止跨链误签。
- **严格 CSP**（无 `eval`、无远程脚本），无 content script、不向网页注入任何对象；依赖锁定版本，只用经过审计的 [@noble](https://paulmillr.com/noble/) / [@scure](https://github.com/paulmillr/scure-base) 密码库。
- 敏感信息（助记词、私钥）需再次输入密码才能查看；复制后 60 秒自动清空剪贴板。
- 自定义节点仅允许 `https://`（本机 `localhost` 可用 `http://`），并按需申请该域名权限。

## 安装

### 从源码构建

```bash
npm ci
npm run build          # 输出到 dist/
npm run package        # 可选：生成 release/xdag-wallet-<version>.zip
```

在 Chrome 打开 `chrome://extensions` → 打开“开发者模式” → “加载已解压的扩展程序” → 选择 `dist/` 目录。
首次安装会自动打开欢迎页，可创建新钱包或导入已有钱包。

### 导入 2018 旧钱包

1. 找到旧客户端目录（例如 `C:\xdag\` 或 XDagWallet 文件夹，与 `storage/` 同级）中的 `wallet.dat` 与 `dnet_key.dat`。
2. 插件中选择“导入钱包 → 2018 旧钱包”，选择两个文件并输入旧钱包密码（没有设置过密码则留空）。
3. 选择要导入的账户；在“旧钱包地址”中填入旧界面显示的 32 位地址（可选）。
4. 首页“旧钱包地址”卡片中点击“转移”，即可把旧区块余额转到新地址（手续费 0.1 XDAG）。

## 开发

```bash
npm test               # 81 个单元 / 集成测试（与官方 Java / C 实现的交叉测试向量对比）
npm run typecheck
npm run mock-node      # 本地模拟 xdagj RPC 节点（http://127.0.0.1:18545），用于界面调试
npm run build && npm run e2e   # Playwright 端到端测试（真实加载插件 + 模拟节点）
```

在插件“设置 → 网络 → 添加自定义节点”中填入 `http://127.0.0.1:18545` 即可连接模拟节点；
`FUND=<地址>:<数量>` 环境变量可为模拟节点预置余额。

### 兼容性是如何验证的

`tests/fixtures/` 中的测试向量由**官方代码生成**，而非本项目自己生成：

- `xdagj-vectors.json`：[`tools/vectors/xdagj/VectorGen.java`](tools/vectors/xdagj/VectorGen.java) 调用 xdagj 0.8.3 本身的 `Wallet`、`Block`、BouncyCastle `BCrypt`、`Signer` 等类生成：BIP44 派生、签名、BCrypt、AES、真实 `wallet.data` 文件、签名后的交易区块、金额换算。
- `legacy-vectors.json`：[`tools/vectors/legacy/gen_legacy.c`](tools/vectors/legacy/gen_legacy.c) 链接原版 `dfslib` / `dfsrsa` 源码，按 `dnet_crypt.c` 与 `wallet.c` 的流程生成 `dnet_key.dat` 与 `wallet.dat`（含空密码、中文 / 俄文密码、emoji 密码、ARM 短密钥等边界情况）。

本插件生成的交易区块与 xdagj 生成的结果逐字节比对一致。

### 目录结构

```
src/core/        纯 TypeScript 协议与密码学实现（地址、金额、BIP39/44、BCrypt、xdagj 钱包文件、dfslib 旧钱包、交易区块、金库、RPC）
src/background/  MV3 Service Worker：密钥环、消息路由、自动锁定
src/ui/          Preact 界面（弹窗与完整页面共用），中英文、深浅主题
tests/           Vitest 测试 + 官方实现生成的测试向量
tools/vectors/   测试向量生成器（Java / C）
scripts/         打包、图标、模拟节点、端到端测试
```

---

## English

A Manifest V3 browser-extension wallet for **XDAG** that opens both **2018 C-client wallets** (`wallet.dat` + `dnet_key.dat`, dfslib cipher ported bit-for-bit) and **xdagj `wallet.data`** (v4, BCrypt + AES-192-CBC), as well as BIP39 phrases (`m/44'/586'/0'/0/i`, compatible with XDAG Pro) and raw private keys.
It signs nonce-based account transfers byte-identical to xdagj's `Block`, can move balances held by 2018 block addresses to the new address format (like xdagj `xfertonew`), and exports an xdagj-compatible `wallet.data`.

Keys live only in the background service worker, the vault is encrypted with PBKDF2-SHA256 (600k) + AES-256-GCM, the session key is kept in RAM-only `chrome.storage.session`, the wallet auto-locks on inactivity and screen lock, and the node's chain is verified before signing.

Build with `npm ci && npm run build`, then load `dist/` via `chrome://extensions` → *Load unpacked*. Run `npm test` for the cross-implementation test suite and `npm run e2e` for the Playwright end-to-end test.

License: MIT (see [LICENSE](LICENSE) for third-party notices).
