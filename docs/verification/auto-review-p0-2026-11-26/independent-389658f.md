# Auto review P0 独立验证

日期：2026-11-26  
提交：`389658f643d52138a0f15b074a41d8de9f28d429`（`fix/auto-review-p0`）  
验证目录：临时 detached worktree `/tmp/p0-verify-389658f`。未改实现文件。

## 结论

指定安装、typecheck、全套测试、定点测试均通过。重复题干的回归测试能区分同一 session 中不同请求，并且反向验证证明它会捕获把精确匹配退化为 `known[0]` 的错误。

有一处验收边界未完全通过：Paseo 格式的多行问题会先按原文参与消息匹配，但进入评审输入前，`conversationForReview` 会把问题中的换行折叠为空格；答案中的空行和换行保留。现有回归测试也明确期待问题换行折叠。因此，如果“多行问题原样保留”要求评审输入仍保留换行，则此点不符合要求。另一个小的测试覆盖缺口是：测试断言两条回答都由 `readConversation` 返回，但没有在同一次评审调用中直接断言二者都出现在 `LlmReviewInput.conversation`。

## 命令与结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `git worktree add --detach /tmp/p0-verify-389658f 389658f` | 0 | detached HEAD 指向目标提交 |
| `npm ci` | 0 | 安装 369 个包 |
| `npm run typecheck` | 0 | 通过 |
| `npm test` | 0 | 173 个测试文件通过、1 个跳过；1605 个用例通过、6 个跳过 |
| `npm test -- server/auto-review.test.ts -t "a disputed goal is still judged on every later delivery"` | 0 | 1 通过，60 跳过 |
| `npm test -- server/auto-review.test.ts -t "the review reads answers given in question tools as what the user said"` | 0 | 1 通过，60 跳过 |
| `npm test -- server/auto-review.test.ts -t "in a shared directory commands run and show their result but never send the card back"` | 0 | 1 通过，60 跳过 |
| `npm test -- server/auto-review.test.ts -t "a Codex answers message is read as the answers of the call it was sent for"` | 0 | 1 通过，60 跳过 |
| `npm test -- server/async-questions.test.ts` | 0 | 3 通过 |
| 指定 `@electron/asar extract` 命令 | 1 | 解包目标文件成功；因 app.asar 引用了缺失的 `app.asar.unpacked` 文件而整体返回 1 |
| 反向验证：将 `known.find((a) => a.message === text)` 暂改为 `known[0]` 后运行回归测试 | 1（预期） | 测试失败，发现旧请求的双回答被错误映射；失败摘要见下 |
| 恢复后 `git diff --exit-code -- server/auto-review.ts` | 0 | 文件已还原 |
| `git worktree remove --force /tmp/p0-verify-389658f` | 0 | 临时 worktree 已移除；后续 `git worktree list` 中无该路径 |

反向验证失败摘要：`AssertionError: expected [...] to deeply equal [...]`；回归测试原本期望旧调用的两条回答和新调用的一条回答各自映射，`known[0]` 变体只把较新的单题答案映射到两条消息。

ASAR 解包的失败摘要：`ENOENT ... app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`。尽管命令返回 1，以下两个目标文件均已解出并读取：

- `node_modules/@getpaseo/server/dist/server/server/agent/providers/codex/async-questions.js`
- `node_modules/@getpaseo/server/dist/server/server/agent/providers/codex-app-server-agent.js`

## 逐条测试与断言评估

| 场景 | 结果 | 断言评估 |
| --- | --- | --- |
| 争议过的 goal 在下一次交付仍被判定 | PASS | 检查第二轮仍把 `goal` 交给评审，带入争议原因和上一轮 finding；第三轮争议清除后再次判定。断言充分。 |
| AskUserQuestion 回答进入评审输入 | PASS | 检查 `readConversation` 输出、`LlmReviewInput.conversation`、评审 prompt 和回答 quote；断言充分。 |
| 共享目录命令失败不退回卡片 | PASS | 检查卡片仍在 `in_review`、命令失败但 `gating: false`、只运行一次、没有返工消息，并检查评审输入中的说明；断言充分。 |
| Codex 重复题干与实际回答请求匹配 | PASS | 检查两个请求按各自 call id 配对、重复题干不混淆、问题不能成为 quote、无请求记录时保留整条消息。两条回答都在 `readConversation([two, one])` 的结果中；但没有在同一个 LLM 输入 spy 中直接检查两条回答，存在上述小覆盖缺口。 |
| `server/async-questions.test.ts` | PASS | 3 个用例覆盖 call id 配对、拒绝/未答全请求、容量限制；包括答案 trim 与内部空行/换行保留。 |

## Paseo 源码与重点行为

- `toPermission` 生成 `permission-${itemId}` 请求 id，并把 `questions[].title` 映射到 `input.questions[].question`。
- `prepareResponse` 从 `answers["Question n"]` 读取并 trim 答案；回答消息格式为 `Answers to your questions:\n\n`，之后按 `question.title\nanswer` 拼接，题目间用空行分隔。
- `respondToAsyncQuestion` 发出完成后的 timeline 项和 `permission_resolved`；后者携带相同 `requestId` 及 `response` resolution。
- `index.server.ts` 的 `agent.permission.before` 将 request 交给 `AsyncQuestionTitles.remember`；`agent.permission.after` 用同一 agent id、request id 和 resolution 调用 `resolved`。
- `readConversation` 只把与该 session 已回答调用拼出的消息相匹配的 user message 转成问答；否则保留整条原始用户消息。quote 校验只检查回答文本，不把问题作为证据。
- 回归场景的原始多行题干参与完整消息匹配；映射后，`conversationForReview` 对 `ask` 执行空白折叠（`replace(/\s+/g, " ")`）。回答正文没有该折叠，内部空行和多行内容保留。当前测试期望多行题干在评审输入中折成单行。

## 未运行项

- 未在运行中的 Paseo 插件里触发真实 Codex 权限钩子或真实评审 session；本次只做目标提交测试与已安装 Paseo.app 源码核对。
- 未做 UI、手机或线上验证；本次验收范围未要求这些检查。
- 未运行 `npm audit`；`npm ci` 自身报告 4 个 moderate audit 项，未在本次任务中追查。

## 清理

- `/tmp/p0-asar-check` 已删除。
- `/tmp/p0-verify-389658f` 已通过 `git worktree remove --force` 移除，并经 `git worktree list` 确认不存在。
- 目标 worktree 中恢复后 `git diff --exit-code` 通过；未改实现文件。
