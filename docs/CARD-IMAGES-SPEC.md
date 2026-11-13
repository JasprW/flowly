# 卡片描述图片（Card images）

Issue: JasprW/flowly#99 “Add image as description”。卡片的描述可以带图片（截图、设计稿、报错画面），人在侧栏能看，agent 在 session 里能读到。

状态：已设计，未实现（2026-11-13）。

## 1. 用户决定（2026-11-13）

1. **存副本，放插件数据目录。** 图片复制到 `<plugin data>/card-images/<taskId>/`，属于卡片自己，不算产物。CARD-ARTIFACTS-SPEC §11.1“只存引用、不上传副本”只管产物，不变；本 spec 是那条之外新增的一种卡片数据。否决的方案：写进 `<workspace>/.flowly/images/` 再登记为 input 产物（在用户仓库留未跟踪文件，Wrap up 删除 worktree 时图片跟着丢）。
2. **手机不加图片选择器。** 维持 2026-10-21 的决定（SESSION-PANE-SPEC §6）：插件 SDK 0.16.0-beta.2 仍没有图片选择器（`addAttachmentSource` / `PluginComposer.addAttachment` 的条目是 `{ url, text, … }` 文本项，不是图片），不调用宿主内部的 `expo-image-picker`。手机能看、能删卡片图片，不能添加；session 里要发图，用已有的 **Open in Paseo** 进入 Paseo 原生输入框（自带图片选择器）。另向 getpaseo 提 SDK 图片选择器需求（提交前由用户确认），SDK 提供后再给手机加入口。
3. **描述下方一排缩略图。** 描述仍是纯文本，图片不嵌入文字中间。

## 2. 数据

### 2.1 Task 字段

```
task.images?: CardImage[]      // 缺失读作 []
CardImage = { id, name, mimeType, bytes, createdAt }
```

- `id`：`img-<uuid>`；`name`：原文件名或 “Pasted image”，≤120；`mimeType`：`shared/composer.ts` 的 `imageMimeTypes`（PNG/JPEG/GIF/WebP）；`bytes`：原图字节数。
- 上限：每张 ≤5 MB（`maxImageBytes`），每卡 ≤8 张（`cardImageLimit`，`shared/model.ts`）。
- 增删图片增加 task revision（与改描述一致），带 `expectedRevision` CAS；卡片活动不记事件（与改描述一致）。看板 schema 版本不变；SQLite 存在 task 行的 JSON 里，不加表。
- native chip 投影不带 `images`（与描述一样清空）；总览与单卡详情带记录（只有元数据，不含图片内容）。

### 2.2 文件

- 原图：`<plugin data>/card-images/<taskId>/<id>.<ext>`；缩略图：`<id>.thumb.<ext>`（§4.2）。目录 0700，文件 0600。
- 写入顺序：先写临时文件再 rename，然后写看板；看板写失败时删除刚写的文件。
- 插件启动时清理不被任何卡（含已归档卡）引用的文件，只删 `card-images/` 下的文件。
- 删卡（TASK-DELETE-SPEC）与移除项目（PROJECT-REMOVE-SPEC）：把该卡的图片目录移到 `removed/task-<id>-images-<time>/`，与其他备份一起保留。归档、Wrap up、移出 Done 不动图片。
- 每日 SQLite 备份和导出不含图片文件。

## 3. RPC（`shared/rpc.ts`）

| RPC | 输入 | 输出 |
| --- | --- | --- |
| `card-images.add` | `{ taskId, expectedRevision, image: { name, mimeType, data }, thumb?: { mimeType, data } }`（base64） | `{ task }` |
| `card-images.remove` | `{ taskId, expectedRevision, id }` | `{ task }` |
| `card-images.read` | `{ taskId, id, size: "thumb" \| "full" }` | `{ dataUri }` |

- `add` 校验 MIME、解码后大小、张数、卡片存在且未归档、revision；一次一张，客户端多张时依次调用。
- `read` 只读 `task.images` 里登记的 id；`thumb` 不存在时返回原图。内容不可变，客户端按 `(taskId, id, size)` 缓存，`staleTime: Infinity`。
- 已归档卡只读：`add`/`remove` 拒绝。

## 4. 客户端

### 4.1 显示

- 侧栏描述区（`client/drawer.tsx`）：描述文字下方一排 64×64 缩略图（`AttachmentThumb` 同款，`client/image-attach.tsx`），超出换行；无图片时不占位。点缩略图打开插件 Modal 看原图（手机为全屏），可左右切换、删除。
- 只在侧栏打开且描述区可见时请求缩略图；原图只在打开大图时请求。
- 看板卡面不显示图片或数量（同产物，CARD-ARTIFACTS-SPEC §10）。

### 4.2 添加（仅 web）

- 编辑描述时（New task、Edit task；侧栏没有描述编辑器，不在侧栏添加），描述框接受粘贴和拖放图片，下方有 **Add images** 按钮（浏览器文件选择器），即复用 `ImageAttachments` / `client/web-images.ts`。
- web 在上传前用 canvas 生成长边 ≤320px 的缩略图（WebP，不支持时 JPEG），随 `add` 一起发送；生成失败则不带缩略图。这扩大了 `client/web-images.ts` 的 web 例外（新增 canvas 使用），同样做功能检测、不渲染 HTML；AGENTS.md 的例外条目一并改写。
- New task：图片挂在描述上，存到新卡。New task 现有的“首条消息图片”（agent instruction 框）合并进来：表单只保留描述下的一排图片，首个 session 通过 §5 拿到它们，不再另发首条消息图片。侧栏 New session 的首条消息图片不变。
- 手机：不显示 **Add images**；已有图片照常显示，可在大图里删除。

### 4.3 错误

沿用 `readImages` 的文案（类型、5 MB、张数）；张数上限换成卡片上限：“At most {cardImageLimit} images per card.”。卡片被别人改过：现有 revision 冲突提示，重新读取后重试。

## 5. Agent 侧

- `sessionContext`（`shared/scope.ts`）在描述后加一行：`Card images (part of the description; view each with your image tool): <absolutePath>, …`。创建 session 和 “Send Kanban work instructions” 都带。
- `flowly_get_task` 的 `task.images` 每项带 `absolutePath`；技能文本（`server/skill-source.ts`）加一句：卡片图片是描述的一部分，开始前查看；读不到（provider 没有图片工具）时在回复里说明，不要猜。
- 自动验收的评审 session（AUTO-REVIEW-SPEC）提示里同样列出图片路径，判断“做到了用户要求的事”时参考。
- 卡片摘要、Insights、记忆复盘不读图片。
- 不经客户端传图片字节给 agent（手机 JS 线程要解密所有响应，PERFORMANCE-SPEC）；不改用 `agents.create({ images })`。

## 6. 引导、遥测、文档

- 一次性 tip `card-images`：web 上打开一张未归档、还没有图片的卡片时显示 “Cards can hold images: paste or drop them into the description in Edit task. Agents see them as part of the description.”（看板 tip 是横幅，不能放进表单里；优先级在 `first-artifact` 之后、`connectors` 之前）。导览最后一页 More features 加一行；README 功能列表加一行。
- 遥测：不加 heartbeat 字段（不是核心动作）。
- 上传在卡片保存之后逐张进行（每张用上一张返回的 revision）；某张失败时其余照传，失败原因用 toast 显示，卡片已保存。New task 先上传再启动首个 session，使其上下文列出图片。
- 所有新文案进全部 catalog。

## 7. 不做（v1）

- 手机添加图片（等 SDK，§1.2）。
- 图片嵌入描述文字中间、图片标注、裁剪、压缩原图。
- follow-up 或复制卡片时继承图片。
- 把卡片图片转存为产物，或从 session 对话收集图片。

## 8. 验收

- 单元：`card-images.add/remove/read` 的类型、大小、张数、归档拒绝、revision 冲突；看板写失败时文件被删除；启动清理只删未引用文件；删卡与移除项目把图片移到 `removed/`；`read` 只读登记的 id；native chip 投影不带 `images`；`sessionContext` 与 `get_task` 带绝对路径。
- 客户端：手机不渲染 Add images；缩略图只在侧栏可见时请求；onboarding tip 规则测试（`client/onboarding-logic.test.ts`）。
- `npm run typecheck`、`npm test`；安装并 reload；在 Tinylink 上新建自己的测试卡：web 粘贴/拖放/选择文件添加、删除、大图；手机（`adb` 或 AndroMeld）看缩略图与大图、确认无添加入口；Claude 与 Codex session 各一次确认能按路径读到图片。结束后删除测试卡。证据存 `docs/verification/card-images/`。
