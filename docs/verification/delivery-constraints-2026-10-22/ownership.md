# 本卡改动归属

基线：`05de1691ff16`，共享 `main`，开始时已有大量其他会话未提交修改。未提交、未推送 Flowly 产品代码。

本卡完整负责：

- `docs/DELIVERY-CONSTRAINTS-SPEC.md`
- `docs/verification/delivery-constraints-2026-10-22.md`
- `docs/verification/delivery-constraints-2026-10-22/`
- `server/delivery-gate.ts`
- `server/agent-service.ts` / `server/agent-service.test.ts`
- `server/cli-source.ts`
- `server/reminders.ts`
- `server/tool-server.ts` / `server/tool-server.test.ts`
- `server/skill-source.ts` / `skills/flowly/SKILL.md`
- `shared/tools.ts` / `shared/card-setup.ts`
- `tsconfig.json`（只排除 docs/verification）

混合文件中本卡仅负责下列部分；后续提交必须按 hunk 提取，不得整文件纳入：

- `index.server.ts`：`agent.turn_started` 中新增 `tools.agents.turnStarted(identity)` 一行。
- `shared/model.ts`：`receiptSchema.artifactIds` 可选字段及注释。
- `package.json`：test/dev scripts 排除 `docs/verification/**`；版本号变化属于其他会话。
- `docs/SPEC-OUTLINE.md`：顶部交付约束条目。
- `docs/PROGRESS.md`：Delivery constraints 条目。
- `docs/PHASE-02-SPEC.md`：顶部交付约束增量链接。
- `docs/WORKPAD-SPEC.md` / `docs/CARD-SETUP-SPEC.md`：首次拒绝后确认的修订。
- `docs/CARD-ARTIFACTS-SPEC.md`：末尾交付 outputs 增量。

先前会话的调查报告 `docs/verification/flow-constraints-audit-2026-10-22.md` 及同名目录仍留在原处，本轮未修改。

测试资源及归属在 `live-state.json`；用户要求保留私有测试仓库 `JasprW/flowly-delivery-fixture-20261022-036d`（含已合入测试 PR 的历史），其余本轮 native fixture 资源需清理。永久 Tinylink 项目、原 6 卡、3 个既有 Haiku 会话与原始 checkout 不属于本轮，必须保留。
