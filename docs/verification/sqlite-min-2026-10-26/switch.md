# 维护者本机切换到 SQLite（2026-10-26）

实现者（Opus 会话 d141d642）在 PR #64 合并后执行，用户已同意。提交 `7f82d0b`。

## 步骤
1. 共享工作树同步：PR 改动的文件中，别人没改过的直接取新版本，别人改过的只打 PR 的补丁；`PROGRESS.md`、`SPEC-OUTLINE.md`、`shared/rpc.ts` 手工合并。`git reset origin/main`（mixed），不动别人的改动。被取代的旧 R1 条目和两份旧文档先存进本地分支 `archive/sqlite-r1-v1`，再从工作树移除。
2. reload 前在共享工作树检查：`npm run typecheck` 退出码 0；`npx vitest run server/sqlite-store.test.ts server/sqlite-parity.test.ts server/sqlite-crash.test.ts server/store.test.ts shared/i18n.test.ts` 94 通过 / 1 跳过。
3. `paseo plugin reload flowly`。

## 结果
- 日志：`Flowly storage: moved the board to SQLite in 365 ms (107 cards, 4552 events).`
- 数据目录：`board.json` 变成退休标记；`flowly.sqlite` 7.1 MB；快照 `migrations/20261026-052958/`（board.json 与 .bak）；`backups/flowly-20261026-052958.sqlite`；文件权限都是 0600。
- 核对：快照 sha256 与 manifest 一致；迁移时的备份库与快照中的原 board.json 逐字段比较，12 个顶层字段（revision 8031 和全部集合）全部相同；备份库和实时库 `quick_check` 都是 ok。
- 读写：通过 Flowly CLI 读出卡片，并写入一条进度。这条进度成为数据库里最新的事件行。
- 界面（`ui/storage-ui.mjs`，使用 shot-lib）：
  - 桌面 1700×1000 页面无报错；显示 SQLite、数据目录、库大小、迁移时间、一份带文件名的备份和导出入口；点开 Restore… 后确认文字带文件名，随后按 Cancel 退出，没有执行恢复。
  - 紧凑布局 1000×900（可用宽度 680）只截到一部分：设置弹窗在整个窗口里居中，左侧落在 shot-lib 必须裁掉的 320px 侧栏区域里。可见部分没有溢出，确认文字和按钮完整。
- 未运行：手机（原生）界面；Helper 运行时内的强杀；Windows/Linux 实机（Linux 只跑过 CI 的 Node 22/24 测试）。
