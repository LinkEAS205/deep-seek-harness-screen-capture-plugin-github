# dsh-client-screen-snap v1.4.0

**语言 / Language：** [中文](#中文) · [English](#english)

---

# 中文

这一版改了插件的行为方式：**截图不再替你发送，而是放进输入栏。**

## 🔄 变更

### 截完 → 放进输入栏，而不是直接发出

- **以前**：框选 → 预览 → 点「✅ 确认发送」→ 插件通过宿主把一张图作为用户消息注入会话 → 模型立刻开始回答。
- **现在**：框选 → 预览 → 点「📎 放入输入栏」→ 图的缩略图出现在 composer 的附件栏 → **你自己配文字、自己按发送**。

为什么改：截图之后想说什么，本来就该由你说。以前那条路把"发图"和"提问"绑死在一起，用户只能被动接受插件替他生成的那条消息。

```
点 ✂ → 原生框选 → 预览 → 「📎 放入输入栏」
      → 合成一次 document 级 drop，交给 composer 自己的附件通路
      → 缩略图出现在输入栏 → 你配文字 → 你按发送
```

### 浮层里的提示词输入框已移除

配文字这件事天然属于 composer 的草稿框，浮层不再重复一遍。上一版为这个框加的"默认提示词"逻辑随之整体消失。

## ❌ 移除

- **`POST /api/dsh-screen-snap/recognize` 已删除。** 插件不再注入任何消息、不再调用 `sessionController.prompt`。宿主半边现在只做两件事：弹原生框选窗口、提供诊断端点（共 2 条路由）。
- 由于不再把图 POST 给宿主，**"识别请求体上限 20MB"这条边界随之消失**。

## ✨ 新增

- **放入结果会被校验**：附件栏在会话忙碌时不接受新附件，那时那次 drop 会被**静默忽略**。触发按钮在 session 作用域的槽里，通过标准 props 的 `useInput` 读 `attachmentIds.length` 写进共享 store；浮层放进前后比对，两秒内没涨就在浮层里明确报错——不假装成功。

## 🛠️ 实现说明

**为什么是"合成 drop"而不是直接调 API。** DSH 公开给 session 槽组件的 `InputActions` 里，文字可以用 `setDraft()` 写进去，但附件只有 `addAttachments(ids)` —— 而那种 `DraftAttachmentId` 由 `ConversationController.createDrafts()` 铸造，只在 **package-private** 的 `ComposerBarInjected.addFiles` 上露头，第三方插件够不着。

附件栏（`ui-attachment` 的 `ComposerAttachments`）在 `document` 上挂了 `drop` 监听，读到 `dataTransfer.files` 就交给产品自己的 `onAddFiles`。于是客户端：

```js
const file = dataUrlToFile(store.previewUrl, 'screenshot.png')   // data URL -> File
const dataTransfer = new DataTransfer()
dataTransfer.items.add(file)
document.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
```

**复用产品自己的校验与创建通路，不复制它的任何逻辑** —— 与工具箱插件用 `element.click()` 代点第三方原按钮是同一种手法。

> ⚠️ 这是取巧。DSH 将来若给插件开放正规的附件接口，这里应当换掉。代码注释与 README 都已写明。

## 📦 安装

目录放到任意位置，在 `~/.dsh/profiles/<profile>/package.json` 里加 `link:<绝对路径>` 依赖与 `dsh.profile.bundles`，`pnpm install`，然后**重启 DSH Web 并刷新页面**。

> 宿主脚本与客户端 bundle 都是**启动时读入内存**：改完插件必须重启 `dsh web` 再刷新页面才会生效。

## ✅ 本次怎么验的

- `node --check` 两个半边通过；`recognize` / `RECOGNIZE_PATH` / `readJsonBody` / `randomUUID` / `store.prompt` / `confirmSend` 等 10 个旧标识符在两个文件里**残留为 0**。
- 宿主现在只注册 2 条路由（`select` + `diag`），逐行确认。
- `dataUrlToFile()` 单独离线验过 **7/7**：文件名保持、MIME 取自 data URL 头、字节数与 base64 解码一致、PNG 魔数正确、是真正的 `File` 实例、其他 MIME 可解析、非 data URL 会抛错而不是产出空文件。

---

# English

This release changes what the plugin does with the crop: instead of sending it for you, it **drops it into the composer**.

## 🔄 Changed

### Capture → into the composer, not straight into the conversation

- **Before**: select → preview → click "✅ Send" → the plugin injected the image into the session as a user message through the host → the model started answering immediately.
- **Now**: select → preview → click "📎 Put into composer" → the thumbnail appears in the composer's attachment rail → **you write the text and you press send**.

Why: what you want to say about a screenshot is yours to say. The old path welded "send the image" and "ask the question" together, leaving the user to accept whatever message the plugin had generated for them.

```
Click ✂ → native select → preview → 「📎 Put into composer」
        → synthesize a document-level drop, handed to the composer's own attachment pipeline
        → thumbnail in the composer → you type → you press send
```

### The prompt input in the overlay is gone

Writing the message belongs in the composer's draft box; the overlay no longer duplicates it. The "default prompt" logic added for that box in the previous release disappears with it.

## ❌ Removed

- **`POST /api/dsh-screen-snap/recognize` is deleted.** The plugin no longer injects any message and no longer calls `sessionController.prompt`. The host half now does exactly two things: open the native capture window and serve diagnostics (2 routes in total).
- Since the image is no longer POSTed to the host, **the "20MB recognition payload" limit is gone too**.

## ✨ Added

- **The drop is verified.** The attachment rail refuses new attachments while a session is busy, and a drop in that window would be **silently ignored**. The trigger button lives in a session-scoped slot and reads `attachmentIds.length` through the standard `useInput` prop, writing it into the shared store. The overlay compares before/after and reports an explicit error if the count has not grown within two seconds — it does not pretend to have succeeded.

## 🛠️ Implementation notes

**Why a synthesized drop instead of a direct API call.** Of the `InputActions` DSH exposes to session-scoped slot components, text can be written with `setDraft()`, but attachments only have `addAttachments(ids)` — and those `DraftAttachmentId`s are minted by `ConversationController.createDrafts()`, surfaced only on the **package-private** `ComposerBarInjected.addFiles`, which a third-party plugin cannot reach.

The attachment rail (`ui-attachment`'s `ComposerAttachments`) listens for `drop` on `document` and passes `dataTransfer.files` to the product's own `onAddFiles`. So the client does:

```js
const file = dataUrlToFile(store.previewUrl, 'screenshot.png')   // data URL -> File
const dataTransfer = new DataTransfer()
dataTransfer.items.add(file)
document.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
```

**It reuses the product's own validation and creation path without copying any of its logic** — the same technique the toolbox plugin uses when it clicks a third-party button with `element.click()`.

> ⚠️ This is a workaround. If DSH ever exposes a proper attachment API to plugins, this should be replaced. Both the code comments and the README say so.

## 📦 Install

Put the directory anywhere, add a `link:<absolute path>` dependency and a `dsh.profile.bundles` entry to `~/.dsh/profiles/<profile>/package.json`, run `pnpm install`, then **restart DSH Web and refresh the page**.

> Both the host script and the client bundle are **read into memory at startup**: after changing the plugin you must restart `dsh web` and refresh before anything takes effect.

## ✅ How this release was verified

- `node --check` passes for both halves; 10 old identifiers (`recognize`, `RECOGNIZE_PATH`, `readJsonBody`, `randomUUID`, `store.prompt`, `confirmSend`, …) are **down to zero** across both files.
- The host now registers exactly 2 routes (`select` + `diag`), confirmed line by line.
- `dataUrlToFile()` was verified offline on its own, **7/7**: name preserved, MIME taken from the data URL header, byte count matching the base64 decode, PNG magic correct, a genuine `File` instance, other MIME types parsed, and malformed input throwing instead of producing an empty file.
