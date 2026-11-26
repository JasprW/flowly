# Auto review P0 独立验证

- 提交：`40168cc8e8378855be54245aa9f287b121a1ee9d`（`fix/auto-review-p0`）
- 验证目录：`/tmp/p0-verify-40168cc`，detached worktree
- 结论：指定构建与单测通过；Codex 异步问答回归对负向变异敏感。Paseo ASAR 的完整解包命令返回非零，但目标源码文件已解出并完成核对。

## 构建与全量测试

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `git worktree add --detach /tmp/p0-verify-40168cc 40168cc` | 0 | 临时 worktree 创建成功 |
| `npm ci` | 0 | 安装成功；npm 报告 4 个 moderate audit advisories |
| `npm run typecheck` | 0 | 通过 |
| `npm test` | 0 | 173 个测试文件通过、1 个跳过；1606 个用例通过、6 个跳过 |

## 指定单测

每条 auto-review 单测都单独用 `npx vitest run server/auto-review.test.ts -t '<标题>'` 执行。

| 单测 | 退出码 | 结果 |
| --- | ---: | --- |
| `a disputed goal is still judged on every later delivery` | 0 | 1 通过，60 跳过 |
| `the review reads answers given in question tools as what the user said`（AskUserQuestion） | 0 | 1 通过，60 跳过 |
| `in a shared directory commands run and show their result but never send the card back` | 0 | 1 通过，60 跳过 |
| `a Codex answers message is split by the questions as asked in the same session` | 0 | 1 通过，60 跳过 |
| `npx vitest run server/async-questions.test.ts` | 0 | 2 通过 |
| `npx vitest run shared/memory.test.ts -t 'splitCodexAnswers'` | 0 | 2 通过，21 跳过 |

断言强度：争议 goal 用例核对后续交付仍给 goal 新判定、评审输入包含旧 finding 和理由、再次失败时争议结束，之后仍继续判定。AskUserQuestion 用例核对问答进入评审输入与时间顺序，并用回答作为引用证据。共享目录用例核对失败命令为 `gating: false`、卡仍留在 In review、不会发送返工消息，且评审 session 仍运行。Codex 回归用例直接贯穿 `readConversation` 与 quote 检查，覆盖答案含空行、多行问题、问题文本无证据、答案行有证据、无原问题时保留整条消息。对这些单测的目标行为，断言没有明显过弱之处；它们使用模拟 Paseo API、runner 和 LLM，不等于真实 daemon 或模型验收。

## 行为与 Paseo 源码核对

- `index.server.ts` 的 `agent.permission.before` 钩子调用 `asyncQuestions.remember(event.agent.id, event.request)`。`AsyncQuestionTitles` 仅在内存中按 session 和 call id 保存问题标题；`readConversation` 收集消息之前出现的 async-question call id，优先尝试对应标题，再尝试同 session 的其他标题。标题不匹配或没有原问题时，回答消息作为普通用户消息完整保留。
- 负向变异验证：临时将 `server/auto-review.ts` 的 `? asyncAnswers(item.text, known, seen) : null;` 改为 `? null : null;`，单独重跑 Codex 回归用例，退出码 1；它在答案被切分的第一条断言处失败，实际收到完整原消息。恢复原行后 `git diff --exit-code` 退出码 0，临时 worktree 无源码差异。
- 用指定命令尝试解包 `/Applications/Paseo.app/Contents/Resources/app.asar`，命令退出码 1：ASAR 中若干 `app.asar.unpacked` 外部文件缺失。尽管如此，目标 `node_modules/@getpaseo/server/dist/server/server/agent/providers/codex/async-questions.js` 已出现在解包目录并被读取。`toPermission` 将 id 设为 `permission-${itemId}`，将 `item.questions[].title` 映射到 `input.questions[].question`；`prepareResponse` 生成 `Answers to your questions:\n\n`，随后按每题 `${title}\n${answer}` 并用空行连接。该形状与 Flowly 的切分逻辑一致。
- 对“答案带空行”和“问题为多行”的用例，引用答案中的行或片段均得到 `failed` 并保留 `quote`；引用多行问题中的任一行得到 `na` / `no evidence`。未有原问题时，整条答案消息保留，消息中的用户文字仍可作为引用证据。
- 对照本提交中的 `GUARDRAILS-SPEC.md`、`AUTO-REVIEW-SPEC.md` 与实现，未发现本次范围内的文档/代码不一致。

失败输出摘录：

```text
ASAR extract: Error: ENOENT: no such file or directory, open '...app.asar.unpacked/...'
Mutation: AssertionError: expected [ Array(1) ] to deeply equal [ { …(2) } ]
```

## 未运行

真实 Paseo daemon 的 permission hook 端到端触发、真实模型的评审/引用判定、UI 或手机验收未运行。本验证不据此声称这些路径通过。

## 清理

临时 ASAR 目录已删除。`git worktree remove --force /tmp/p0-verify-40168cc` 退出码 0；随后 `git worktree list` 中已无该路径。
