# 3e4c300 独立验证

- 提交：`3e4c30021823659edfae8bc9c9aae01508dc5273`（`fix/auto-review-p0`）
- 模型：Codex（GPT-6）
- 验证副本：`/tmp/flowly-verify-3e4c300`，detached worktree；依赖用 `npm ci` 安装。验证期间的临时探针已删除，源码已恢复。

## 命令与结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm ci` | 0 | 安装完成，369 个包 |
| `npm run typecheck` | 0 | PASS |
| `npm test` | 0 | 173/174 文件通过、1 跳过；1608/1614 项通过、6 跳过；失败 0 |
| `npx vitest run server/auto-review.test.ts server/async-questions.test.ts` | 0 | 2/2 文件通过；67/67 项通过 |
| 反事实：删掉 `answeredCalls` 的未知提问与提问晚于消息两项检查，再跑目标测试 | 1（预期） | 1 项失败、62 项跳过；目标测试在 `server/auto-review.test.ts:1512` 把旧消息误读成 B 的问答。恢复后 `git diff --exit-code -- server/auto-review.ts` 为 0 |
| 临时反例：`npx vitest run server/auto-review-counterexample.test.ts` | 1（预期） | 1 文件、2 项断言失败：外层空白仍被配对；`hasOlder` 缺失时没有实际翻页 |
| 临时反例：`npx vitest run server/auto-review-counterexample-2.test.ts` | 1（预期） | 1 文件、2 项断言失败：不同 `turnId` 的同文手动消息仍被配对；answered 与 closed 合计超过每 session 20 条仍保留最旧 answered |

未运行：live Paseo hook、插件重载、UI 与手机验收；这些不在本轮指定检查内。

## 失败输出摘录（仅预期反例/反事实）

- `AssertionError: expected [ { ask: 'Which label?', … } ] to deeply equal [ Array(1) ]`；实际收到 `{ ask: "Which label?", answer: "Rerun" }`。
- `AssertionError: expected true to be false`；实际为 `true`，旧 answered call 在 20 条后续 closed call 后仍被 `known()` 保留。

## 确认无误

- §4.2 条件②：只统计 timeline 中同 call id 的第一次工具调用，并要求它在消息之前；回退后不在 timeline 的已回答调用不入候选。条件③：更早且 `known()` 为 false 的调用阻断整种文本；被拒绝或未答全的请求进 `closed`，不会被当成未知。条件④：同文消息数与仍在 timeline 的已回答调用数相等才按顺序配对。反事实测试证实删掉未知提问检查会误配。
- 翻页只在尾页存在可配对回答文本且 `hasOlder !== false` 时启动。使用 `direction: "before"`、前页 `startCursor`、`limit: 200` 和 `projection: "projected"`，与 `server/session-tail.ts` 的参数用法一致。旧页遇到 epoch 不同、reset、staleCursor、空页、无 cursor、读取错误或超过上限均不配对。当前协议 schema 将 `epoch`、`hasOlder`、`reset`、`staleCursor` 设为必填，`startCursor` 为可空游标；见 `node_modules/@getpaseo/protocol/dist/messages.d.ts:64202-64227`。
- 核对本机 Paseo 源码：异步问答会以普通文本提示回到 Codex turn；问答工具调用可能在后续 timeline 更新中再次出现；timeline projection 只在同一 turn 内合并重复 call id。代码按第一次出现处理，与此行为相符。

## 问题（按严重度）

- **P2：消息不是逐字相同时仍会配对。** `server/auto-review.ts:394-397` 先对 timeline 文本 `.trim()` 再和生成消息比较，违反 §4.2 的逐字匹配。时间线：`tool_call(B)` 后是 `" ${generatedMessage}\n"`。探针期望整条用户消息保留，实际得到 `{ ask: "Which label?", answer: "Rerun" }`；消息里的问题标题因此不再作为用户原话。
- **P2：回退后用户手动重发同文可冒充已删除的回答。** `server/auto-review.ts:365,431-449` 未将 entry 的 `turnId` 纳入判断，只看相同文本、数量和调用先后。时间线：已回答的 `tool_call(A, turn-1)` 留存，回退删掉原回答；用户在 `turn-2` 手动发送完全相同的 `generatedMessage`。探针带不同 `turnId`，结果仍被拆成 A 的问答。Paseo 投影提供可选 `turnId`，但本逻辑未检查；这不满足“回退移除了回答却留下提问时整条保留”的保证。
- **P3：20 条上限按状态分别计算。** `server/async-questions.ts:35-39,95-96` 给 pending、answered、closed 各自建表并各自限 20；不限制每 session 的总调用数。时间线/状态：1 条 answered 后再有 20 条 closed，`session().known(old)` 仍为 true，旧答案仍在 `answered`。临时断言期望最旧项被淘汰但实际未淘汰；与 §4.2“每个 session 最近 20 个”不一致。不同状态表的 session 上限也独立计算。
- **P3（仅缺字段响应）：缺失 `hasOlder` 时触发了外层条件，却不会翻页。** `server/auto-review.ts:368,404-405`：初始页 `hasOlder` 缺失会调用 `olderEntries`，但 `while (last.hasOlder)` 立即退出，尾页内的已知调用因此可被配给消息，而更早的未知调用未检查。临时时间线 `[未知 A（页外）, 已知 B, generatedMessage]` 被误配。当前协议把 `hasOlder` 定义为必填，所以这是协议外响应的防御性不一致；若按 spec 的“缺失也翻页”，此处不一致。

## 建议

- `pairingHistoryLimit = 2000` 限制的是尾部 200 条之外的回翻条目；单次配对读取合计最多约 2200 条（200 + 2000）。§4.2 写“往前翻页……最多 2000 条”，可理解为回翻上限，代码与 `docs/PROGRESS.md` 的描述一致；建议明确这是“额外回翻 2000 条”还是“合计 2000 条”。
- 将严格文本相等与 turn 来源区别纳入验收；若允许 `hasOlder` 缺失，再让翻页循环和入口判断统一按 `!== false` 处理。未修改实现或规格。
