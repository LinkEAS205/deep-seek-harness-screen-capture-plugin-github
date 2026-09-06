<div align="center">

# 📸 Screen Snap — 实时框选截图识别插件（DSH）

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 界面打造的实时屏幕框选 + 多模态识别插件。**

> 点「截图识别」→ 整屏冻结（QQ 式）→ 直接拖拽框选 → 预览确认 → 截图自动进入当前会话 → 多模态模型识别，并可持续追问。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DSH%20Web-lightgrey)]()

</div>

## ✨ 特性

- **QQ 式截屏**：点按钮即由本地 Host 抓取整个虚拟桌面（含所有显示器），整屏冻结后**直接在画面上拖拽框选**——无需浏览器的「选择要共享的屏幕/窗口」确认框。
- **回退模式**：本地抓屏不可用（非 Windows / Host 异常）时自动回退到 `getDisplayMedia` 浏览器共享流程。
- **预览确认**：框选后先预览 + 可编辑识别提示词，确认无误才发送；支持「重新框选」（同一冻结画面上重选，无需重新抓屏）。
- **区域精确**：框选区域完全贴合图片，无黑边，不会误框到空白区；按物理像素输出，高缩放屏幕不糊。
- **玻璃拟态 UI**：触发按钮与整个捕获浮层统一为半透明 + 毛玻璃 + 细边框 + 高圆角风格。
- **Esc 取消**：浮层任意阶段按 Esc 即退出（提示词输入框内除外）。
- **可继续追问**：截图作为**真实用户消息**注入当前会话，模型下一轮看到后可持续对话。
- **本地优先**：截图仅存于 DSH 本地附件库，只有发给模型识别那一次是网络外发；两个接口都做同源校验，拒绝外站跨域调用。
- **随启动自动加载**：作为真正的 **preset 插件包**（`dsh.client` + bundle），每次 DSH Web 启动都会自动出现，重启不丢失。

## 🔌 原理

```
点「截图识别」
  → POST /api/dsh-screen-snap/grab（QQ 式，首选）
      Host 用 PowerShell CopyFromScreen 抓整个虚拟桌面 → PNG base64
      → 浏览器整屏冻结显示 → 拖拽框选 → 裁剪成 PNG data URL
  → （回退）getDisplayMedia 共享屏幕 → 实时画面框选 → 裁剪
  → fetch('/api/dsh-screen-snap/recognize', { dataUrl, prompt, sessionId })
      → Host: ctx.apiProxy.sessions.prompt(...) 注入会话（durably 接纳图片 + 入队 user 消息 + 触发下一轮）
  → 多模态模型看图识别 → 继续对话
```

- **Host 半（`index.js`）**：注册 `POST /api/dsh-screen-snap/grab`（本地整屏抓取）与 `POST /api/dsh-screen-snap/recognize`（注入会话）。
- **Client 半（`client.js`）**：`window.__ModuleLoader__.load` + React，注册到 `conversation.input.left` 槽位（触发按钮）与 `shell.overlay`（全屏捕获浮层）。

## 📦 目录结构

```
screen-capture-plugin/
├── client.js         # Client 半（框选交互 / 预览 / 浮层 UI）
├── index.js          # Host 半（webServer 接口 + 本地抓屏 + 注入会话）
├── cordis.patch.yml  # bundle 插件行
├── dsh.plugin.json   # 插件元数据
├── package.json      # 包声明（dsh.client + exports['./client']）
├── README.md         # 本文档
└── LICENSE           # MIT
```

## 🚀 安装（作为 DSH preset 插件包）

以 `dsh-file-uploads` 为标准模板，本插件无需构建（纯手写 `index.js` + `client.js`，`node --check` 校验）。

1. 把本目录放到 `~/.dsh/plugins/dsh-client-screen-snap/`（`~/.dsh` 即 `$DSH_HOME`）。
2. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加：
   ```json
   "dsh-client-screen-snap": "link:C://Users//<你>//.dsh//plugins//dsh-client-screen-snap"
   ```
   并在 `dsh.profile.bundles` 数组加入 `"dsh-client-screen-snap"`。
3. 运行 `pnpm install`（建立 `link:` 依赖）。
4. **重启 DSH Web 服务**，让 `client-modules` 扫描到新 bundle。修改插件代码后同样需要重启才生效。

### 使用

1. 进入一个会话，点 composer 输入框左侧的「📷 截图识别」。
2. 屏幕被冻结为一张整屏图（含所有显示器，首帧约 0.5–1.5s）。
3. **直接拖拽框选**要识别的区域，松手即裁剪。
4. 在预览确认界面点「✅ 确认发送」（或「↺ 重新框选」）。
5. 截图进入会话，多模态模型识别后即可继续追问。

## 🧩 依赖与 Slot

| 项 | 说明 |
|---|---|
| `dsh.client.platform: 'web'`（`package.json`） | 声明 Client 半 bundle |
| `@deepseek-ai/dsh-host-webserver`（peer） | Host 半注册 HTTP 接口 |
| `react`（peer） | Client 半 UI |
| Windows + PowerShell 5.1 | QQ 式本地抓屏依赖；非 Windows 自动走浏览器共享回退 |
| `conversation.input.left`（`id:'screen-snap'`, `order:90`） | 触发按钮 |
| `shell.overlay`（`id:'screen-snap-overlay'`, `order:90`） | 全屏捕获/结果浮层 |
| 多模态模型 | 识别用当前会话选中模型；不支持图像的模型会报 `MODEL_DOES_NOT_SUPPORT_IMAGES`，请切到如 `deepseek-v4-flash-vision-exp` |

## ⚠️ 已知边界

- **QQ 式抓屏仅限 Windows**：依赖 PowerShell + System.Drawing；其他平台自动回退到浏览器共享（回退模式下系统级共享确认无法跳过，浏览器安全机制强制弹）。
- **首帧延迟**：每次抓屏要启动一个 PowerShell 进程（含 Add-Type 编译），实测约 0.5–1.5s。
- **浏览器窗口自身会被截进去**：冻结图包含点按钮那一刻的整个屏幕（含 DSH 页面），与 QQ 一致；浮层在抓屏之后才出现，不会入镜。
- **多显示器**：抓取整个虚拟桌面，可跨屏框选；若多屏缩放比例不同，显示为一张拼合大图。
- **无全局定时器**：client 半禁用 `setTimeout`/`setInterval`/`requestAnimationFrame`，等待视频帧用 `loadedmetadata` + React `useEffect`。
- **识别请求体上限 20MB**：超大区域的高分辨率 PNG 可能超限，框小一点即可。

## 🛠️ 技术要点

- **本地抓屏（QQ 式）**：Host 用 `spawn powershell -EncodedCommand` 跑一段内嵌脚本：`SetProcessDPIAware()` + `GetSystemMetrics(76..79)` 取虚拟桌面物理像素范围 + `CopyFromScreen` 抓图 + PNG base64 输出；带 15s 超时与 96MB 输出上限。
- **host 半用 `webServer` 而非 `harness.handle`**：preset 包用 `ctx.webServer.register({ kind:'exact', path, handler })` 提供接口，client 用 `fetch` 调用——这是标准 preset 插件路径（与 `dsh-file-uploads` 一致）。
- **同源校验**：浏览器 POST 一定带 Origin 头，两个接口都校验 Origin 与 Host 一致，拒绝外站页面跨域调用（防 CSRF 触发抓屏/注入）。
- **提示词输入为受控组件**：`onChange` 必须触发重渲染（`force`），否则 React 会把输入框还原到上次渲染值——表现为「输入不显示、只发出最后一个字」。
- **松手坐标取自 `pointerup` 事件**：终点不依赖最后一次 `pointermove` 的渲染状态，快速拖动不滞后；并用 `setPointerCapture` 保证拖出 stage 也能收到松手事件。
- **样式用 DOM 注入**：client 半用 `document.createElement('style')` + `document.head.appendChild` 注入 CSS（带 `data-plugin-css` 唯一 ID 防重），而不是 `styles` 服务。
- **坐标换算按实际显示区域**：冻结图 stage 与图片显示区完全重合（`objectFit:'fill'`），按 `boxSize.w / naturalWidth` 换算；回退路径用 stage 尺寸与视频自然尺寸算 `scale/offX/offY`，避免黑边错位。

## 📄 License

[MIT](LICENSE) © 2026
