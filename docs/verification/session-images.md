# 首消息图片验收报告

- 日期：2026-10-21（Asia/Singapore）
- 测试执行 session：`ab7e0df7-d4f2-4bbd-9266-9bd4f801b689`，Codex / `gpt-6-luna` / medium / full-access。
- 目标 checkout：`/Users/bofan.wang/Developer/personal/paseo-utlra-kanban`。
- Commit：开始时 `398ba2c204a4d176e64b80612119da1b87f3de02`，结束时 `7d305407a235c4015170571860de3c59c6007cd3`。checkout 前后均 dirty；测试没有编辑 `client/`、`server/`、`shared/` 或既有文档，只新增本报告和本目录截图。测试期间 HEAD 前进到包含 native session pane 变更的 commit，Flowly 日志显示 `00:29 UTC` 有一次 stop/start（本测试没有触发重载）；image attachment 相关路径不在该提交的文件列表中，但测试不是单一 commit 的干净 checkout 验收。

## 方法与基线

使用 Playwright Core 1.63.0 和 headless Chromium 1243 访问 `https://app.paseo.sh`，独立 context 并授予 `local-network-access` 连接本地 daemon。桌面视口 1700×1000；紧凑视口 430×900，设置 `isMobile`、`hasTouch`。测试过程没有操作用户的 Paseo 窗口。生成红、蓝 64×64 PNG、5,401,678 字节的 PNG 和一个 `.txt` 非图片文件；所有临时图像已删除。

基线为 Tinylink 项目 `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663`：原有 6 张卡与 3 条长期 session。测试使用 Codex / GPT-6-Luna / low / full-access。Flowly 当时为 enabled、running。已有验证目录中的 `docs/verification/session-images.png` 未被覆盖。

## 验收结果

| # | 结果 | 证据 |
|---|---|---|
| 1. New task 图片输入、移除与拒绝 | **PASS** | Instruction 下有 **Add images**。通过文件选择器附加红图，再用真实剪贴板写入蓝图并 `Meta+V`，出现 2 个缩略图；点击红图的 × 后只剩蓝图，再补回红图用于创建。5.4 MB PNG 被拒绝，缩略图数不变，toast 显示 `oversize.png is larger than 5 MB.`。`.txt` 也未附加；拒绝 toast 以大图截图为验收证据。见[双图](session-images/04-desktop-new-task-two-images.png)、[移除一张](session-images/05-desktop-new-task-remove.png)、[大小拒绝 toast](session-images/03-desktop-new-task-rejection.png)。 |
| 2. New task 首 session 收图、模型回复与 transcript 缩略图 | **PARTIAL** | 卡片与首 session 成功创建，agent 收到两张图并回复 `Two solid-color squares: the first is blue, and the second is red.`，与蓝、红图片顺序相符。未能在**同一创建 context** 中打开该 session 核对首条 You 消息缩略图：创建后的测试脚本先遇到重复标题 locator 错误并退出；随后打开的是新 context，截图只有文本。该客户端缓存图片的实现注明 reload 后只保留文本，因此此截图不作为同 context UI 失败证据，也不把缩略图项记为 PASS。见[卡片详情](session-images/08-desktop-task-details.png)、[重载后的 transcript（文本）](session-images/09-desktop-first-session-transcript.png)。 |
| 3. New session 首消息图与模型回复 | **PASS** | 紧凑视口 New session 附加蓝图后，缩略图可见；同 context 打开最新 session，首条 You 消息旁出现 64×64 图片，GPT-6-Luna 回复 `A solid blue square.`。此前一个红图 session 也回复 `A solid red rectangle fills the image.`。完整 transcript 证据见[图片与首消息](session-images/20-compact-third-session-transcript.png)及[模型回复](session-images/21-compact-third-session-reply.png)。 |
| 4. 430×900 紧凑 web 两个对话框 | **PASS** | New task 与 New session 的 **Add images** 均通过文件选择器附图。内容较长时需在对话框内滚到按钮区域；滚动后按钮和缩略图均可见、可用。见[New task](session-images/24-compact-new-task-thumbnail.png)、[New session](session-images/19-compact-new-session-create-ready.png)。 |
| 5. 正常 session composer、console 与 plugin logs | **PASS** | 普通 session composer 的 **Attach images** 成功附加红图，再点击 × 移除；没有发送消息。覆盖的浏览器 context 中 console error 与 page error 均为 0。测试后 `paseo plugin logs flowly` 没有新增 Flowly error、exception 或 failed 项；日志保留了 Paseo 启动时已有的 `crypto.fips` deprecation 与 `responseMode: 'json'` 通知提示。见[composer 附图](session-images/22-compact-composer-attachment.png)、[移除](session-images/23-compact-composer-remove.png)。 |
| 6. 清理 | **PASS** | 临时卡已通过 **Delete permanently → Archive and delete** 移除；确认框显示将归档其 worktree 和 3 条 session。卡片 ID 不在 board，活跃 workspace 列表不再有测试 workspace，worktree 目录已移除。3 条 session 在 Paseo 显示 `Archived: true`。见[归档确认](session-images/26-desktop-delete-confirmation.png)、[删除后 board](session-images/27-desktop-card-cleaned.png)。 |

## 测试资源与清理核对

- 临时 Flowly 卡：`22ca8596-25e4-441b-bdca-6748184311a7`，已删除；workspace：`wks_f06458c4aada8e31`（worktree `/Users/bofan.wang/.paseo/worktrees/246o38bv/kanban-test-first-message-images-2026-10-21-4b8a05`），已归档，目录不存在。
- 本次 3 条主要 agent session：`1c1b7ef2-a9a2-4b74-bc90-07472bb38193`（New task 双图）、`09ed0e34-6a61-4e03-99b0-9abde3fd488f`（New session 红图）、`079c4a6e-90c2-41ef-b650-1a5d5bfe3dcb`（New session 蓝图）；全部 closed 且 `Archived: true`。
- Flowly 为这些测试卡生成的 3 个摘要 agent：`c299893a-646d-402d-aafd-83e10f937c70`、`6fbda49e-7627-4ca4-b602-f9c3cda7c286`、`be05ec18-c8d6-4ace-a769-d2002f3029dc`；均已归档。
- 删除后 board 中 Tinylink 原有 6 张卡仍在。另有卡片 `[test] outside native session r4 card-folder 1333355d`（`29534112-2e5a-4ab4-8593-959e08e19850`）于 `00:41:19 UTC` 出现，晚于本次卡片删除时间 `00:40:57 UTC`；它不属于本次测试，未触碰。
- Playwright contexts 已关闭；未启动子 agent。临时图像目录 `/tmp/flowly-session-images-ab7e0df7` 已清理。测试没有删除 Tinylink 项目目录、原有卡片或原有 session。
