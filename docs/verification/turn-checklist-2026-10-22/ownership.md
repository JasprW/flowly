# 本轮增量归属

会话 `036d5d2b-d2b0-4b54-9ef7-d80c04a0896f`，卡片 `08a37039`，基线 `05de1691ff16`。工作区包含其他会话的未提交修改，本轮未提交、推送或改动分支。

本轮新增：

- `docs/TURN-CHECKLIST-SPEC.md`
- `docs/verification/turn-checklist-2026-10-22/`（Luna 独立拥有 `luna-review.md`，其余为主会话证据）
- `shared/turn-checklist.ts`
- `server/skill-source.test.ts`
- `docs/verification/flow-constraints-audit-2026-10-22/audit-core.mjs`、`audit.test.mjs`、`README.md`

本轮修改：

- 两份 `audit*.mjs` 原入口改为共用 v2 core；原调查报告与旧输出 txt 不变。
- `server/skill-source.ts`、`skills/flowly/SKILL.md`：开头渲染共享清单、精简小卡说明、去掉 work phase 例外措辞；前轮 outputs/闸门细节保留。
- `server/agent-service.ts`：仅新增清单 import 和 get 返回数组副本；前轮交付实现属于同卡上一轮。
- `shared/tools.ts`：仅新增兼容可选的 `turnChecklist` 输出字段；前轮 outputs 契约保留。
- `server/tool-server.ts`：只改 get_task 描述，前轮交付描述保留。
- `server/agent-service.test.ts`、`server/tool-server.test.ts`：新增清单/兼容/只读断言及调整开头文案断言，保留前轮测试。
- `docs/SPEC-OUTLINE.md`、`docs/PHASE-02-SPEC.md`、`docs/CARD-SETUP-SPEC.md`：顶部增量说明。
- `docs/PROGRESS.md`：本轮独立条目。

资源：新建 Luna 测试子会话 `6698b422-7a2f-4b1e-b58e-5739bf2a485d`（已归档），以及用户指定 Fable 审查子会话 `058cab0b-0961-4b40-962c-258555c435f9`；后者独立拥有 `fable-review.md`。二者复用当前卡片 workspace `wks_e56a74f6e1bc6cd6`，不新建/删除 workspace、项目或卡片。结束需归档并核对。Node 测试自己的 temp home 在 finally 删除。前轮遗留四个 Tinylink 本地 refs 不属于本轮新资源，本轮不重试清理；保留的私有 GitHub 仓库不动。
