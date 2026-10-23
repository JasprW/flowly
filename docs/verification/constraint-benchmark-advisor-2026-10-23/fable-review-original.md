# Fable Advisor 评审：流程约束整体方案（2026-10-23）

**结论：修改后实施。** 第 2、5 项措辞调整的方向正确且有证据支撑，但草案第 5 项的触发条件扩大到了所有回合，会把现在正确的 A1r 回退行为变成错误泳道，必须改掉才能实施；第 2 项的 "any check" 也要收窄。其余判断（不加 hooks、保留原成绩、只说降低风险）成立。

## 一、阻塞项（不改不能上）

**1. 第 5 项草案把触发点从"工作回合"改成"最终聊天回复前"，误伤纯问答、暂停指令、提问和阻塞回合。**

事实：草案要求 "Before your final chat reply ... obtain a successful delivery/result receipt"，没有 "work" 限定。而现行逻辑是：用户向 In review 卡片发任何消息，`server/progress-rules.ts:54` 的 A1 先把卡移到 development；回合结束时 `server/progress-rules.ts:138` 的 A1r 仅在"本回合没有 agent 事件（next moves 除外）"时才把卡恢复回 in_review。

失败场景：用户在已交付卡片上问"这个函数做什么"或说"先等一下"。按草案，agent 在回复前调用 `flowly_report_progress(kind=result)`，这就产生一个 agent 事件，A1r 不再恢复，卡片停在 development，但其实没有任何工作发生。今天 agent 只回复、不写入，A1r 会正确恢复。草案把正确行为改坏了。

同样受影响的还有以 kind=question 或 blocked 结束的回合：草案要求"delivery/result 回执"，agent 会在提问之外再补一个 result，形成双重收尾。

**2. 第 2 项的 "any check" 超出现行阶段要求。**

事实：`docs/WORKFLOW-STAGES-SPEC.md:22` 把 Test 定义为"验证"；`docs/CONSTRAINT-BENCHMARK-SPEC.md` §4 明确"工作边界为……执行任务验证……普通定位读取可以先发生"；grader 也只把与任务检查命令精确匹配的调用算作 check（`benchmarks/constraints/facts.mjs:6-9`）。草案的 "any check" 会让实现过程中反复跑 typecheck/lint 的 agent 在 development 和 test 之间来回切换，每次都增加 task revision，且与稿内 §4 自己写的"普通定位读取不应被强制切 Test"矛盾。英文正文没有带上这个限定。

## 二、对 §6 五个问题的回答

### Q1 哪些是真必要的增量

| 草案改动 | 判断 | 依据 |
| --- | --- | --- |
| 第 2 项：把"切 Test"的时点写成"执行检查前" | **必要** | GPT T1 seq 58 在 development 执行检查，seq 68 才切 test，note 原文"开始登记……检查结果"（evidence.json）。现行短清单第 2 项（`shared/turn-checklist.ts:4`）没有时点，详细规则在 `server/skill-source.ts:22` 才说 "to test when you verify"。这是补时点，不是重复。 |
| 第 2 项："Before changing code" 改为 "Before editing files" | 必要、零成本 | B01 改的是 .txt；"code" 可被读成不含文档。Sonnet T1 事实上从 todo 直接到 in_review，从未设 development（见 Q4）。 |
| 第 5 项：未提交成果也交 in_review；result 只用于阶段/纯验证 | **必要** | GPT T1 seq 76 note 原文"按要求未提交，卡片保持 Test"。现行第 5 项（`shared/turn-checklist.ts:7`）是 "A or B"，没有选择标准。 |
| 第 5 项：触发词改为 "Before your final chat reply" | **不必要且有害** | 见阻塞项 1。Sonnet T2 的证据（整回合 5.6 秒、一次 Bash、零读卡）不能说明"触发词不够具体"是原因。 |
| 第 5 项："A chat reply or a system-restored lane does not count" | 可留，改措辞 | agent 看不到 "restored" 这个概念，只会看到 note 文本。改成"聊天回复不是交付"即可。 |

### Q2 措辞是否扩大阶段、误伤 partial/result/问答/暂停

- **扩大阶段**：是，"any check" 扩大了（阻塞项 2）。
- **误伤纯问答与暂停指令**：是，"final chat reply" 无 work 限定（阻塞项 1）。
- **result 合法用途冲突**："partial contribution / verification-only → result allowed" 本身没有封死 result，但对"提交/合入类回合"没有说用哪一种。基准 T3 要求 in_review（`docs/CONSTRAINT-BENCHMARK-SPEC.md` §3），草案把 commit/merge-only 列在触发里却没给归类，agent 可以合理地把"开了 PR"叫 partial。选择标准应改成"用户要求的工作已完成，或产生了新交付物（文件、报告、PR/MR）→ in_review"。
- **需要明说的既有后果**（不是本次缺陷）：纯验证回合用 result 结束时，卡片会从 A1 移入的 development 变成 agent 设的 test，并停在 test（A1r 因有 agent 写入不恢复）。GPT T2 就是这样。现行规则允许，用户应知道这是接受的产品行为，以免日后被当成回归。

### Q3 对 Sonnet 零写调用"只承诺降低风险、暂不加 hooks"是否合理

合理，且应说得更坦白。事实：规则只有两条送达通道，会话创建时的指令（`server/skill-source.ts:54`）和每次 get_task（`server/agent-service.ts:305`）；提醒只附在成功写入上（`server/reminders.ts:21-30`）；`docs/TURN-CHECKLIST-SPEC.md:9` 早已写明"完全不调用工具的回合仍无法靠 get_task 提醒"；AGENTS.md 不变量规定跟进只发用户原文，不能注入。所以对 Sonnet T2 这类回合，新措辞只能靠 T1 时读到的初始指令起作用，连"降低风险"也只是推断。

但诊断不完整。事实（facts.json 事件）：Sonnet 整个 run 里 agent 自己设置的状态只有 T1 的 todo→in_review 和 T3 的 development→in_review，从未进入 development 或 test。T1 开始前目标文件不存在、结束时非空、HEAD 未变、agent 唯一状态变更发生在 02:01:29，因此编辑必然发生在 todo 状态下。grader 判 UNKNOWN 只是因为它只识别 Claude 的 edit/write 工具和精确 `node <path>` 命令（`benchmarks/constraints/facts.mjs:59-63, 96-100`），Sonnet 全用 Bash。推断：Sonnet 的问题不是"短验证回合漏收尾"，而是即使写入时也不遵守阶段规则。第 2 项的措辞修正对它大概率无效，稿内应直说，避免日后把重跑后的 Sonnet UNKNOWN 读成改善。

本轮必须修的：无（措辞之外）。以后需明确需求才做的：(a) 若用户要的是零调用回合的保证，只能是宿主/provider 级机制，属于新需求；(b) 只改测量不改规则：让采证识别 Claude 的检查调用（如 `cd … && node …`），否则重跑时 Sonnet 的 C02/C03 永远 UNKNOWN，B01 对 Sonnet 只能看 C05 一项。这属于 grader 侧修正，按 scope 修订那样独立版本化。

### Q4 是否误把契约、文字一致、UNKNOWN、单样本当行为改善

稿内分层表和 §5 的口径是对的，C05.outputs 的依赖关系解释与 `benchmarks/constraints/grade.mjs:87-90` 一致。需要修正三处读法：

1. **GPT T2 的 C02 PASS 是继承来的。** 事实：T1 以 result 结束在 test，A1 只对 in_review/blocked 触发（`server/progress-rules.ts:54, 85`），所以 T2 开始时卡片仍是 test，GPT 在 T2 没有设过任何状态。推断：这不是 GPT 会主动"验证前切 test"的证据。T1 修好后（交 in_review），T2 开始会被移到 development，GPT 必须自己切 test，T2 可能新出现 C02 FAIL。应提前写明这是暴露而非回归。
2. **Sonnet 的 C02 UNKNOWN 掩盖了实质确定的 T1 违规**（见 Q3）。基线不应被理解为"Sonnet 只有 T2 出错"。
3. **loadedImplementationHash=unknown 不妨碍措辞设计成立**，但使本 run 不能充当受控对比的"前"。已核：manifest 的 skillHash 与当前 `skills/flowly/SKILL.md` 的 sha256 一致（b2c9ac04…），这只证明文件，不证明 daemon 已加载。若授权重跑，最低操作前提是改动后 reload 插件并把 reload 证据（日志行/时间）记入 manifest，否则又是 unknown 对 unknown。

### Q5 独立结论

**修改后实施。** 阻塞项见第一节。非阻塞建议：第 5 项控制在 550 字符内；分析报告补入 Sonnet T1 的事实；重跑前提加 reload 记录。

## 三、最短可用修改

第 2 项（301 字符）：

```
Before editing files: set development and write the workpad acceptance criteria and checks. Before running the task's checks (workpad checks or checks the user asked for), also in a verification-only follow-up: set test. Use design for research or planning. Keep the stage current as the work changes.
```

第 5 项（541 字符）：

```
Before the final reply of a turn in which you edited files, ran the task's checks, committed or opened a PR/MR: update workpad, then deliver with flowly_update_status(in_review) when the requested work is done or a new deliverable exists (uncommitted work too, even when told not to commit); use flowly_report_progress(kind=result) only for a partial step or a re-verification with nothing new to hand over. Include outputs and nextMoves; [] when none. A chat reply is not a delivery. A turn you end with a question or blocked needs neither.
```

六项合计约 1453 字符，低于 `server/skill-source.test.ts:11` 的 1800 上限。触发条件用可枚举动作（编辑、跑任务检查、提交、开 PR/MR）定义"工作回合"：T1 命中并交 in_review，T2 命中且允许 result，T3 产生新交付物故 in_review，纯问答、"等一下"、提问、阻塞均不命中。

## 四、实施边界

- 先改 `docs/TURN-CHECKLIST-SPEC.md:16, 19`，再改 `shared/turn-checklist.ts`，重新生成 `skills/flowly/SKILL.md`（`server/skill-source.test.ts:14` 强制逐字相等）。
- `server/tool-server.ts:202, 218` 的工具描述已与新措辞一致（test for verification；partial contribution does not complete the card），不需改。
- 不新增 API、hook、UI、设置；agent 面向文本保持英文，无 onboarding/tip/What's new，同意稿内判断。
- 模型重跑需另行授权；重跑只能证明 GPT 的 C02/C05 和 Sonnet 的 C05 变化，Sonnet 阶段项在采证未改前仍 UNKNOWN。

## 五、事实 / 推断 / 未验证

- **事实**：以上引用的文件行号、facts.json 事件与回执、manifest 字段、SKILL.md 哈希一致、A1/A1r 代码条件、grader 分类规则、两份成绩均 FAIL/exit 1、cleanup PASS。
- **推断**：Sonnet T1 编辑发生在 todo 状态（由文件前后状态、HEAD 未变、唯一状态事件时刻推出）；GPT T1 把 Test 当登记阶段、把"不提交"与 result 关联（由 note 原文推出）；新措辞对 Sonnet 大概率无效。
- **未验证**：daemon 当时是否已加载 PR #35 实现；Sonnet T2 唯一 Bash 是否运行了检查；任何措辞变化对两个模型的实际效果。本次评审未运行任何测试、模型或写入。
