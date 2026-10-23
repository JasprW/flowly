# 约束 benchmark 实现与验证

2026-10-22；卡片 `08a37039-643c-4354-9062-0fefdf2eec21`；共享 dirty checkout，基线 `fab80456ead8`。

已实现独立 grader + B01 quick 的 run / grade / cleanup。**实现检查通过；真实双模型 benchmark 未通过验收：最终 exit 2、UNKNOWN、主要观测 1/2、cleanup PASS。** 不以单测或设计复审替代模型行为成绩。

## 实现

入口和配置见 [README](../../../benchmarks/constraints/README.md)；合约见 [spec](../../CONSTRAINT-BENCHMARK-SPEC.md)。B01 同会话三回合，T2/T3 依据文件/结束/交付事实进入，前轮评分失败不吞掉 T3。主动和最终分别评分；独立失败优先于未知，INVALID 不得最终 PASS。

回执从捕获的成功结果或 daemon `board.json` 只读白名单取得，公共 RPC 不含回执。nextMoves 携带只进主动表，最终接受同回合同 agent 的独立有效声明。真实返回码、创建时脚本 hash、检查输入闭包、文件/PR head 与 merge 内容分别核对。动态顺序和说明充分性不能证明时保留 UNKNOWN。

资源先登记创建意图/ID。共享 Git 用条件删除，保留原 refs/config/remotes。只关闭已冻结并再次核实身份的明确自有 PR。停止会话后先持久化最小实体/回执/文件/flow 事实，再归档/删卡/worktree；冻结失败保留资源。board checkpoint、真实 turn 边界和未带独立回执的事件共同决定 flow 完整性。

新增来源合并不擦除已知退出码/结果，矛盾显式记录。真实补采还发现 native 工具 timestamp 可能是回放更新时间；阶段判断使用 call 顺序与此前成功上下文/回执，不能拿回放时间推断执行阶段。

## 验证

| 项目 | 结果 |
| --- | --- |
| `node --test benchmarks/constraints/*.checks.mjs` | PASS，最终 54 项。 |
| 加上 `docs/verification/constraint-benchmark-2026-10-22/luna-risk-checks.mjs` | PASS，最终主线程 57/57。另一个会话合入 #36 后，在新 HEAD `2a727e8af2d4` 刷新聚焦检查仍为 57/57（[命令/版本](final-checks.json)、[原输出](final-checks.txt)）。 |
| 独立 Luna 最终验证 | PASS，彼时主套件 53 + 风险 3 = 56/56；之后仅追加“回放时间不能错置阶段”修正与一项反例，由主线程验证到 57/57。见 [报告](luna-final.md)、[版本](luna-final-evidence.json)。 |
| `npm run typecheck` | PASS，本轮早期执行；后续仅 MJS/文档变化，未重复。未重新执行全量 npm test、UI 或 reload；不改产品 API/运行时代码。 |
| GPT Astra 实现审查 | 发现并修复归属/评分/缺失证据/独立失败优先级问题；最后限定复审通过。见 [复审](astra-final-review.md)。阶段时间修正发生于该复审后，另有聚焦回归。 |
| Fable 实现审查 | UNRUN，周额度耗尽；按用户指令改用 Astra。未将未审查记通过。 |
| 真实 B01 | 已执行，结果不完整，详见下节。 |
| 原生 dirty-worktree 清理 smoke | PASS，真实创建一张卡与一个未提交的专属 worktree，无模型/PR；冻结文件/实体/flow 后删除，原生 registry、board 和 Git 基线核对通过。见 [结果](cleanup-smoke-result.json)、[归属与冻结事实](cleanup-smoke-ownership.json)。 |

Luna 初次发现 INVALID 成功事实可假 PASS，首次失败和复验保留在 [原报告](luna-verification.md)。Astra 给出的组合反例全部加入 checks，不靠修改被测提示修成绩。

## 真实运行与首次失败

1. `20261022145725522-df4cdb`：SDK 描述符字段误用（`workspaceDirectory` 与 handle 的 `directory` 不同），两卡/worktree 创建后尚未启动模型即失败。补目录 fail-closed 校验并独立清理；[初始报告](../constraint-benchmark/20261022145725522-df4cdb/initial-report.md) 保留，后续 cleanup PASS。
2. `20261022150226138-4f8bce`：Sonnet 返回 weekly quota，T1 INVALID、T2/T3 UNRUN；未替换或重试。GPT 同会话完成三回合，创建并合入 [fixture PR #5](https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/5)，T1 文件及 T3 PR 的 output 登记、交付、outputs 与最终 nextMoves 均有事实支持。

[最终逐项报告](../constraint-benchmark/20261022150226138-4f8bce/report.md)：exit 2，UNKNOWN；Sonnet 主观测未取得，GPT 主观测取得。旧 collector 未保存执行时脚本身份/完整输入快照，部分动态调用和拒绝说明不可确定；这些项不补造 PASS。daemon 实际加载实现 hash 也仍 unknown，不宣称受控版本对比。

首轮 `initial-facts.json` / `initial-report.md` 不变；只读补采从相同 owned session 原生 timeline、明确卡片的 removed 备份/完整 flow 以及 GitHub 内容恢复事实，不重发消息、不重跑模型、不补写业务数据。补采与 grader 版本各自带 hash，旧判定保留。删除卡片后的 flow 已移至 removed，不能把 live flow 不再含该卡误判为当时无事件。

## 清理及限制

本次共 5 张专属卡/worktree（首次失败 2、真实 quick 2、清理 smoke 1），均清理；6 个被测/验证/审查 session 均归档。见 [资源核对](resource-final.json)、[模型/模式/归档核对](agents-final.json)。永久 Tinylink 的 6 张原卡及原 Git 基线不变，旧 4 个测试 refs 不认领；保留私有 GitHub 仓库和合入历史。

无产品 UI/设置/入口变化，无需 onboarding tour/tip/What's new。未提交、推送或创建产品仓库 PR；保留其他会话的修改。本卡归属为 benchmarks/constraints、这些证据及 spec/outline/progress 的对应段；没有改其他产品文件。

B02–B04、compare、自动续跑、hooks 继续后置。下一次配额可用时可用 README 的同一命令启动新的 run ID；当前不为了获得全绿重跑。

共享工作区结束核对：56 个起始非目标文件 hash 保持，另 10 个产品/i18n 文件由并行工作发生变化，清单见 [shared-workspace-check.json](shared-workspace-check.json)。没有按起始快照恢复它们。结束时 HEAD 已由另一会话推进到 #36，交付只更新本工具聚焦验证，不回填历史产品检查的执行 SHA。

父卡已原子登记 PR #5 为 output；Flowly 外部连接无法读取该私有 PR 元数据，因此保存为普通 URL 并给出 notice。上述合入与内容验证来自 gh 的独立查询，不声称 Flowly connector 验证了其状态。
