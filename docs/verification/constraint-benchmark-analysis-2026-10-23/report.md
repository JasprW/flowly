# Sonnet T2 / GPT T1：残留约束失效分析与最小方案

2026-10-23。仅分析已保存证据、提出方案；**未实现、未重跑模型、未更改现行阶段要求或成绩**。

建议先只修改共享清单的第 2、5 项，再生成 skill：把“检查前切 Test”和“最终回复前取得对应交付回执”写成明确动作。GPT 的问题有具体措辞可消歧；Sonnet 的整轮零写调用只能靠提示降低发生概率，本方案不保证消除。

证据：[原始 facts](../constraint-benchmark/20261023020035204-8b1863/facts.json)、[原始成绩](../constraint-benchmark/20261023020035204-8b1863/report.md)、[独立 scope 重评](../constraint-benchmark-scope-2026-10-23/regraded-report.md)。本轮的 [两回合证据投影](evidence.json) 和 [输入哈希/归属](ownership.json) 方便复核，不替换原文件。

## 1. Sonnet T2：工作回合没有业务收尾

被测会话 `b1a26074-d489-4650-ac3f-eed756612683`；用户固定消息为“再验证一次刚才的文件。”

| UTC 时间 | 保存的事实 | 可以得出的结论 |
| --- | --- | --- |
| 02:01:35.636 | turn_started；system 将 in_review 切到 development | 是真实新回合；开工阶段是系统恢复值，仍需 agent 判断并改为当前验证阶段。 |
| 02:01:38.394 | 唯一调用 `toolu_016nrkwiryvY7rFiKiHGPwhm`，Bash，seq 353–355，completed，投影为 opaque | 有一次工具活动；命令/执行结果不能从该投影还原，不把它编成“已运行指定检查”。 |
| 02:01:41.142 | turn_ended；随后 system 将 development 恢复为 in_review | 系统状态恢复没有 agent 交付回执，不能替代 agent 当回合交付。 |
| 回合冻结 | state=VALID；四种完整性标记均 true；receipts=[]；workpad revision 2→2；无 result、agent in_review 或 next_moves 事件 | C05.delivery 明确失败；没有该回合 outputs/nextMoves 声明。原始 C01/C02/C03 的 UNKNOWN 继续保留。 |

**已证实的直接失效机制：**该回合结束前没有成功的 Flowly 写入，因此现有 `deliveryReminders` 没有返回提醒的机会。它依附 status/progress 写入，不能在一个只使用其他工具的回合中产生服务端兜底。

**合理推断：**短验证请求被当成只需工具操作和聊天回复的工作，跳过了卡片收尾。当前清单已经写了 verification follow-ups，但“Before ending a work turn”仍需要模型主动把这类短请求识别为工作回合；改成“Before your final chat reply”并点名 verification-only follow-ups，触发点更具体。

**不能据此认定：**模型一定没有读卡、没有做检查、发生了 compaction 或额度故障。唯一 Bash 调用是不透明的；原事实没有完整对话或模型内部原因。它也没有保存的 provider 异常诊断，不能将明确的 VALID 失败改成 INVALID。不能从两个样本估计总体遵守率。

系统回退行为与现有 `applyTurnEnded` 的 A1r 逻辑相符（未报告工作时恢复原 lane）。投影没有保留 rule/note，故不声称本轮直接拿到了 A1r 标签。保留该行为；继续以 agent 回执而非最终 lane 判断遵守。

## 2. GPT T1：阶段切换晚，整体交付被 result 替代

被测会话 `fc0559fc-063a-4900-bdb1-7cc1cf73da78`；任务是写一句测试说明、执行指定检查、完成后交付，先不要提交。

| 顺序/UTC 时间 | 保存的事实 | 归因 |
| --- | --- | --- |
| seq 16 起 | 多次成功 get_task；type/tags/workpad 写入成功 | 不能把此例归为完全没读卡或工具整体不可用。此前有一次 CLI_FAILURE，后续正常恢复，不是最终失败的充分解释。 |
| 02:03:24.204 | development 状态回执 `042d5ba3-757e-4345-8c36-8e0c31fb7781` | 编辑前进入 development。 |
| seq 56 / 02:03:54.460 | edit `exec-ab150483-6504-4de3-8913-a21864a2d378` | 编辑阶段正确。 |
| seq 58 / 02:04:06.049 | 指定 check `exec-8e3488b4-75fa-48d3-99e4-1d8d7b26224f`；实际 exitCode=0 | 检查确实成功，但执行当时仍是 development，C02 明确 FAIL。 |
| seq 66 / 02:04:43.600 | get_task 返回 development | 检查后仍未切到 test。 |
| seq 68 / 02:04:43.923 | update_status(test)；note：“文档已写入，开始登记指定 fixture 与范围检查结果。” | Test 被用于登记检查结果时才切入，晚于真实检查。 |
| seq 76 / 02:04:58.090 | report_progress(result)；note：“按要求未提交，卡片保持 Test。” | 没有按 T1 的整体交付要求转到 in_review；C05.delivery 明确 FAIL。 |

**阶段问题的直接原因已可定位：**先执行检查，再切 Test 记结果。当前短清单第 2 项只说 “For research or verification, use design or test to match the current work”；第 3 项紧接着说跑完后登记结果。详细 skill 已要求验证时为 Test，短清单却没有把切换时点写成“执行检查前”。保存的 note 支持“把 Test 当成登记结果的阶段”的解释；这是基于行为的推断，不是读取了模型内部原因。

**交付问题的合理解释：**模型把“先不要提交”与“保持 Test、只报告 result”关联起来。它在最终 note 中明确这样处理。现有第 5 项并列提供 in_review / result，但没有在短清单里给出两者的选择标准。未提交的成果同样可以交到 In review；不需要为了满足本例增加提交要求。

**产物和 nextMoves 并未漏报：**result 回执 `639e92e4-7c68-4594-8b83-e70cb946e1f6` 带 `artifactIds=[db0d2371-4138-465a-b0ce-9f848e7a8206]`，与真实 role=output 文件对应；紧随其后的 next_moves 事件 offered=1。原表的 C05.outputs=FAIL 来自 grader 先过滤掉不符合 T1 要求的 result 交付，再检查有效交付是否声明 outputs；**它依赖交付类型错误，不是第三个独立“漏 outputs”问题**。本轮只解释依赖关系，不改评分或旧表。

## 3. 最小方案（待确认，尚未写入产品）

只收紧 `shared/turn-checklist.ts` 的两项，保持六项结构、1800 字符目标、原有义务和 `get_task` / skill 的单一来源。

**第 2 项草案：**

> Before edits: set development and define workpad acceptance criteria and checks. Before executing any check, including a verification-only follow-up: set test. Use design for research or planning. Keep the stage current as the work changes.

第 3 项继续负责检查结束后登记真实结果、commit 和 dirty；不把第 2 项的切阶段拖到登记时才做。

**第 5 项草案：**

> Before your final chat reply, including verification-only and commit/merge-only follow-ups: update workpad and obtain a successful delivery/result receipt. For a completed deliverable or an explicit handoff, use flowly_update_status(in_review), including when the user says not to commit. For a partial contribution or verification-only follow-up, flowly_report_progress(kind=result) is allowed; it does not replace a required overall handoff. Include outputs and nextMoves; use [] when none. A chat reply or a system-restored lane does not count as your delivery.

这仍允许 T2 用 result；T1/T3 仍要求 in_review；研究用 Design、编辑前 Development、检查前 Test 保持不变。没有强制所有任务走完整阶段流水线，也没有要求每回合必须提交。

如果用户确认实施，触及范围仅为：

1. `docs/TURN-CHECKLIST-SPEC.md` 同步两处措辞与选择标准；再改共享数组。
2. 由现有 `server/skill-source.ts` 生成仓库与运行时 skill，get_task 继续读取同一数组；不新增第二份清单或接口。
3. 在现有 `server/skill-source.test.ts` / `server/agent-service.test.ts` 补充这两处规则与单源一致性检查。它们只能证明规则正确生成/返回，不能证明模型会遵守。

**本轮不建议增加：**hooks、自动补登、回合后追问/补提示、服务端推断用户是否要求整体交付、自动切阶段、阶段执行审批或 provider 专属分支。Sonnet 的整轮零写调用不可能由现有工具写入提醒硬拦住；如果后续明确要求消除这类遗漏，需要另行评估宿主/provider 级执行边界，不能把本次文字方案宣传成硬保证。

## 4. 验收与证据限制

- 已运行本目录 `verify-evidence.py`：核对两回合完整性、顺序/回执、GPT 文件 output 与 nextMoves、原始和独立重评哈希、现行产品规则不变，以及上述两项替换后仍是 6 项且不超 1800 字符。
- 未执行：产品改动、模型/Luna/审查会话、benchmark run/grade/cleanup、安装/reload、全量测试、Git 提交/推送、fixture/业务数据操作。本轮没有改动产品实现，无需为报告重跑产品套件。
- 原 run 为 `20261023020035204-8b1863`；初版与 scope 独立重评继续并存，整体 FAIL/exit 1 不变。
- manifest 的已安装 skill hash 与当前仓库生成 skill 相同；`loadedImplementationHash=unknown`，保存的 context 投影未保留 turnChecklist 文本。因此不能声称已证明某份清单逐字进入每个被测回合，也不能把本轮结论写成受控版本改进效果。
- 本报告是方案交付，未提交；只新增本分析目录，不改混合文档或其他会话文件。没有 UI、设置、用户操作流程变化，无需 onboarding / tip / What's new。
