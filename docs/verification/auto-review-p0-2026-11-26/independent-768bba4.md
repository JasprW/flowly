# 768bba4 独立验证

- 提交：`768bba4b0b1148306e3b0f66625eae09edc6809b`（`fix/auto-review-p0`）
- 模型：Codex（GPT-6）
- 验证副本：`/tmp/flowly-verify-768bba4`，detached worktree；`npm ci` 安装 369 个包。检查与审阅完成后已移除；`git worktree list` 不再包含该路径。
- 验证副本未改源码或测试；`git diff --exit-code` 返回 0。没有添加临时测试。

## 命令与结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm ci` | 0 | 安装完成，369 个包 |
| `npm run typecheck` | 0 | PASS |
| `npm test` | 0 | 173/174 文件通过、1 跳过；1608/1614 项通过、6 跳过；失败 0 |
| `npx vitest run server/auto-review.test.ts server/async-questions.test.ts` | 0 | 2/2 文件通过；67/67 项通过 |
| `git diff --exit-code`（验证副本） | 0 | 无源码或测试差异 |
| `git worktree remove --force /tmp/flowly-verify-768bba4` | 0 | 已移除 |
| `git worktree list` 与路径存在性检查 | 0 | 列表无该 worktree，临时路径不存在 |

## 失败输出摘录

无；指定检查全部退出码为 0。

## 确认无误

- 提问 hook 先验证并记住 Codex 异步问题，再以 `void` 启动尾部 1 条 timeline 的 projected 读取，不等待该读取；成功后把 epoch 交给 `askedIn`，失败只记日志（`index.server.ts:807-819`）。
- `askedIn` 只会更新仍在 pending 的同一 session/call；已有 epoch 时不覆盖，且用读取完成时的时钟记录 `at`（`server/async-questions.ts:73-75`）。`resolved` 先从 pending 移除该 call，再把 `asked` 复制到 answered 记录；拒绝或缺少任一答案的请求进入 closed（同文件 82-100）。因此读取完成于 resolved 之后时不能补写该回答的 epoch。
- `sentFor` 同时要求消息时间可解析、与获答时间相差不超过 60 秒、评审页 epoch 等于提问时 epoch，以及提问时的读取完成时间早于该条消息时间（`server/auto-review.ts:410-412`）。
- `answeredCalls` 还要求消息逐字匹配、同 call id 的首次工具调用在消息之前、相同文本的调用与消息数量相等且按回答顺序配对、之前没有钩子未知结果的 call。任一同文本配对的 `sentFor` 条件失败时，该文本不进入配对结果，消息作为用户原文保留（同文件 451-470）。
- 部分读取时，只有尾页存在可识别的候选答案消息才回翻；循环以 `hasOlder !== false` 继续，直到确认到开头。没有 cursor、读取失败、reset、stale cursor、空页或 epoch 与初始页不同，都会使历史读取失败并跳过配对。初始页 epoch 传给 `answeredCalls`，每一旧页都与初始 epoch 比较（同文件 368-369、415-427）。
- 现有测试覆盖首次 epoch 读取、回答后迟到的读取不写入、不同 epoch、读取完成晚于消息、60 秒边界、精确文本，以及回翻时 epoch 变化（`server/async-questions.test.ts:37-50`；`server/auto-review.test.ts:1450-1478、1585-1596`）。这与 AUTO-REVIEW-SPEC §4.2 条件①–⑥一致。
- 按要求，规格明确接受的时序不作为缺陷：提问时启动的读取在用户回答并回退后才完成，随后用户重发相同文字。该情形记录在 AUTO-REVIEW-SPEC §4.2 的“不防的情况”及 PROGRESS 2026-11-27 决定中，本轮没有重复报为问题。

## 问题（按严重度）

无 P1、P2 或 P3 的运行时配对问题。未找到其他可复现的事件顺序，会把非问题工具消息配成问答，或把真实回答错误地整条保留。

## 注释差异

- `server/auto-review.test.ts:1416` 的测试注释仍称测试 hook 在回答后读取 epoch；当前 helper 实际在提问时记录 epoch（`server/auto-review.test.ts:1317-1328`），与实现和 AUTO-REVIEW-SPEC §4.2 相符。这只是过时注释，不影响测试行为或运行时结论。

## 未运行

- Paseo 实际 hook / timeline 的延迟读取集成验证，包含并发的用户回答、回退和重发时序。
- 插件重载、UI、桌面宿主及手机验收。
