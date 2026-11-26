# Auto review P0 独立验证

- 提交：`58336c90c81e5b6dc76eec355847b2e209711fd8`（`fix/auto-review-p0`，detached 验证）
- 模型：`codex/gpt-6-luna`
- 本会话 ID：`01a217b0-05ff-7620-a766-78119d443450`
- 环境：`/tmp/flowly-verify-p0`；`NODE_ENV=test FLOWLY_TELEMETRY=0`

## 命令与结果

| 命令 | 退出码 | 通过 / 失败 / 跳过 |
| --- | ---: | --- |
| `npm ci` | 0 | 369 packages added；不适用测试计数。npm audit 提示 4 个 moderate vulnerabilities。 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | 0 | typecheck 通过；不适用测试计数。 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 0 | 测试文件 172 / 0 / 1（共 173）；测试用例 1602 / 0 / 6（共 1608）。 |
| `npx vitest run server/auto-review.test.ts -t "a disputed goal is still judged on every later delivery"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "a disputed command is skipped only at the commit it failed on"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "in a shared directory commands run and show their result but never send the card back"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "a deciding command that fails runs once more at the same commit"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "the review reads answers given in question tools as what the user said"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "a Codex answer that spans lines is kept whole"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run server/auto-review.test.ts -t "only the user's answer in a question tool counts as quoted evidence"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 60。 |
| `npx vitest run shared/auto-review.test.ts -t "E2: a question-tool answer keeps the question apart"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 13。 |
| `npx vitest run shared/memory.test.ts -t "reads Codex async answers from the follow-up message"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 20。 |
| `npx vitest run shared/memory.test.ts -t "reads Claude AskUserQuestion answers"` | 0 | 测试文件 1 / 0 / 0；用例 1 / 0 / 20。 |

## 要求覆盖

1. **争议按单条意见处理**：`a disputed goal is still judged on every later delivery; failing again with new evidence ends the dispute` 验证下一轮仍提交 goal 判定、输入含旧 finding 和 agent reason，重判失败后结束争议；`a check still disputed needs a new verdict in every rework round; it does not inherit its earlier pass` 验证争议项不能沿用旧 pass。**命令只在同 SHA 跳过**：`a disputed command is skipped only at the commit it failed on; new code runs and decides it again` 验证同 SHA 不运行、新 SHA 再运行并可退回；`a command disputed from a worktree still runs when the same commit is delivered from a shared directory` 验证共享目录不受旧争议跳过。覆盖符合卡片要求。
2. **问答进入评审输入**：`the review reads answers given in question tools as what the user said, in time order with the messages` 覆盖 Claude `AskUserQuestion`、Codex 异步答案、与消息的时间顺序、评审 prompt 和 quote；`a Codex answer that spans lines is kept whole from readConversation through the quote check` 覆盖多行回答；`only the user's answer in a question tool counts as quoted evidence, not the agent's question` 覆盖问题文本不能作为 quote 来源。`E2: a question-tool answer keeps the question apart; only the whole answer is the user's words, even with an arrow in it`、`reads Claude AskUserQuestion answers`、`reads Codex async answers from the follow-up message` 分别覆盖格式化、Claude 解析和 Codex 多行解析。断言覆盖符合卡片要求。
3. **共享目录命令不退卡**：`in a shared directory commands run and show their result but never send the card back` 断言失败结果可见、`gating: false`、卡片仍在 In review、命令只运行一次且未发返工。**flaky 重跑**：`a deciding command that fails runs once more at the same commit: a pass then is flaky, not a rework` 断言运行两次、结果标为 flaky、保留首轮输出且不退卡。覆盖符合卡片要求。

三条点名单测均存在并通过：上述 disputed goal、question-tool answers、shared directory commands 三项。断言过弱：无；但争议指令能否被真实模型遵守不由 mock 单测证明，真实模型验证未运行。

## 发现与未执行

- 文档状态不一致：`docs/GUARDRAILS-SPEC.md` 顶部仍写“设计、待实现”，但同一提交的 `docs/PROGRESS.md` 记录这些改动已实现，且代码与 E1–E3 正文一致。按仓库约定以现有代码为准；这是状态标记过期，不影响本次单测结论。
- 失败输出：无。
- UNRUN：真实模型/provider 对争议 prompt 的行为、安装插件后的宿主运行、桌面/手机 UI、在线环境验收。
- 清理：`git worktree remove --force /tmp/flowly-verify-p0` 退出码 0；随后 `git worktree list` 确认该 worktree 已移除。
