# dsh-client-screen-snap v1.4.0

这一版改了插件的行为方式：**截图不再替你发送，而是放进输入栏**。

This release changes what the plugin does with the crop: instead of sending it for you, it **drops it into the composer**.

---

## 🔄 变更 / Changed

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

配文字这件事天然属于 composer 的草稿框，浮层不再重复一遍。（上一版为这个框加的"默认提示词"逻辑，随之整体消失。）

## ❌ 移除 / Removed

- **`POST /api/dsh-screen-snap/recognize` 已删除。** 插件不再注入任何消息、不再调用 `sessionController.prompt`，宿主半边现在只做两件事：弹原生框选窗口、提供诊断端点。
- 由于不再把图 POST 给宿主，**"识别请求体上限 20MB"这条边界随之消失**。

## ✨ 新增 / Added

- **放入结果会被校验**：附件栏在会话忙碌时不接受新附件，那时那次 drop 会被**静默忽略**。触发按钮在 session 作用域的槽里，通过标准 props 的 `useInput` 读 `attachmentIds.length` 写进共享 store；浮层放进前后比对，两秒内没涨就在浮层里明确报错——不假装成功。这正是本插件历史上最典型的那类 bug（v1.3.0 的几何诊断、1.3.1 的 SCAP 解析都栽在"静默失败"上）。

## 🛠️ 实现说明 / How

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

## 📦 安装 / Install

目录放到 `~/.dsh/plugins/dsh-client-screen-snap/`，在 `~/.dsh/profiles/<profile>/package.json` 里加依赖与 `dsh.profile.bundles`，`pnpm install`，然后**重启 DSH Web 并刷新页面**。

> 宿主脚本与客户端 bundle 都是**启动时读入内存**：改完插件必须重启 `dsh web` 再刷新页面才会生效。

## ✅ 这次改动是怎么验的

- `node --check` 两个半边通过；`recognize` / `RECOGNIZE_PATH` / `readJsonBody` / `randomUUID` / `store.prompt` / `confirmSend` 等 10 个旧标识符在两个文件里**残留为 0**。
- 宿主现在只注册 2 条路由（`select` + `diag`），已逐行确认。
- `dataUrlToFile()` 单独离线验过 **7/7**：文件名保持、MIME 取自 data URL 头、字节数与 base64 解码一致（70 bytes）、PNG 魔数正确、是真正的 `File` 实例、其他 MIME 可解析、非 data URL 会抛错而不是产出空文件。
