**复核结论：无阻塞，可实施。** 修订稿消除了前两处阻塞，四点诊断口径修正我都接受。剩一处实质遗漏和两处小建议。

## 事实

- 六项拼接后 1545 字符（含换行），低于 `server/skill-source.test.ts:11` 的 1800 上限。
- 第 2 项按目的分类（design = research/planning/specs；implementation 含 docs-only → development；task verification → test；ordinary inspection 不切）与 `server/skill-source.ts:22`、`server/tool-server.ts:202` 的现有表述一致，没有新规则。"ensure test" 允许继承的 test 泳道，与 grader `grade.mjs:42` 的 `stage === wanted` 判定一致。
- 第 5 项"Pure conversation or a pause needs no delivery"使 A1r（`server/progress-rules.ts:138`）在问答回合继续恢复泳道；"After a question or blocked report, do not add a result; keep their existing nextMoves rules"与 `server/reminders.ts:27-32` 的 question/blocked 提醒路径一致。
- 你对第 1 点的纠正成立：现有规则是整卡交付 in_review、部分贡献不完成整卡（`server/skill-source.ts:22`、`server/tool-server.ts:218`），我原先"有新交付物就 in_review"是扩张。
- Sonnet T2：receipts 来自 daemon 存储且 receiptsComplete=true，所以"零成功业务写入"是事实；"零读卡"只是未观测（opaque Bash 可能是 CLI `current`，`facts.mjs:140-143` 只在能解析 argv 时才归类）。同意改口径。
- reload 日志只证明某时刻发生了 reload，不等于取得 loadedImplementationHash。同意。

## 一处实质遗漏（建议修，不算冲突）

修订稿第 5 项把原第 5 项的"update workpad, **then deliver … or report …**"拆成了两句：先"update workpad"，后"Use in_review for A；report B with result"。第二句读起来是"该用哪个"的映射，不再是"工作回合结束前必须有一个回执"的义务。Sonnet T2 的失败恰是整回合没有任何回执，这句义务正是针对它的。建议改为：

```
Before ending a work turn (…), update workpad, then end it with one receipt: flowly_update_status(in_review) for the card's overall delivery or the user's requested handoff, even if uncommitted; flowly_report_progress(kind=result) for partial work or a verification-only follow-up.
```

这是恢复原第 5 项已有的义务，不是新规则。

## 两处小建议（不阻塞）

1. 触发括号里的 "including research" 与 "Pure conversation … needs no delivery" 在"用户问个问题、agent 读代码后回答"这个灰区会拉扯：若 agent 把它归为 research 并报 result，在 In review 卡片上会重现 A1r 不恢复的问题，只是范围缩小了。建议写成 "including the card's research work"，或直接去掉 research（卡片本身的调研工作已属 work turn）。推断：这是措辞歧义，不是规则冲突。
2. "A new artifact alone does not mean the whole card is complete" 防止了过度升级；反向的欠升级（T3 "创建 PR 并合入"被当成 commit/merge follow-up 报 result）仍有残余歧义，但这是现行第 5 项已有的歧义，且本 run 两个模型 T3 都正确交了 in_review，没有证据需要加字。"Follow explicit stop/wait instructions" 不是 Flowly 规则，无冲突，可留可删。

## 诊断口径

四点全部接受。精确表述建议：Sonnet T2 "零成功业务写入（存储回执为证），读卡未观测"；Sonnet T1 "T1 前文件不存在、交付时 outputs 目标存在校验通过、agent 唯一状态变更为 todo→in_review，因此编辑发生在 todo 期间"作为实质线索记入分析，旧 grader UNKNOWN 不回写；GPT T2 的 test 为继承，T1 修正后 T2 可能新暴露 C02；重跑前 reload 并记录，但实现身份仍记 unknown，除非 daemon 能给出加载产物的核对信息。

## 最终设计建议

按修订稿实施，只补回"then end it with one receipt"这一句，顺手处理 research 措辞。先改 `docs/TURN-CHECKLIST-SPEC.md:16, 19`，再改数组并重新生成 SKILL.md。不新增 API/hook/UI，不改阶段规则，无需 onboarding。模型重跑另行授权，且 Sonnet 的 C02/C03 在采证未改前仍会是 UNKNOWN。
