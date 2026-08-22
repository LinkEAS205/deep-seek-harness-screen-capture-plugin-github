<div align="center">

# 📸 Screen Snap — 实时框选截图识别插件（DSH）

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 界面打造的实时屏幕框选 + 多模态识别插件。**

> 共享屏幕 → 拖拽框选一块区域 → 预览确认 → 截图自动进入当前会话 → 多模态模型识别，并可持续追问。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DSH%20Web-lightgrey)]()

</div>

## ✨ 特性

- **实时框选**：像 QQ 截图一样在**实时共享画面**上拖拽框选，松手取当前帧，无冻结等待。
- **预览确认**：框选后先预览 + 可编辑识别提示词，确认无误才发送；支持「重新框选」。
- **区域精确**：框选区域完全贴合图片，无黑边，不会误框到空白区。
- **玻璃拟态 UI**：触发按钮与整个捕获浮层统一为半透明 + 毛玻璃 + 细边框 + 高圆角风格。
- **可继续追问**：截图作为**真实用户消息**注入当前会话，模型下一轮看到后可持续对话。
- **本地优先**：截图仅存于 DSH 本地附件库，只有发给模型识别那一次是网络外发。
- **随启动自动加载**：作为真正的 **preset 插件包**（`dsh.client` + bundle），每次 DSH Web 启动都会自动出现，重启不丢失。

## 🔌 原理

```
点「截图识别」→ getDisplayMedia 共享屏幕 → 实时画面直接框选
  → 取当前帧 + 按实际显示区域换算坐标 → 裁剪成 PNG data URL
  → fetch('/api/dsh-screen-snap/recognize', { dataUrl, prompt, sessionId })
  → Host: ctx.apiProxy.sessions.prompt(...) 注入会话（durably 接纳图片 + 入队 user 消息 + 触发下一轮）
  → 多模态模型看图识别 → 继续对话
```

- **Host 半（`index.js`）**：`webServer` 注册 `POST /api/dsh-screen-snap/recognize`，内部经 `ctx.apiProxy.sessions.prompt` 注入。
- **Client 半（`client.js`）**：`window.__ModuleLoader__.load` + React，注册到 `conversation.input.left` 槽位（触发按钮）与 `shell.overlay`（全屏捕获浮层）。

## 📦 目录结构

```
screen-capture-plugin/
├── client.js         # Client 半（框选交互 / 预览 / 浮层 UI）
├── index.js          # Host 半（webServer 接口 + 注入会话）
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
4. **重启 DSH Web 服务**，让 `client-modules` 扫描到新 bundle。

### 使用
1. 进入一个会话，点 composer 输入框左侧的「📷 截图识别」。
2. 点「开始截屏」→ 浏览器弹**系统级共享确认**（选要共享的屏幕/窗口）。
3. 在实时画面上**拖拽框选**要识别的区域，松手。
4. 在预览确认界面点「✅ 确认发送」（或「↺ 重新框选」）。
5. 截图进入会话，多模态模型识别后即可继续追问。

## 🧩 依赖与 Slot

| 项 | 说明 |
|---|---|
| `dsh.client.platform: 'web'`（`package.json`） | 声明 Client 半 bundle |
| `@deepseek-ai/dsh-host-webserver`（peer） | Host 半注册 HTTP 接口 |
| `react`（peer） | Client 半 UI |
| `conversation.input.left`（`id:'screen-snap'`, `order:90`） | 触发按钮 |
| `shell.overlay`（`id:'screen-snap-overlay'`, `order:90`） | 全屏捕获/结果浮层 |
| 多模态模型 | 识别用当前会话选中模型；不支持图像的模型会报 `MODEL_DOES_NOT_SUPPORT_IMAGES`，请切到如 `deepseek-v4-flash-vision-exp` |

## ⚠️ 已知边界

- **系统级共享确认无法跳过**：浏览器安全机制强制弹「选择要共享的屏幕/窗口」，代码无法关闭。
- **多显示器 / 系统缩放**：`getDisplayMedia` 拿物理像素、浏览器坐标可能带缩放；多屏或非 100% 缩放环境若出现框选偏移，需进一步的坐标校正。
- **无全局定时器**：client 半禁用 `setTimeout`/`setInterval`/`requestAnimationFrame`，等待视频帧用 `loadedmetadata` + React `useEffect`。

## 🛠️ 技术要点

- **host 半用 `webServer` 而非 `harness.handle`**：preset 包用 `ctx.webServer.register({ kind:'exact', path, handler })` 提供接口，client 用 `fetch` 调用——这是标准 preset 插件路径（与 `dsh-file-uploads` 一致）。
- **样式用 DOM 注入**：client 半用 `document.createElement('style')` + `document.head.appendChild` 注入 CSS（带 `data-plugin-css` 唯一 ID 防重），而不是 `styles` 服务。
- **坐标换算按实际显示区域**：用 stage 尺寸与视频自然尺寸算 `scale/offX/offY`，避免黑边错位。
- **可框选区 == 图片区**：stage 尺寸动态贴合视频，`objectFit:'fill'`。
- **禁用文本框选**：浮层 `user-select:none`。

## 📄 License

[MIT](LICENSE) © 2026
