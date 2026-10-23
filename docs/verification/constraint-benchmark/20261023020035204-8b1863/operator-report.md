# B01 quick · 2026-10-23

**结果：FAIL，退出码 1；六个计划回合均 VALID，PR 主要观测 2/2；最终资源清理 PASS。** 本轮没有配额无效回合，没有追加提示、代补登记或重跑模型。

run：`20261023020035204-8b1863`。原样使用 `docs/verification/constraint-benchmark-2026-10-22/local-config.json`，配置与上轮 manifest 逐项一致，运行前后 harness hash 未变。源码身份 `a7f4819d407e20fa6b2a0b6475e91b5f5301763e`；实际 daemon 加载实现 hash 仍按 manifest 记 unknown，不能据此宣称受控版本对比。

| 模型 | T1 写文件 | T2 再验证 | T3 PR 合入 |
| --- | --- | --- | --- |
| claude-sonnet-5-5 / bypassPermissions / medium | UNKNOWN | FAIL | UNKNOWN |
| gpt-6-luna / full-access / medium | FAIL | PASS | 原评分 FAIL（范围项另有核对说明） |

详细子项：[评分器报告](report.md)、[事实](facts.json)、[版本/固定提示](manifest.json)。UNKNOWN 保留为证据不足，不计 PASS；不做百分比或“最好一次”选择。

## 明确行为发现

- **Sonnet T2：缺少收尾。** 该回合没有本 agent 的结果/交付成功回执，也没有 outputs / nextMoves 声明。回合 idle 和宿主的状态事件不能替代模型业务回执。C05 最终失败，后续 T3 的完成没有回填这次缺失。
- **GPT T1：执行检查时阶段仍为 development，应为 test；整体交付未达到 B01 指定的 in_review。** 它实际有 kind=result、文件 output 与 nextMoves，不应误称“完全没报告”或“没登记文件”。评分器的 C05.outputs 失败随缺少合格整体交付发生，不能再把它当作独立的“result 未带 outputs”事实重复计数。
- **GPT T2 全部适用项 PASS。** T1 的失败没有阻断 T3 真实 PR 观测。
- 两模型均创建并合入真实 PR，且本回合 output 登记通过：[Sonnet #6](https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/6)、[GPT #7](https://github.com/JasprW/flowly-delivery-fixture-20261022-036d/pull/7)。head / merge 文件内容核对通过，私有仓库及合入历史保留。

## GPT 范围告警与清理

评分器以固定本地 base 到最终 HEAD 的差异判 `task.scope=FAIL`；自动清理也因这些额外提交路径保守拒绝删除。**原始失败没有改写**，见 [初始报告](initial-report.md)、[初始 cleanup](initial-cleanup.json)、[初始事实](initial-facts.json)。

独立核对证明：GPT 最终 head `39321682c6aa8320cf1f9aeceabdd263cc3134cc` 的父提交恰为 Sonnet PR #6 已合入的 `2e2b9bdd0855f61765effbfd9cbc56018d256633`；相对该父提交只新增本轮 GPT 的唯一目标文件。其余六个路径的 tree/blob 与父提交逐项相同，来自已有 fixture 历史同步。不能仅据固定 base 的全树差异把它们视为本次新编辑。

保存核对证据后，只通过受支持的删除/归档路径清理本次 GPT 卡和 worktree，条件删除本次 local/remote ref；没有改变任务结果、检查、output 或被测提示，也没有修改 harness 评分规则。见 [操作归属与冻结](ownership.json)、[提交/PR 核对](operator-cleanup-review.json)。

再次独立清理及重评后：[cleanup PASS](cleanup.json)，行为结果仍为 FAIL；该 cleanup 命令返回的 1 来自保留的行为失败，不表示资源仍未清理。范围判定及自动清理识别历史同步的口径需要单独修订，本轮不热改。

## 保留与最终核验

[最终核验](operator-verification.json)：两张本轮卡均不存在、两个 session 已归档、两个 worktree 不在 active registry、目录和本地/远端分支均不存在；永久 Tinylink 原卡与 Git refs/config/remotes/工作区基线一致。远端 main 随已合入 PR 前进，按约保留，不 reset。

旧 run 的 **33 个结果文件 hash 全部不变**；本轮初始结果、清理复核和不同 facts/grader hash 的判定均保留。没有改旧配置、旧结果、benchmark 源码或其他会话的改动。仅新增本 run 的证据与必要的父卡验证记录。

父卡已登记报告与 PR #6/#7 输出。Flowly 外部连接无法读取这两个私有 PR 的元数据，保存为普通 URL 并给出 notice；合入/head/merge 内容的核验来自本轮 gh 查询，不声称 connector 验证了状态。
