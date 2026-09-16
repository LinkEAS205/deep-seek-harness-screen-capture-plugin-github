<div align="center">

# ✂ Screen Snap — 实时框选截图插件（DSH）

**为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web 界面打造的原生全屏框选截图插件。**
**A native fullscreen region-capture plugin for the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web UI.**

> 点「✂」→ 原生全屏窗口冻结整个桌面 → 直接在屏幕上拖拽框选（真·QQ 式）→ 回到网页预览 → 一张图落进输入栏，你自己配文字再发送。
> Click "✂" → a native fullscreen window freezes the desktop → drag-select right on the screen (true QQ-style) → back to the web preview → the crop lands in the composer and **you** write the message.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DSH%20Web-lightgrey)]()

**语言 / Language：** [中文](#中文) · [English](#english)

</div>

---

# 中文

## ✨ 特性

- **真·QQ 式原生框选**：点按钮后由本地 Host 弹出**无边框、置顶、铺满整个虚拟桌面**的原生窗口（PowerShell + WinForms），冻结画面按**物理像素 1:1** 显示——无缩放、无「选择要共享的屏幕/窗口」确认框，直接在"屏幕本身"上拖拽框选。
- **框选体验**：选区外变暗、选区内亮起、蓝色边框 + 实时宽高数字；Esc / 右键随时取消；误触（<4px）自动忽略。
- **多显示器**：一次盖住所有屏幕，可跨屏框选；高 DPI / 系统缩放下按物理像素抓取，不发糊。
- **截完不直接发，放进输入栏**：框选完成后回到网页预览，确认后这张图**落进 composer 的附件栏**（与拖拽 / 粘贴进来的图片完全一样）。你自己配文字、自己按发送——插件不再替你说话。
- **回退模式**：本地框选不可用（非 Windows / Host 异常）时自动回退到 `getDisplayMedia` 浏览器共享流程。
- **简洁触发**：composer 输入框左侧一枚纯剪刀 SVG 图标（无文字，悬停有提示），玻璃拟态风格。
- **放不进去会明说**：附件栏在会话忙碌时不接受新附件，那时"放入"会被静默忽略——插件会前后比对附件数量，**没进去就明确报错**，不假装成功。
- **本地优先 + 同源校验**：截图只在浏览器与本地 Host 之间传递，宿主接口都校验 Origin，拒绝外站跨域调用。
- **随启动自动加载**：作为真正的 **preset 插件包**（`dsh.client` + bundle），每次 DSH Web 启动都会自动出现，重启不丢失。

## 🔌 原理

```
点 ✂
  → POST /api/dsh-screen-snap/select（QQ 式，首选）
      Host: PowerShell 抓整个虚拟桌面（物理像素）→ WinForms 无边框置顶窗口 1:1 冻结显示
      → 原生鼠标拖拽框选（Esc / 右键取消）→ 松手裁剪 → PNG base64 回传
  →（回退）getDisplayMedia 共享屏幕 → 网页内实时画面框选 → 裁剪
  → 网页预览（可「↺ 重新框选」）
  → 点「📎 放入输入栏」：合成一次 document 级 drop，把图交给 composer 自己的附件通路
  → 缩略图出现在输入栏 → 你配文字 → 你按发送（这一轮对话插件完全不参与）
```

- **Host 半（`index.js`）**：注册 `POST /api/dsh-screen-snap/select`（弹原生框选窗口）与 `GET /api/dsh-screen-snap/diag`（诊断）。**它不碰会话、不注入任何消息。**
- **Client 半（`client.js`）**：`window.__ModuleLoader__.load` + React，注册到 `conversation.input.left` 槽位（剪刀按钮）与 `shell.overlay`（预览/结果浮层）。

## 📦 目录结构

```
screen-capture-plugin/
├── client.js         # Client 半（触发按钮 / 预览 / 浮层 UI）
├── index.js          # Host 半（webServer 接口 + 原生框选窗口）
├── cordis.patch.yml  # bundle 插件行
├── dsh.plugin.json   # 插件元数据
├── package.json      # 包声明（dsh.client + exports['./client']）
├── README.md         # 本文档
└── LICENSE           # MIT
```

## 🚀 安装

本插件**不需要构建**（`index.js` / `client.js` 都是手写源码）。放哪个目录都行，只要 dsh 进程读得到。

```powershell
# 1. 先确认 profile 名 —— profiles 下的目录名就是 profile 名
Get-ChildItem "$env:DSH_HOME\profiles" -Directory | Select-Object -ExpandProperty Name

# 2. 安装：<PROFILE> 换成上面的名字，<PLUGIN_DIR> 换成本仓库所在的绝对路径
#    ⚠️ Windows 下 link: 后面要用正斜杠 /，不要用反斜杠
pnpm dsh plugin --profile <PROFILE> add "link:<PLUGIN_DIR>"
#    例：pnpm dsh plugin --profile web add "link:D:/tools/dsh-client-screen-snap"
```

- `$env:DSH_HOME` 没设的话默认就是 `~/.dsh`（Windows：`C:\Users\<你>\.dsh`）。
- profile 不存在时，`dsh plugin --profile <名字> add <包>` 会一并把它建出来。
- `dsh plugin` 会把声明了 `dsh.bundle.patch` 的依赖自动加进 `dsh.profile.bundles`。

**装完必须重启 `dsh web`**（客户端模块图在启动时组装），然后刷新页面。

### 使用

1. 进入一个会话，点 composer 输入框左侧的「✂」。
2. 整个桌面被原生全屏窗口冻结（首帧约 0.8s），鼠标变十字。
3. **直接拖拽框选**要截的区域，选区亮起并显示尺寸；Esc 或右键取消。
4. 松手后回到网页预览，点「📎 放入输入栏」（或「↺ 重新框选」重新弹窗）。
5. 图的缩略图出现在输入栏里——接下来**你自己打字、自己按发送**。不想要就点缩略图角上的 ×。

## 🧩 依赖与 Slot

| 项 | 说明 |
|---|---|
| `dsh.client.platform: 'web'`（`package.json`） | 声明 Client 半 bundle |
| `@deepseek-ai/dsh-host-webserver`（peer） | Host 半注册 HTTP 接口 |
| `react`（peer） | Client 半 UI |
| Windows + PowerShell 5.1（WinForms） | QQ 式原生框选依赖；非 Windows 自动走浏览器共享回退 |
| `conversation.input.left`（`id:'screen-snap'`, `order:90`） | 剪刀触发按钮 |
| `shell.overlay`（`id:'screen-snap-overlay'`, `order:90`） | 预览/结果浮层 |
| 多模态模型 | 图放进输入栏后由**你自己**发送；当前会话若选了不支持图像的模型，DSH 会在发送时报 `MODEL_DOES_NOT_SUPPORT_IMAGES`——与手动粘贴一张图的行为完全一致 |

## ⚠️ 已知边界

- **QQ 式框选仅限 Windows**：依赖 PowerShell + WinForms；其他平台自动回退到浏览器共享（回退模式下系统级共享确认无法跳过，浏览器安全机制强制弹）。
- **框选期间原生窗口接管整个桌面**：这是 QQ 式的固有行为，DSH 页面也被盖住；Esc / 右键退出后回到网页。
- **首帧约 0.8s**：每次框选都要冷启动一个 PowerShell 进程。实测拆分（`GET /api/dsh-screen-snap/diag` 的 `lastStage`）：进程启动 ≈400ms ｜ 程序集加载 50ms ｜ `Add-Type` 编译 101ms ｜ 抓屏 94ms ｜ 建窗首帧 131ms。前两项是"常驻 helper 进程"能省掉的，后两项省不掉。
- **DRM 保护内容 / UAC 安全桌面抓不到**（QQ 亦然）。
- **拍到的画面里会带上本插件自己的浮层**：抓屏发生在原生窗口出现之前，而那时网页浮层已经显示。截别的窗口不受影响（DSH 被压在后面），但要截 DSH 页面本身就会连浮层一起拍进去。
- **"放入输入栏"是合成事件**：见下方技术要点。它依赖 DSH 附件栏挂在 `document` 上的 drop 监听，以及浏览器的 `DataTransfer` / `DragEvent` 构造函数（Chrome 60+ / Edge / Firefox 62+ / Safari 14.1+）。DSH 将来若给插件开放正规的附件接口，这里应当换掉。
- **会话忙碌时放不进去**：附件栏此刻不接受新附件，那次 drop 会被静默忽略——插件会前后比对附件数量并**明确报错**，等上一条发完再试即可。

## 🛠️ 技术要点

- **原生框选窗口**：Host 用 `spawn powershell -EncodedCommand` 跑内嵌脚本：设置 Per-Monitor-Aware V2 DPI 认知 + `GetSystemMetrics(76..79)` 取虚拟桌面物理像素范围 → `CopyFromScreen` 抓图 → WinForms `Form`（`FormBorderStyle=None` + `TopMost` + `Bounds=虚拟桌面`）1:1 显示 → `Paint` 先画冻结图再盖半透明黑，选区用 `DrawImage(同 rect)` 亮起 + 蓝框 + 宽高文字 → `MouseDown/Move/Up` 维护选区、`KeyDown` Esc 取消 → `Application.Run` 结束后按选区裁剪输出 PNG base64；用户取消以退出码 3 区分。反射开启 `DoubleBuffered` 减少拖拽闪烁。
- **DPI 认知必须一步到位设成 PMv2**：只用旧的 `SetProcessDPIAware()`（system-DPI aware）时，缩放与系统 DPI 不一致的显示器会被 Windows 虚拟化坐标（1600×2560 @200% 的竖屏只报 800×1280），于是抓屏尺寸、窗口尺寸、遮罩范围全部算错，遮罩只盖住半块屏。
- **稳健性**：170s 外层超时防进程残留；`selecting` 单飞锁防并发弹窗；96MB 输出上限；取消（exit 3）与看门狗超时（exit 4）在协议上显式区分。
- **诊断靠 stderr 上的一行 `SCAP <json>`**：脚本把各阶段耗时与几何体检写进 stderr；宿主解析它落盘到 `.diag/screen-snap.log` 并由 `GET /diag` 读回。注意 PowerShell 的 stderr 是 CLIXML——脚本自己写的内容与结尾的 `<Objs …>` 之间**不一定有换行**，所以解析时要同时用换行和 `<Objs` 作终止符（脚本侧也已改用 `WriteLine`）。
- **host 半用 `webServer` 而非 `harness.handle`**：preset 包用 `ctx.webServer.register({ kind:'exact', path, handler })` 提供接口，client 用 `fetch` 调用——这是标准 preset 插件路径（与 `dsh-file-uploads` 一致）。
- **同源校验**：浏览器 POST 一定带 Origin 头，接口都校验 Origin 与 Host 一致，拒绝外站页面跨域调用（防 CSRF 触发抓屏）。
- **「放入输入栏」为什么是合成 drop**：DSH 公开的 `InputActions` 里，文字可以用 `setDraft()` 写进去，但附件只有 `addAttachments(ids)`——而那种 `DraftAttachmentId` 由 `ConversationController.createDrafts()` 铸造，只在 package-private 的 `ComposerBarInjected.addFiles` 上露头，第三方插件够不着。附件栏（`ui-attachment` 的 `ComposerAttachments`）在 `document` 上挂了 `drop` 监听，读到 `dataTransfer.files` 就交给产品自己的 `onAddFiles` —— 于是客户端构造 `File` + `DataTransfer` 后 `document.dispatchEvent(new DragEvent('drop', …))`，复用产品自己的校验与创建通路，不复制它的任何逻辑（与工具箱用 `element.click()` 代点原按钮同理）。
- **放入结果必须校验**：触发按钮在 session 作用域的槽里，通过标准 props 的 `useInput` 读 `attachmentIds.length` 并写进共享 store；浮层放进前后比对，两秒内没涨就报错——把"静默忽略"变成明确失败。
- **回退路径框选**：松手坐标取自 `pointerup` 事件（不依赖最后一次 `pointermove` 的渲染状态，快速拖动不滞后），并用 `setPointerCapture` 保证拖出 stage 也能收到松手事件；按 stage 尺寸与视频自然尺寸换算 `scale/offX/offY`，避免黑边错位。
- **样式用 DOM 注入**：client 半用 `document.createElement('style')` + `document.head.appendChild` 注入 CSS（带 `data-plugin-css` 唯一 ID 防重），而不是 `styles` 服务。

## 📄 License

[MIT](LICENSE) © 2026

---

# English

## ✨ Features

- **True QQ-style native region select** — the local Host pops a **borderless, always-on-top window covering the entire virtual desktop** (PowerShell + WinForms) that shows a frozen frame at **1:1 physical pixels**. No scaling, no "choose what to share" dialog: you drag directly on the screen itself.
- **Selection feel** — everything outside the selection is dimmed, the selection stays bright, with a blue border and a live size readout. `Esc` or right-click cancels; accidental taps (<4px) are ignored.
- **Multi-monitor** — one window covers every screen and you can select across monitors. Captured at physical pixels, so high DPI and OS scaling stay sharp.
- **It never sends for you** — after selecting you get a web preview; confirming **drops the image into the composer's attachment rail**, exactly like a dragged or pasted image. You write the text and press send.
- **Fallback mode** — when native capture is unavailable (non-Windows, or the Host errors) it falls back to the `getDisplayMedia` browser-share flow.
- **Minimal trigger** — a plain scissors SVG on the left of the composer (no label, tooltip on hover), frosted-glass styling.
- **It says so when it fails** — the attachment rail refuses new attachments while a session is busy, and a drop in that window is silently ignored. The plugin compares the attachment count before and after and **reports an explicit error** instead of pretending it worked.
- **Local-first + same-origin check** — the image only travels between the browser and the local Host, and every Host route validates `Origin` and rejects cross-site calls.
- **Loads on startup** — a real **preset plugin bundle** (`dsh.client` + patch), so it appears on every DSH Web start and survives restarts.

## 🔌 How it works

```
Click ✂
  → POST /api/dsh-screen-snap/select  (QQ-style, preferred path)
      Host: PowerShell captures the whole virtual desktop at physical pixels
      → a borderless, always-on-top WinForms window shows the frozen frame 1:1
      → native drag-select (Esc / right-click cancels) → crop on mouse-up → PNG base64 back
  → (fallback) getDisplayMedia share → select on the live video inside the page → crop
  → web preview  (「↺ Re-select」 available)
  → click 「📎 Put into composer」: synthesize a document-level drop and hand the image
    to the composer's own attachment pipeline
  → a thumbnail appears in the composer → you type → you press send
    (the plugin takes no part in that turn at all)
```

- **Host half (`index.js`)** registers `POST /api/dsh-screen-snap/select` (opens the native capture window) and `GET /api/dsh-screen-snap/diag` (diagnostics). **It never touches the session and never injects a message.**
- **Client half (`client.js`)** uses `window.__ModuleLoader__.load` + React, registering into `conversation.input.left` (the scissors button) and `shell.overlay` (the preview/result overlay).

## 📦 Layout

```
screen-capture-plugin/
├── client.js         # client half  (trigger button / preview / overlay UI)
├── index.js          # host half    (webServer routes + native capture window)
├── cordis.patch.yml  # bundle plugin row
├── dsh.plugin.json   # plugin metadata
├── package.json      # package declaration (dsh.client + exports['./client'])
├── README.md         # this document
└── LICENSE           # MIT
```

## 🚀 Install

There is **no build step** — `index.js` and `client.js` are hand-written source. Put the directory anywhere the dsh process can read.

```powershell
# 1. Find your profile name — the directory name under profiles/ IS the profile name
Get-ChildItem "$env:DSH_HOME\profiles" -Directory | Select-Object -ExpandProperty Name

# 2. Install: replace <PROFILE> and <PLUGIN_DIR> (absolute path to this repo)
#    WARNING: on Windows the path after `link:` must use forward slashes
pnpm dsh plugin --profile <PROFILE> add "link:<PLUGIN_DIR>"
#    e.g. pnpm dsh plugin --profile web add "link:D:/tools/dsh-client-screen-snap"
```

- If `$env:DSH_HOME` is unset it defaults to `~/.dsh` (on Windows: `C:\Users\<you>\.dsh`).
- A missing profile is created by `dsh plugin --profile <name> add <package>`.
- `dsh plugin` adds any dependency declaring `dsh.bundle.patch` to `dsh.profile.bundles` automatically.

**You must restart `dsh web` afterwards** (the client module graph is assembled at startup), then refresh the page.

### Usage

1. Open a session and click 「✂」 on the left of the composer.
2. The whole desktop is frozen by the native fullscreen window (first frame ≈ 0.8s) and the cursor becomes a crosshair.
3. **Drag to select** the region you want; the selection lights up with a live size readout. `Esc` or right-click cancels.
4. On mouse-up you return to the web preview. Click 「📎 Put into composer」 (or 「↺ Re-select」 to capture again).
5. A thumbnail appears in the composer — from there **you type and you press send**. Click the × on the thumbnail to discard it.

## 🧩 Dependencies & Slots

| Item | Notes |
|---|---|
| `dsh.client.platform: 'web'` (`package.json`) | declares the client-half bundle |
| `@deepseek-ai/dsh-host-webserver` (peer) | the host half registers HTTP routes |
| `react` (peer) | client-half UI |
| Windows + PowerShell 5.1 (WinForms) | required by the QQ-style native select; other platforms fall back to browser share |
| `conversation.input.left` (`id:'screen-snap'`, `order:90`) | the scissors trigger button |
| `shell.overlay` (`id:'screen-snap-overlay'`, `order:90`) | the preview / result overlay |
| A vision-capable model | the image is sent by **you**; if the session's model cannot accept images, DSH reports `MODEL_DOES_NOT_SUPPORT_IMAGES` on send — identical to pasting an image by hand |

## ⚠️ Known limits

- **QQ-style select is Windows-only** — it relies on PowerShell + WinForms. Other platforms fall back to browser share, where the OS-level share confirmation cannot be bypassed (enforced by the browser).
- **The native window takes over the whole desktop while selecting** — inherent to the QQ-style approach; the DSH page is covered too. `Esc` / right-click returns you to the page.
- **First frame ≈ 0.8s** — every capture cold-starts a PowerShell process. Measured breakdown (in `lastStage` from `GET /api/dsh-screen-snap/diag`): process start ≈400ms | assembly load 50ms | `Add-Type` compile 101ms | screen grab 94ms | window first paint 131ms. The first two are what a resident helper process could remove; the last two are not.
- **DRM-protected content and the UAC secure desktop cannot be captured** (same as QQ).
- **The plugin's own overlay is baked into the captured frame** — the grab happens before the native window appears, and by then the web overlay is already on screen. Capturing another window is unaffected (DSH sits behind it), but capturing the DSH page itself will include the overlay.
- **"Put into composer" is a synthesized event** — see the notes below. It relies on the DSH attachment rail listening for `drop` on `document`, and on the browser's `DataTransfer` / `DragEvent` constructors (Chrome 60+ / Edge / Firefox 62+ / Safari 14.1+). If DSH ever exposes a proper attachment API to plugins, this should be replaced.
- **A busy session will refuse it** — the attachment rail does not accept new attachments then, and that drop is silently ignored. The plugin compares attachment counts and **reports an explicit error**; retry once the previous message has been sent.

## 🛠️ Implementation notes

- **Native capture window** — the Host runs an embedded script via `spawn powershell -EncodedCommand`: set Per-Monitor-Aware V2 DPI awareness + read the virtual desktop's physical pixel bounds with `GetSystemMetrics(76..79)` → `CopyFromScreen` → show a WinForms `Form` (`FormBorderStyle=None` + `TopMost` + `Bounds=virtual desktop`) 1:1 → `Paint` draws the frozen bitmap, then a translucent black over it, then re-draws the selection with `DrawImage(same rect)` plus a blue border and a size label → `MouseDown/Move/Up` maintain the rectangle, `KeyDown` handles `Esc` → after `Application.Run` returns, crop to the selection and emit PNG base64. User cancellation is signalled by exit code 3. `DoubleBuffered` is enabled by reflection to reduce flicker while dragging.
- **DPI awareness must be PMv2 in one step** — with the older `SetProcessDPIAware()` (system-DPI aware), Windows virtualizes the coordinates of any monitor whose scale differs from the system DPI (a 1600×2560 @200% portrait panel reports as 800×1280), so the grab size, window size and dimming rect are all wrong and the overlay covers only half the panel.
- **Robustness** — a 170s outer timeout prevents orphaned processes; a `selecting` single-flight lock prevents concurrent windows; a 96MB output cap; cancellation (exit 3) and watchdog timeout (exit 4) are distinguished explicitly in the protocol.
- **Diagnostics ride one `SCAP <json>` line on stderr** — the script reports per-stage timings and a geometry check on stderr; the host parses it, appends to `.diag/screen-snap.log` and serves it back via `GET /diag`. Note that PowerShell's stderr is CLIXML, and there is **not necessarily a newline** between what the script writes and the trailing `<Objs …>` — so the parser treats both a newline and `<Objs` as terminators (the script side also switched to `WriteLine`).
- **The host half uses `webServer`, not `harness.handle`** — a preset package exposes routes with `ctx.webServer.register({ kind:'exact', path, handler })` and the client calls them with `fetch`. This is the standard preset plugin path (same as `dsh-file-uploads`).
- **Same-origin check** — browser POSTs always carry an `Origin` header; every route verifies it matches `Host`, rejecting cross-site calls from other pages (CSRF protection for screen capture).
- **Why "Put into composer" is a synthesized drop** — of the public `InputActions`, text can be written with `setDraft()`, but attachments only have `addAttachments(ids)` — and those `DraftAttachmentId`s are minted by `ConversationController.createDrafts()`, surfaced only on the package-private `ComposerBarInjected.addFiles`, which a third-party plugin cannot reach. The attachment rail (`ui-attachment`'s `ComposerAttachments`) listens for `drop` on `document` and passes `dataTransfer.files` to the product's own `onAddFiles`. So the client builds a `File` + `DataTransfer` and calls `document.dispatchEvent(new DragEvent('drop', …))`, reusing the product's own validation and creation path without copying any of its logic — the same technique the toolbox plugin uses with `element.click()`.
- **The result of the drop must be verified** — the trigger button lives in a session-scoped slot and reads `attachmentIds.length` through the standard `useInput` prop, writing it into the shared store. The overlay compares before/after and reports an error if the count has not grown within two seconds, turning a silent ignore into an explicit failure.
- **Fallback-path selection** — the release coordinates come from the `pointerup` event (not from the rendered state of the last `pointermove`, so fast drags don't lag), and `setPointerCapture` guarantees the release is received even when the pointer leaves the stage. Stage size and the video's intrinsic size are used to compute `scale/offX/offY`, avoiding letterbox misalignment.
- **Styles are injected through the DOM** — the client half uses `document.createElement('style')` + `document.head.appendChild` (with a unique `data-plugin-css` id to avoid duplicates) rather than the `styles` service.

## 📄 License

[MIT](LICENSE) © 2026
