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
- **"放入输入栏"是合成事件**：见下方技术要点。它依赖 DSH 附件栏挂在 `document` 上的 drop 监听，以及浏览器的 `DataTransfer` / `DragEvent` 构造函数（Chrome 60+ / Edge / Firefox 62+ / Safari 14.1+）。DSH 将来若给插件开放正规的附件接口，这里应当换掉。
- **会话忙碌时放不进去**：附件栏此刻不接受新附件，那次 drop 会被静默忽略——插件会前后比对附件数量并**明确报错**，等上一条发完再试即可。

## 🛠️ 技术要点

- **原生框选窗口**：Host 用 `spawn powershell -EncodedCommand` 跑内嵌脚本：`SetProcessDPIAware()` + `GetSystemMetrics(76..79)` 取虚拟桌面物理像素范围 → `CopyFromScreen` 抓图 → WinForms `Form`（`FormBorderStyle=None` + `TopMost` + `Bounds=虚拟桌面`）1:1 显示 → `Paint` 先画冻结图再盖半透明黑，选区用 `DrawImage(同 rect)` 亮起 + 蓝框 + 宽高文字 → `MouseDown/Move/Up` 维护选区、`KeyDown` Esc 取消 → `Application.Run` 结束后按选区裁剪输出 PNG base64；用户取消以退出码 3 区分。反射开启 `DoubleBuffered` 减少拖拽闪烁。
- **稳健性**：180s 超时防进程残留；`selecting` 单飞锁防并发弹窗；96MB 输出上限；取消（exit 3）与出错在协议上显式区分（`cancelled` 字段）。
- **host 半用 `webServer` 而非 `harness.handle`**：preset 包用 `ctx.webServer.register({ kind:'exact', path, handler })` 提供接口，client 用 `fetch` 调用——这是标准 preset 插件路径（与 `dsh-file-uploads` 一致）。
- **同源校验**：浏览器 POST 一定带 Origin 头，接口都校验 Origin 与 Host 一致，拒绝外站页面跨域调用（防 CSRF 触发抓屏）。
- **「放入输入栏」为什么是合成 drop**：DSH 公开的 `InputActions` 里，文字可以用 `setDraft()` 写进去，但附件只有 `addAttachments(ids)`——而那种 `DraftAttachmentId` 由 `ConversationController.createDrafts()` 铸造，只在 package-private 的 `ComposerBarInjected.addFiles` 上露头，第三方插件够不着。附件栏（`ui-attachment` 的 `ComposerAttachments`）在 `document` 上挂了 `drop` 监听，读到 `dataTransfer.files` 就交给产品自己的 `onAddFiles` —— 于是客户端构造 `File` + `DataTransfer` 后 `document.dispatchEvent(new DragEvent('drop', …))`，复用产品自己的校验与创建通路，不复制它的任何逻辑（与工具箱用 `element.click()` 代点原按钮同理）。
- **放入结果必须校验**：触发按钮在 session 作用域的槽里，通过标准 props 的 `useInput` 读 `attachmentIds.length` 并写进共享 store；浮层放进前后比对，两秒内没涨就报错——把"静默忽略"变成明确失败。
- **回退路径框选**：松手坐标取自 `pointerup` 事件（不依赖最后一次 `pointermove` 的渲染状态，快速拖动不滞后），并用 `setPointerCapture` 保证拖出 stage 也能收到松手事件；按 stage 尺寸与视频自然尺寸换算 `scale/offX/offY`，避免黑边错位。
- **样式用 DOM 注入**：client 半用 `document.createElement('style')` + `document.head.appendChild` 注入 CSS（带 `data-plugin-css` 唯一 ID 防重），而不是 `styles` 服务。

## 📄 License

[MIT](LICENSE) © 2026
