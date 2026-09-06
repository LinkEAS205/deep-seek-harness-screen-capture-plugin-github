<div align="center">

# ✂ Screen Snap — 实时框选截图识别插件（DSH）

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 界面打造的实时屏幕框选 + 多模态识别插件。**

> 点「✂」→ 原生全屏窗口冻结整个桌面 → 直接在屏幕上拖拽框选（真·QQ 式）→ 回到网页预览 + 输入提示词 → 发送 → 多模态模型识别，可持续追问。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DSH%20Web-lightgrey)]()

</div>

## ✨ 特性

- **真·QQ 式原生框选**：点按钮后由本地 Host 弹出**无边框、置顶、铺满整个虚拟桌面**的原生窗口（PowerShell + WinForms），冻结画面按**物理像素 1:1** 显示——无缩放、无「选择要共享的屏幕/窗口」确认框，直接在"屏幕本身"上拖拽框选。
- **框选体验**：选区外变暗、选区内亮起、蓝色边框 + 实时宽高数字；Esc / 右键随时取消；误触（<4px）自动忽略。
- **多显示器**：一次盖住所有屏幕，可跨屏框选；高 DPI / 系统缩放下按物理像素抓取，不发糊。
- **预览 + 提示词**：框选完成后回到网页预览，可编辑识别提示词（默认"请识别这张截图的内容。"），确认后才发送；可「↺ 重新框选」（重新弹出原生窗口）。
- **回退模式**：本地框选不可用（非 Windows / Host 异常）时自动回退到 `getDisplayMedia` 浏览器共享流程。
- **简洁触发**：composer 输入框左侧一枚纯剪刀 SVG 图标（无文字，悬停有提示），玻璃拟态风格。
- **可继续追问**：截图作为**真实用户消息**注入当前会话，模型下一轮看到后可持续对话。
- **本地优先 + 同源校验**：截图仅存于 DSH 本地附件库，只有发给模型识别那一次是网络外发；两个接口都校验 Origin，拒绝外站跨域调用。
- **随启动自动加载**：作为真正的 **preset 插件包**（`dsh.client` + bundle），每次 DSH Web 启动都会自动出现，重启不丢失。

## 🔌 原理

```
点 ✂
  → POST /api/dsh-screen-snap/select（QQ 式，首选）
      Host: PowerShell 抓整个虚拟桌面（物理像素）→ WinForms 无边框置顶窗口 1:1 冻结显示
      → 原生鼠标拖拽框选（Esc / 右键取消）→ 松手裁剪 → PNG base64 回传
  →（回退）getDisplayMedia 共享屏幕 → 网页内实时画面框选 → 裁剪
  → 网页预览 + 输入提示词
  → POST /api/dsh-screen-snap/recognize { dataUrl, prompt, sessionId }
      → Host: ctx.apiProxy.sessions.prompt(...) 注入会话（durably 接纳图片 + 入队 user 消息 + 触发下一轮）
  → 多模态模型看图识别 → 继续对话
```

- **Host 半（`index.js`）**：注册 `POST /api/dsh-screen-snap/select`（弹原生框选窗口）与 `POST /api/dsh-screen-snap/recognize`（注入会话）。
- **Client 半（`client.js`）**：`window.__ModuleLoader__.load` + React，注册到 `conversation.input.left` 槽位（剪刀按钮）与 `shell.overlay`（预览/结果浮层）。

## 📦 目录结构

```
screen-capture-plugin/
├── client.js         # Client 半（触发按钮 / 预览 / 浮层 UI）
├── index.js          # Host 半（webServer 接口 + 原生框选窗口 + 注入会话）
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

1. 进入一个会话，点 composer 输入框左侧的「✂」。
2. 整个桌面被原生全屏窗口冻结（首帧约 1–1.5s），鼠标变十字。
3. **直接拖拽框选**要识别的区域，选区亮起并显示尺寸；Esc 或右键取消。
4. 松手后回到网页预览，可输入提示词，点「✅ 确认发送」（或「↺ 重新框选」重新弹窗）。
5. 截图进入会话，多模态模型识别后即可继续追问。

## 🧩 依赖与 Slot

| 项 | 说明 |
|---|---|
| `dsh.client.platform: 'web'`（`package.json`） | 声明 Client 半 bundle |
| `@deepseek-ai/dsh-host-webserver`（peer） | Host 半注册 HTTP 接口 |
| `react`（peer） | Client 半 UI |
| Windows + PowerShell 5.1（WinForms） | QQ 式原生框选依赖；非 Windows 自动走浏览器共享回退 |
| `conversation.input.left`（`id:'screen-snap'`, `order:90`） | 剪刀触发按钮 |
| `shell.overlay`（`id:'screen-snap-overlay'`, `order:90`） | 预览/结果浮层 |
| 多模态模型 | 识别用当前会话选中模型；不支持图像的模型会报 `MODEL_DOES_NOT_SUPPORT_IMAGES`，请切到如 `deepseek-v4-flash-vision-exp` |

## ⚠️ 已知边界

- **QQ 式框选仅限 Windows**：依赖 PowerShell + WinForms；其他平台自动回退到浏览器共享（回退模式下系统级共享确认无法跳过，浏览器安全机制强制弹）。
- **框选期间原生窗口接管整个桌面**：这是 QQ 式的固有行为，DSH 页面也被盖住；Esc / 右键退出后回到网页。
- **首帧延迟**：每次框选要启动一个 PowerShell 进程（含 Add-Type 编译）+ 抓屏，实测约 1–1.5s。
- **DRM 保护内容 / UAC 安全桌面抓不到**（QQ 亦然）。
- **无全局定时器**：client 半禁用 `setTimeout`/`setInterval`/`requestAnimationFrame`，等待视频帧用 `loadedmetadata` + React `useEffect`。
- **识别请求体上限 20MB**：超大区域的高分辨率 PNG 可能超限，框小一点即可。

## 🛠️ 技术要点

- **原生框选窗口**：Host 用 `spawn powershell -EncodedCommand` 跑内嵌脚本：`SetProcessDPIAware()` + `GetSystemMetrics(76..79)` 取虚拟桌面物理像素范围 → `CopyFromScreen` 抓图 → WinForms `Form`（`FormBorderStyle=None` + `TopMost` + `Bounds=虚拟桌面`）1:1 显示 → `Paint` 先画冻结图再盖半透明黑，选区用 `DrawImage(同 rect)` 亮起 + 蓝框 + 宽高文字 → `MouseDown/Move/Up` 维护选区、`KeyDown` Esc 取消 → `Application.Run` 结束后按选区裁剪输出 PNG base64；用户取消以退出码 3 区分。反射开启 `DoubleBuffered` 减少拖拽闪烁。
- **稳健性**：180s 超时防进程残留；`selecting` 单飞锁防并发弹窗；96MB 输出上限；取消（exit 3）与出错在协议上显式区分（`cancelled` 字段）。
- **host 半用 `webServer` 而非 `harness.handle`**：preset 包用 `ctx.webServer.register({ kind:'exact', path, handler })` 提供接口，client 用 `fetch` 调用——这是标准 preset 插件路径（与 `dsh-file-uploads` 一致）。
- **同源校验**：浏览器 POST 一定带 Origin 头，两个接口都校验 Origin 与 Host 一致，拒绝外站页面跨域调用（防 CSRF 触发抓屏/注入）。
- **提示词输入为受控组件**：`onChange` 必须触发重渲染（`force`），否则 React 会把输入框还原到上次渲染值——表现为「输入不显示、只发出最后一个字」。
- **回退路径框选**：松手坐标取自 `pointerup` 事件（不依赖最后一次 `pointermove` 的渲染状态，快速拖动不滞后），并用 `setPointerCapture` 保证拖出 stage 也能收到松手事件；按 stage 尺寸与视频自然尺寸换算 `scale/offX/offY`，避免黑边错位。
- **样式用 DOM 注入**：client 半用 `document.createElement('style')` + `document.head.appendChild` 注入 CSS（带 `data-plugin-css` 唯一 ID 防重），而不是 `styles` 服务。

## 📄 License

[MIT](LICENSE) © 2026
