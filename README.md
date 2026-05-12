# Basketball Scoreboard & Stats (BIBA)

桌面篮球记分 & 球员数据工具。按 **球衣号码** 计分，单屏操作，整场比赛 **全部数据保存在本地**（无服务器、无数据库）。基于 Electron。

`index.html` / `styles.css` / `renderer.js` / `main.js` 都在仓库根目录。

---

## 功能

- **赛前设置**
  - 主 / 客队名称
  - 每队 1–15 名球员，每名球员包含 **球衣号码（0–99，队内不重复）+ 姓名**（姓名可输入完整内容，界面里只显示前 3 个字符）
  - 名单是一个 **可直接编辑的表格**（改号码 / 改姓名 / 删行）
  - **批量导入 / 粘贴**：一个文本框，每行 `号码 姓名`（空格、逗号或 Tab 分隔均可），支持「追加到表格」和「清空并替换」
  - 名单 + 比赛进度自动保存在本地，意外关闭窗口不会丢
- **单屏比赛界面（尽量不上下滚动）**
  - 顶部常驻大比分牌：双方比分（变化时有翻牌计分牌动画）、比赛时钟、节次、状态、犯规数、剩余暂停、Bonus
  - **球衣号码计分台**：选球队 → 输入球衣号（或点下方表格里的球员）→ `+1 / +2 / +3 / 犯规 / 助攻 / 篮板 / 抢断 / 盖帽`
  - 下方两张紧凑的只读数据表（按号码排序，可点行选中、可单独修正）
  - 裁判提醒（横幅 + 提示音）：节次时间到、暂停时间到、个人犯规接近 / 满 5 次罚下、全队进入 Bonus 等
- BIBA 赛制：4 节 × 12 分钟；Q1–Q3 走表，Q4 与加时停表；中场 / 节间休息；最多 2 个加时 + Golden Point
- 暂停系统（每次 60 秒）、撤销上一步、手动修正数据、一键复制比赛文本

---

## 本地运行（开发）

```bash
npm install
npm start
```

## 打包

- 本地：`npm run dist:mac`（生成 `.dmg`）/ `npm run dist:win`（生成 `.exe`）
- **GitHub Actions**：仓库 → Actions → **Build & Release** → Run workflow，填入版本号（如 `1.2.0`）。
  工作流会把版本号写进 `package.json`，构建 macOS `.dmg` 与 Windows `.exe` 安装包，并自动创建 tag 为 `v<版本号>` 的 GitHub Release，把两个安装包作为附件上传。

下载安装包后本地打开即可使用，不需要任何服务器 / 数据库 / 联网。

### 首次打开（重要）

应用没有购买苹果 / 微软的代码签名证书，所以**第一次打开时会有一次安全提示——这是正常现象，安装包本身没有损坏**。

- **macOS**：下载 `.dmg` → 拖到「应用程序」。第一次打开如提示「无法验证开发者」，**右键点应用图标 → 打开**（或打开「系统设置 → 隐私与安全性」，往下找到这个 App 点「仍要打开」）；之后就能正常双击。
  想完全去掉提示，可以在「终端」运行一次：
  ```bash
  xattr -cr "/Applications/Basketball Scoreboard.app"
  ```
- **Windows**：运行 `.exe` 安装包。如弹出「Windows 已保护你的电脑」，点**更多信息 → 仍要运行**即可。

> macOS 端会做 ad-hoc 签名（`package.json` 里 `mac.identity` 设为 `"-"`），这一步是 Apple Silicon 必需的，否则 `.dmg` 会被系统报「已损坏」。

### 可选：正式代码签名 / 公证（去掉所有安全提示）

如果你有相应的证书，可以在 workflow 里加签名步骤，让用户下载后零提示：

- **macOS 公证**：需要 Apple Developer Program 账号，配置 GitHub secrets：`CSC_LINK`（Developer ID 证书 `.p12` 的 base64）、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，并把 `mac.hardenedRuntime` 设为 `true`。
- **Windows 签名**：需要 Authenticode 代码签名证书，配置 `CSC_LINK`（`.pfx` 的 base64）、`CSC_KEY_PASSWORD`。

本仓库当前不包含这些步骤（无证书）。需要时可以再加。

---

## 技术栈

Electron · 原生 HTML / CSS / JavaScript · 数据保存在浏览器 `localStorage`
