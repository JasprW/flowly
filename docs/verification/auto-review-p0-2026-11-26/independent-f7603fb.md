# Auto review P0 独立验证报告

日期：2026-11-26  
提交：f7603fbdbae0f742e82ea4daee5424be8be93df7 (f7603fb)  
验证环境：/tmp/p0-verify-f7603fb，detached worktree。验证前后 server/auto-review.ts 已恢复，git diff --exit-code 通过；其余实现文件未改。

## 总结果

基线验证通过；步骤 3 的旧行为反事实测试按预期失败，恢复后再次通过。没有发现本次列出的 P0 回归。已对照 AUTO-REVIEW-SPEC.md §4.2、GUARDRAILS-SPEC.md §6.1/§6.3 和 PROJECT-MEMORY-SPEC.md §4.0；所测行为与文档一致。

## 安装与全量检查

| 命令 | 退出码 | 结果 |
|---|---:|---|
| npm ci | 0 | 安装 369 个 packages。npm 输出 4 个 moderate audit findings；未单独调查。 |
| npm run typecheck | 0 | 通过。 |
| npm test | 0 | 172 个测试文件通过、1 个跳过；1602 个用例通过、6 个跳过。 |

## 点名单测（分别运行）

以下每条命令单独执行，退出码均为 0。

- `npx vitest run server/auto-review.test.ts -t "a disputed goal is still judged on every later delivery; failing again with new evidence ends the dispute"` — 1 passed、60 skipped。强：争议中的 goal 仍进入评审输入，提示包含旧意见和理由；再次失败结束该争议，下一次交付仍检查 goal。
- `npx vitest run server/auto-review.test.ts -t "the review reads answers given in question tools as what the user said, in time order with the messages"` — 1 passed、60 skipped。强：AskUserQuestion 答案按时间进入会话和评审提示，并可作为 quote 证据；也检查会话隔离及返工消息过滤。
- `npx vitest run server/auto-review.test.ts -t "in a shared directory commands run and show their result but never send the card back"` — 1 passed、60 skipped。强：失败命令显示为 gating: false、只运行一次；goal 评审仍运行，卡留在 In review，且没有返工消息。
- `npx vitest run server/auto-review.test.ts -t "a Codex answers message stays the user's whole message, from readConversation through the quote check"` — 1 passed、60 skipped。强：整条消息保持原样；空行后恰为两行的样例引用首行 "In the drawer:" 后明确得到 { state: "failed", quote: "In the drawer:" }。
- `npx vitest run shared/memory.test.ts -t "reads Codex async answers from the follow-up message and skips the async tool call itself"` — 1 passed、20 skipped。强：验证可确定的拆分、模糊格式不拆分，以及异步工具调用本身不当作答案。
- `npx vitest run server/memory.test.ts -t "native question answers become answer clues once; the Codex answers message is not also a plain message"` — 1 passed、17 skipped。强：验证结构化回答只生成一次 answer clue，含歧义的异步消息保留为原样 message。

小的断言缺口：auto-review.test.ts 中另一个空行样例对 Keep "Retry" on the card 只断言 state: "failed"，没有单独断言 quote 字段；本次指定的“空行后恰好两行”关键边界则有完整的精确 quote 断言，不影响该 P0 验收。

## 步骤 3：临时恢复旧解析行为

- 原实现核对：readConversation 对 user_message 使用空的 answers，仅对工具调用调用 questionAnswers；所以 Codex Answers to your questions: 消息完整作为用户消息。
- 原实现下，指定 Codex 单测通过（退出码 0）；其中 "In the drawer:" 被当作用户原话 quote，结果为 failed。
- 临时将该行改为 const answers = questionAnswers([entry.item]); 后，单测按预期失败（退出码 1）：
  期望整条 “Answers to your questions:” 消息为单条记录；实际被拆为 { ask: “What should change?”, answer: “Keep the card as it is.” } 和 { ask: “In the drawer:”, answer: “rename Retry to Rerun” }。
- 失败发生在 twoLines 的 readConversation 整体保留断言（server/auto-review.test.ts:1317）；旧行为把目标 quote 行错认成问题标题。
- 已恢复原实现；git diff --exit-code -- server/auto-review.ts 退出码 0。恢复后重新运行同一单测：1 passed、60 skipped，退出码 0。

## 未运行

- 未做插件安装/重载、Paseo 实时 UI、手机或真实模型验收；本报告只覆盖指定 commit 的离线测试。
- 未单独运行 npm audit 或 git diff --check；npm 安装时的 4 个 moderate findings 未展开分析。
