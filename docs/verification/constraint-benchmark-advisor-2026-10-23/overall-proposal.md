# 流程约束整体方案：Fable advisor 评审稿

2026-10-23。卡片 `08a37039-643c-4354-9062-0fefdf2eec21`，主会话 `036d5d2b-d2b0-4b54-9ef7-d80c04a0896f`。**设计评审稿，不是已实施的规则变更，也不是新 benchmark 成绩。**

## 1. 目标与现有决定

让 agent 在工作的当回合自己完成读卡、设置、正确阶段、真实检查、产物登记和业务收尾；短验证、提交/合入、交付后跟进同样适用。方案由 Flowly 插件提供，适用于任意项目，不要求用户额外编写仓库 AGENTS.md。

保持用户已接受的最小路径：统计口径校准 → 共享简短动作清单供 skill/get_task 使用 → 原子 outputs 与先拒后确认 → 用标准 benchmark 保存失效、检验后续修正。不同层次不互相充当通过证明。

约束不变：编辑前 Development；执行任务验收/验证时 Test；研究/方案为 Design；整体交付 In review；阶段贡献或纯验证跟进可用 result。无需所有任务走完整阶段流水线；不增加提交要求，未提交成果也可以交付；Done/Cancelled 由人决定。

不加 hooks、自动补登、回合后补提示、服务端推断任务完成、自动切阶段或新审批。不扩展 B02–B04/compare/自动续跑。永久 Tinylink 和保留的私有仓库/PR 历史不动。

## 2. 三层如何共同工作

| 层次 | 已实现的范围 | 能证明/保障什么 | 仍然覆盖不了什么 |
| --- | --- | --- | --- |
| 规则送达 | `shared/turn-checklist.ts` 六项；`server/skill-source.ts` 生成 skill；每次 get_task 返回同一清单，详细规则保留 | 生成/接口一致性；读卡时取得当前服务规则 | 不保证每回合一定读卡或服从；已保存运行的 loadedImplementationHash 仍 unknown，不声称已证明逐回合逐字送达 |
| 写入保障 | revision/request；type/tags/workpad setup；In review 的 open-items gate 先拒后确认；outputs/产物/交付/nextMoves 同事务；成功交付/结果上的遗漏提醒 | 已调用路径的拒绝、原子性、重放，以及遗漏后的显式反馈 | 不阻止完全绕开 Flowly 的回合；不判断说明是否诚实；result 不新增 In review 的 gate，不能把其合法用途封死 |
| 独立测量 | 校准后的 audit；B01 三回合/双模型 quick；主动/最终两表；服务端回执/实体/完整 flow；版本化与独立重评；共享 scope 评分/清理 | 真实行为失败、UNKNOWN/INVALID、恢复与安全清理，且保留原始证据 | 合成/契约测试不证明模型遵守；一次受控场景不证明总体遵守率；顺序证据不足不猜 |

这三层已在 [交付规范](../../DELIVERY-CONSTRAINTS-SPEC.md)、[共享清单规范](../../TURN-CHECKLIST-SPEC.md)、[benchmark 规范](../../CONSTRAINT-BENCHMARK-SPEC.md) 中分别定义。整体稿不取代这些规范。

## 3. 保存样本暴露的剩余问题

来源：[分析报告](../constraint-benchmark-analysis-2026-10-23/report.md)、[两回合投影](../constraint-benchmark-analysis-2026-10-23/evidence.json)、[原始 facts](../constraint-benchmark/20261023020035204-8b1863/facts.json)、[原始成绩](../constraint-benchmark/20261023020035204-8b1863/report.md)、[scope 独立重评](../constraint-benchmark-scope-2026-10-23/regraded-report.md)。

- **Sonnet T2**：只有一次 opaque Bash，成功业务回执为零，workpad revision 2→2；无 agent 交付/result、outputs 声明或 nextMoves。业务收尾失败确定；读卡、检查与阶段仍 UNKNOWN，不能断言 compaction、quota 或未执行检查。系统恢复 In review 没有 agent 回执，不当作交付。依赖写调用的提醒没有触发机会。
- **GPT T1**：编辑前 Development 正确；seq58 在 Development 执行指定检查，exitCode=0；seq68 才切 Test，note 明说开始登记检查结果；最后 result 表示“未提交，卡片保持 Test”，未按 T1 整体交付到 In review。文件 output 与 nextMoves 实际均成功，C05.outputs 的 FAIL 依赖交付类型过滤，不另计独立漏登记。
- **GPT T3 scope**：导入既有 fixture 历史的误报已经修正，独立重评 PASS；其余五回合成绩不变，整体仍 FAIL/exit1。该修正不是本轮拟改的流程规则。

行为解释与原因假设分开。当前材料足以定位错误发生的边界；不能读取模型内部原因，也不能由两个样本计算模型总体可靠性。

## 4. 拟做的最小增量

仅收紧共享清单第 2、5 项，继续六项/目标≤1800字符。其余四项、原始详细规则、工具接口/门槛与 grader 规则不变。

第 2 项草案（沿用前轮分析原文）：

> Before edits: set development and define workpad acceptance criteria and checks. Before executing any check, including a verification-only follow-up: set test. Use design for research or planning. Keep the stage current as the work changes.

第 5 项草案：

> Before your final chat reply, including verification-only and commit/merge-only follow-ups: update workpad and obtain a successful delivery/result receipt. For a completed deliverable or an explicit handoff, use flowly_update_status(in_review), including when the user says not to commit. For a partial contribution or verification-only follow-up, flowly_report_progress(kind=result) is allowed; it does not replace a required overall handoff. Include outputs and nextMoves; use [] when none. A chat reply or a system-restored lane does not count as your delivery.

预期作用：把 Test 的时点从登记结果前移到执行验证前，消除“先不要提交”与交付状态的混淆；让纯验证回合也在最终聊天回复前完成业务收尾。**仅是降低遗漏概率的指令修正，不是 Sonnet 零写调用问题已解决的承诺。**

“检查”在这里指任务验收/验证动作，普通定位读取不应被强制切 Test。“completed deliverable / partial contribution”的边界以及显式要求暂停、只读、等待等指令的优先级，需要评审确认这段简短英文是否足够清楚，避免为了覆盖 B01 而误约束一般任务。

若获确认再实施：先更新 TURN-CHECKLIST-SPEC，再修改共享数组、由现有生成器同步 skill，必要的规则/单源一致性测试。没有新 API、hook、UI 或设置；无需新 onboarding/tip。

## 5. 验证与推进门槛

本轮只允许 Fable advisor 阅读既有文件和保存事实；不得运行被测模型、fixture、benchmark run/grade/cleanup，不更改原始/独立重评、产品代码或业务数据。advisor 也不代替主会话写卡片状态/workpad。

以后实施时先做离线规则生成/接口一致性检查。这只能证明文字及返回路径正确。新模型行为测试需另获用户授权，仍用同一 B01/固定短提示/创建时 full access，不补提示、不代改数据；保留旧成绩、新 run 和未知。只有真实证据支持，才宣称本次变更改善遵守率。

benchmark 继续保留：事实前置条件而非前轮全 PASS；主动/最终分开；独立 FAIL 不被 UNKNOWN 擦掉；机械 stale 的输入等价与真实执行 SHA；receipt 来源为只读 daemon storage 或工具结果，board.read 不含回执；nextMoves 随交付只评主动、同回合独立声明可满足最终。C05.outputs 的依赖失败须在分析里解释，不把原表静默改成新的独立错误统计。

清理继续只操作本次有完整 ownership 的资源，删除前先 idle/冻结证据；scope 审计共用，冻结 fixture 历史原样导入可豁免，额外修改/缺证据仍阻断。原 run/重评及永久 fixture 历史保留。

## 6. 请求 Fable 回答

1. 放进三层整体后，两处措辞是不是当前最小、必要且有证据支撑的增量？是否只是重复已有规则而收益不足？
2. “any check”“completed deliverable/explicit handoff”“final chat reply”是否引入阶段扩大、result 合法用途冲突、纯问答/取消/等待等误触发？给出最短可用文字，保持现行阶段要求。
3. 对 Sonnet 零写调用只承诺降低风险、暂不加 hooks 的判断是否合理？如果仍有根本缺口，区分本轮必须修与以后明确需求才做。
4. 整体方案是否误把服务端契约、文字一致、UNKNOWN 或单次样本当行为改善？旧评分依赖/加载身份不明是否妨碍这次指令修正的设计成立？
5. 给出“可实施 / 修改后实施 / 暂缓”的独立结论、阻塞项、最小修改与后续授权边界。不要用“多加规则/全量重测”代替针对性判断。
