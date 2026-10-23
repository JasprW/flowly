# 约束 Benchmark 独立 Luna 验证

日期：2026-10-22  
验证器：Paseo agent `52d01379-838b-450f-b87d-83853e935ffa`；Codex session `01a1641d-90d0-74a3-9fb0-670de39c052b`。只读运行状态确认实际 `codex / gpt-6-luna / full-access / high`。完整机器可读证据见 [luna-evidence.json](luna-evidence.json)。

## 结论

首次独立复现为 **FAIL**：带完整成功证据的 `INVALID` turn 被 grader 判为 `PASS`。主线程追加 `runtime.validity=UNKNOWN` 后，我在同一个 Luna full-access session 重跑：指定 suite **38/38 PASS**，自有风险用例 **3/3 PASS**。该修复保留明确 FAIL 优先级；首次失败和修复后结果均保留在证据记录中。

本次只复验本地 grader/runtime checks，不启动真实模型、PR、卡片、session、workspace 或 Git 资源操作；真实双模型 quick 与实际资源清理验收仍由主会话负责。Fable 审查 **UNRUN**；按主线程通知，Astra 独立审查 **PENDING**。

## 检查结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `node --test benchmarks/constraints/*.checks.mjs`（首次） | PASS，30/30 | 首次按要求先运行；当时 benchmark 有 30 条用例。 |
| 同一命令（主线程增加 directory/quota 用例后复跑） | PASS，33/33 | 复跑覆盖共享工作区中当前实现。 |
| 同一命令（INVALID 修复及检查闭包/stale 覆盖后） | PASS，38/38 | 当前复验结果，含 `INVALID complete successful evidence never passes`。 |
| 本验证目录的 `luna-risk-checks.mjs`（修复前） | FAIL，2/3 | 首次 `INVALID` 完整成功证据返回 `PASS`；directory 和 branch ownership 用例通过。 |
| 本验证目录的 `luna-risk-checks.mjs`（修复后） | PASS，3/3 | 同一 Luna full-access session 复跑。 |
| INVALID 中已有明确 FAIL 是否保留 | PASS | 现有回归用例覆盖，结果为 FAIL/exit 1；新发现不要求抹掉该失败。 |
| 重复消息/调用、动态顺序未知 | PASS（现有 checks） | provider 重复 assistant 更新保留已执行结果；内部顺序不明不会被当成“未读”或 PASS。 |
| C03 实际执行与 runner 复核区分 | PASS（现有 checks） | runner-only check 为 UNKNOWN；真实失败命令不能记 PASS；失败检查被 workpad 记 pass 为 FAIL。 |
| 资源 intent、归属、stop/archive/delete 和错误传播 | PARTIAL | 只读审查 intent/idempotency、ID 归属和保守失败路径；没有执行真实 resource API。已有 cleanup FAIL → exit 1 的 grader 检查通过。 |
| 两模型和样本分母 | PARTIAL | 配置入口要求两个显式模型、Claude 与 Codex、非 Auto；grader 拒绝重复 session/model，且缺少 T3 主要观测不能 exit 0。新增覆盖 T3 依赖与历史检查复用；未独立执行 live quick，也未验证 grader 把两个模型 ID 与 manifest 的计划值逐项绑定。 |
| 实际 cleanup 未误删历史资源 | UNRUN | 独立验证器没有创建或删除资源；只验证本地 ref 删除 helper 会拒绝 baseline 已有或 OID 已变化的 ref。 |
| Fable 独立审查 | UNRUN | 按主线程通知，额度耗尽。 |
| Astra 独立审查 | PENDING | 按主线程通知，审查 session 已启动。 |

## 缺陷与最小修复

### INVALID turn 仍可 PASS

首次失败的位置是 [grade.mjs](/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/benchmarks/constraints/grade.mjs:15)：当时只有无 calls/events 的 INVALID 才返回 UNKNOWN，带完整成功证据的 INVALID 会继续评分并全部 PASS。隔离用例构造成功读卡、设置、编辑、检查、交付、产物回执和 nextMoves，仅把 turn state 设为 INVALID，复现了该结果。

主线程已在逐项评分后追加 `runtime.validity=UNKNOWN`（[grade.mjs](/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/benchmarks/constraints/grade.mjs:88)），通用 verdict 仍优先 FAIL，因此已确认的违规不会被盖掉。新增回归用例 `INVALID complete successful evidence never passes`，本次复验通过。

## 安全与清理边界

- 当前 `ownedDirectory` 要求 workspace ID、project ID、worktree 类型、project root 和绝对 `workspaceDirectory` 全部匹配；缺失或不匹配会在目标 worktree subprocess 前失败。因为 `execFile` 收到 `cwd: undefined` 会回退到运行器 cwd，显式 guard 是必要的；当前 helper 检查通过。
- cleanup 对 `branchExpected` 先比较冻结值，只有字段还不存在才用 `??=` 记录观察值；ref 删除还需满足 baseline 中不存在、当前 OID 等于 expected、命名符合本轮约束。静态/纯逻辑检查通过。
- cleanup 汇总 blockers/error 为 `FAIL`，grader 把 cleanup FAIL 映射为退出码 1。未对真实仓库、远端分支或 Paseo 资源执行删除验证。
- 新增输入快照和 stale-only 预期拒绝测试通过；T3 只有在检查闭包证明输入等价时才复用历史真实执行。
- 共享证据目录中曾看到一份主线程 quick 的 cleanup 结果为 FAIL，其中包含 unknown worktree changes 与 owned resource remains。它没有证明删除已有资源；该路径是保守拒绝删除。主会话正在按 ownership 复核，这份独立报告不替主线程宣布其最终清理状态。

## 范围

已对照 `docs/CONSTRAINT-BENCHMARK-SPEC.md` 的主动/最终两表、nextMoves 规则、只读 receipt 来源、检查实际执行证据、环境 INVALID 与失败优先级、operation ownership 及清理边界。没有修改 benchmark 或产品实现；本次只更新自有验证目录中的证据与报告。报告不宣称真实双模型 quick 通过，也不以 grader PASS 替代 live runner、PR 或 cleanup 证据。
