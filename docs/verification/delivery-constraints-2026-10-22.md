# 流程约束建议 2：实现与验证（2026-10-22）

接续会话 `69bb87f5-b0e5-4e90-a4cc-e208ea7d7f19`。实施会话 `036d5d2b-d2b0-4b54-9ef7-d80c04a0896f`。

输入：原会话最后一条用户指令、[既有调查报告](flow-constraints-audit-2026-10-22.md)建议 2，以及本卡原有 workpad。先写完整 [spec](../DELIVERY-CONSTRAINTS-SPEC.md)，再实现。

## 实现与边界

- In review / result 的 `outputs` 与产物、事件、nextMoves、回执原子提交。`[]` 明确本次无产物；省略则成功后提醒。保留用户条目、目标去重和目录边界。
- `receipt.artifactIds` 持久化。精确重放不重新要求文件存在、不重新读取外部元数据；换参数仍拒绝。
- 交付有未完成项或缺失设置时，首次预带 `acknowledgeOpen=true` 也拒绝；同 session、同 card/project/workpad/HEAD 的后续确认才可放行。15 分钟过期、服务重载和新回合都重新拒绝。新回合由 hook 清空记录，避免使用每卡截断事件推断状态。
- MCP schema/描述、CLI `--outputs` / `--no-outputs`、两份 skill 同步。新逻辑面向所有 provider，不依赖项目 AGENTS.md。
- 第一轮真实验证发现：Flowly 的 GitHub connection 不能读取新建私有仓库，合法 PR URL 也因此被拒绝。已修复为：connector 抛 ExternalError 时，显式合法 http(s) output 保存为普通 URL，并通过 notice 说明未核实外部状态/内容；不修改凭据，不猜状态，裸 key 和程序错误仍拒绝。

## 本地检查

运行时 `HEAD=05de1691ff16`，`dirty=true`。共享工作区含其他会话的改动；本轮产品代码尚未提交或推送。具体提交归属见 [ownership.md](delivery-constraints-2026-10-22/ownership.md)。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 聚焦业务与 MCP/CLI | PASS，3 files / 59 tests | [focused.txt](delivery-constraints-2026-10-22/focused.txt) |
| `npm run typecheck` | PASS | [typecheck.txt](delivery-constraints-2026-10-22/typecheck.txt) |
| `npm test` | PASS，109 files / 932 tests | [tests.txt](delivery-constraints-2026-10-22/tests.txt) |
| 插件 reload | PASS，显式 local endpoint；运行状态不作为行为验收 | `paseo --host 127.0.0.1:6767 plugin reload flowly` |
| 独立 Luna 审查 | PASS | [luna-review.md](delivery-constraints-2026-10-22/luna-review.md) |

首次类型检查失败原因也保留在结论中：`docs/verification/artemis-2026-10-22/runtime/` 的第三方 Angular 源码被原来的全局 TS glob 纳入检查；本轮代码另有一个数组类型错误。修正本轮类型，并把整个验证资料目录从产品 TS/Vitest 发现范围排除，未删除第三方资料。第一次更新既有断言前的聚焦测试有 9 项失败（新增提醒与错误文案导致），更新预期后通过；新增回归覆盖原子回滚、容量、角色保护、重放、元数据失败和门槛失效。

Luna 审查会话 `c06c0037-1486-4597-ae67-75c2c1490255`，`codex/gpt-6-luna`、创建时 `full-access`、medium。只读实现、运行聚焦检查、写审查报告，没有实现文件所有权。它指出的 PROGRESS 缺项已补齐；新增 URL fallback 也经其增量审查。

## 真实模型场景

使用永久 Tinylink 项目中本轮创建的独立 worktree 卡片。发现无 launch profiles；实际发现 Sonnet 5.5 / GPT-6-Luna 可用，分别创建为 `bypassPermissions` / `full-access`（均 medium）。首次普通文档任务只要求创建非空文件、交付、保留未提交；待 session idle 后，第二条消息严格为 **“创建 PR 并合入”**，没有额外提醒 outputs 或 workpad。

私有 GitHub 仓库：[JasprW/flowly-delivery-fixture-20261022-036d](https://github.com/JasprW/flowly-delivery-fixture-20261022-036d)。用户明确要求保留供以后测试；没有给永久 Tinylink 添加 remote。源 checkout 的 `main` 作为测试仓库基线，后续通过专用分支与 PR 合入测试文件。

| 轮次 / 模型 | Session | PR | 结论 |
| --- | --- | --- | --- |
| 首轮 Sonnet | `77ce54fc-6bcb-4ee7-9c7a-cc6b7373140e` | #1，已合入 | 主动用 outputs 登记 PR，但产品因私有元数据不可见拒绝；保留为 pre-fix FAIL |
| 首轮 GPT | `34b72383-58a6-454b-b22e-e768a27be6ac` | #2，已合入 | 遇到同一登记失败；没有把 GitHub 合并成功当作产物登记成功 |
| 修复后新 Sonnet | `7d43e887-4108-4e7f-ae9e-14c418c48a83` | #3，已合入 | PASS：本回合 outputs 登记 PR，产物保存成功，再次交付 |
| 修复后新 GPT | `6a79016f-dca4-40eb-9af1-3498e1624be2` | #4，已合入 | PASS：本回合 outputs 登记 PR，产物保存成功，再次交付 |

Sonnet 首轮及修复后均自然触发 `WORKPAD_OPEN`：提交改变 HEAD 后，原检查成为 stale；它收到拒绝后重新运行检查、更新 workpad 才交付。预带 acknowledgeOpen 的首次拒绝、同状态确认、跨 session/turn/revision/HEAD/过期/重载的隔离另有业务测试覆盖。

首轮原始失败的经过已过滤敏感字段后保存：[initial-complete.json](delivery-constraints-2026-10-22/initial-complete.json)（含实际 outputs 输入、`ARTIFACT_INVALID`、`WORKPAD_OPEN` 和公开回执字段）。捕获脚本读取完整 `flow/<projectId>.jsonl`，不使用 board 的截断事件统计；回执和产物按实体读取。没有保存凭据或签名 request。

修复后的结果由 [verify.py](delivery-constraints-2026-10-22/verify.py) 对照独立抓取的 GitHub 状态、产物实体和交付回执验证：[results.json](delivery-constraints-2026-10-22/results.json)。两次交付的 `receipt.artifactIds` 都包含相应 PR 产物 ID；notice 明确没有核实外部状态。完整过滤证据：[final-capture.json](delivery-constraints-2026-10-22/final-capture.json)，GitHub 状态：[github-prs.json](delivery-constraints-2026-10-22/github-prs.json)。

最后同步 skill 的 Artifacts 关闭说明：不要重试登记产物，但可带 `outputs=[]` 重提原先被拒绝的交付；随后单独运行 `server/tool-server.test.ts`，8 tests PASS（[skill-sync.txt](delivery-constraints-2026-10-22/skill-sync.txt)）。未为这次文字同步重复全量套件。

这些样本验证具体场景，不代表全模型的长期遵守率。完全不调用 Flowly 的回合仍不受服务端约束；本次只实施建议 2，其余原有 ideas 没有扩展实现。

## 清理与留存

已删除本轮 4 张卡，归档 4 个场景 session、1 个独立审查 session，并移除 4 个 worktree。看板与 native registry 中均无这些 fixture 资源；原 6 卡的 status/revision 不变，原 5 个可用 workspace 和 3 个 Haiku session 仍存在。Tinylink 原 checkout 仍为 `47899f7286df`、干净、无 remote。产品自动生成的 removed/ 安全备份保留，不手工改数据文件。

Codex 重测用临时 Git 数据库构造了已合入 PR，原 worktree 仅剩本轮自己创建的未跟踪测试文件。清理首次安全停住；确认 `git status --porcelain --untracked-files=all` 只有已记录的目标文件后，才确认该 warning 并归档自己的 worktree，未丢弃其他文件。

清理状态：[cleanup.json](delivery-constraints-2026-10-22/cleanup.json)、[permanent-resources.json](delivery-constraints-2026-10-22/permanent-resources.json)、[branch-cleanup.json](delivery-constraints-2026-10-22/branch-cleanup.json)。所有本轮远端测试分支已删除，GitHub 仓库的 main、4 个已合入 PR 及历史按用户指示保留。**UNRUN：4 个本地测试分支仍留在 Tinylink `.git` 中**；普通沙箱拒绝创建 refs lock，已提交的升级权限请求未完成。未通过别的工具绕过这项权限。

遗留资源核对：原 Done 示例卡引用的 `wks_a4e7f5a7a51ef2fc` 当前不可读取，因而“原 6 个 workspace 全部在列表”的粗检查为 false。本轮归档的只有 live-state 中记录的 4 个新 ID；2026-10-20 的 delivery-reminders 验证已记录永久项目仅有 5 个可用 workspace。本轮保留这个历史不一致，没有恢复/重建任何旧资源。

实际资源 ID 与执行入口：[live-state.json](delivery-constraints-2026-10-22/live-state.json)、[live.mjs](delivery-constraints-2026-10-22/live.mjs)。

没有新 UI、设置或入口，现有 Inputs and outputs / Workpad 引导已覆盖用途，因此无需新增 tour、tip 或 What's new。桌面/紧凑视觉检查本轮未运行（无界面改动）；没有把插件 `running` 当作模型行为证据。
