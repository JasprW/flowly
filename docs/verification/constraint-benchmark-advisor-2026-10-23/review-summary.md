# 整体方案评审与主会话复核

用户指定 Fable Advisor；实际 `claude-fable-5-1`、创建时 `bypassPermissions`，会话 `87a4305a-07ba-4050-87cc-9e41355472c0`。首轮结论：**修改后实施**。完整意见保存在 [原始审查](fable-review-original.md)，对应 [冻结整体稿](overall-proposal.md)；没有把审查结论记成 benchmark PASS。

## 采纳与收敛

| 意见 | 主会话复核与处理 |
| --- | --- |
| final chat reply 扩大到所有回合，会阻断 A1r 恢复，并让 question/blocked 双重收尾 | 采纳。只约束工作回合；纯对话/暂停不新增交付；question/blocked 不再补 result，仍保留其现有 nextMoves 义务。 |
| any check 过宽 | 采纳。收窄到任务验证，包括 workpad/用户要求的检查；普通定位读取不要求 Test。任务验证执行前 Test 的现行要求不变。 |
| before editing files 可覆盖 docs-only 实现 | 部分采纳。按工作目的分：研究/规划/写规格仍是 Design，文档类实现为 Development；不因文件扩展名把 Design 写报告强制切 Development。 |
| 有新文件、报告或 PR 就用 in_review | 不直接采纳该充分条件。新产物可能只是阶段贡献；仍按整卡整体交付/用户要求的 handoff 与 partial/result 区分，避免扩大规则。 |
| GPT T2 的 Test 是继承自 T1，并未主动切换 | 采纳，原 facts 该回合无 status_changed，T1 以 Test 结束。以后 T1 修好后 T2 会从 In review 自动回到 Development，需要自己切 Test；不能拿旧 T2 PASS 证明主动阶段管理。 |
| Sonnet T1 也存在阶段失效线索，不能把 Sonnet 描述成仅 T2 出错 | 采纳。T1 保存状态事件只有 todo→in_review，且交付带真实文件 output；结合同路径要求本地文件先存在，支持文件产生时尚未进 Development 的推断。旧 grader 的 UNKNOWN 仍原样保留。 |
| Sonnet T2 “零读卡” | 收窄为“未观测到成功读卡”；opaque Bash 不支持绝对未读结论。零成功业务写/收尾由完整回执/事件证据确认。文字修正的实际效果未知，不能连“降低风险”也写成已验证结论。 |
| 未来重跑前记 reload | 采纳为送达证据的一部分。reload 日志不等于确定的 loadedImplementationHash；拿不到加载身份仍保留 unknown，不做受控因果对比。 |

## 整体方案修订增量（仍未实施）

[整体稿](overall-proposal.md) 的三层结构、现有原子 outputs/先拒后确认/提醒、主动与最终两表、事实前置条件、保守证据与清理全部保留。只拟替换共享清单第 2、5 项；其他四项不变，六项以换行连接共 **1583 字符**。

第 2 项：

> Use design for research, planning and specs. For implementation (including docs-only changes), set development and define workpad acceptance/checks before editing. Before executing task verification (including workpad or user-requested checks), ensure test. Ordinary inspection does not require test. Keep the stage current.

第 5 项：

> Before ending a work turn (including the card's research work, task checks and commit/merge follow-ups), update workpad, then obtain a successful receipt: flowly_update_status(in_review) for the card's overall delivery or the user's requested handoff, even if uncommitted; flowly_report_progress(kind=result) for partial work or verification-only follow-ups. A new artifact alone does not mean the whole card is complete. Include outputs and nextMoves; [] when none. Pure conversation or a pause needs no delivery. After a question or blocked report, do not add a result; keep their existing nextMoves rules. Follow explicit stop/wait instructions.

纯验证用 result 可以停留在 Test；这不是系统要自动恢复 In review 的场景。问答/暂停与实际工作区分，不改 A1/A1r。用户明确 stop/wait 的指令优先，不能为满足收尾而继续未经授权的动作。

## 后续范围

本轮只做整体设计/评审。不改产品/工具规则、grader 或旧成绩，不跑 B01/fixture，不加 hooks，不提交/推送、不安装/reload。Fable 的本次 advisor 会话属于用户明确授权的评审，不属于新 benchmark 样本。

若后续授权实施，先同步 TURN-CHECKLIST-SPEC，再改共享数组并生成 skill，跑必要的离线规则/单源检查。被测模型行为测试需另行授权。Claude opaque Bash 的安全采证属于另一个可单独版本化的测量问题，不夹在文字修正中；不能靠扩大 shell 猜测把 UNKNOWN 变 PASS。

同一 Fable advisor 限定复核结论为 **无阻塞，可实施**，见 [最终复核](fable-final-review.md)。按其非阻塞建议恢复“工作回合结束前取得成功回执”的明确义务，并将 research 收窄为 the card's research work；没有增加每回合恰好一次回执的计数限制。最终两项仅作为本目录的实施候选，尚未改写规范/共享数组/生成 skill。
