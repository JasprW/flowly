# Fable：Benchmark draft revision 2 复审

2026-10-22。会话 `b33918e2-b3ca-490e-b3c1-689cf5fecbba`，实际 `claude-fable-5-1` / `high` / `bypassPermissions`。本轮只复审，不实现、不运行 benchmark；设计原文保持不变。

审查对象：[冻结的 r2 原文](rereviewed-draft-r2.md)，SHA-256 `f2e1465db692eb029487763a54fff30119cff6b8ddf68140437f0cabe88d7d83`。冻结副本的相对来源链接按原始 `docs/CONSTRAINT-BENCHMARK-SPEC.md` 所在目录解析；它只用作字节不变的审查证据。[会话记录](rereview-session.json)。以下仅保存最终公开答复。

## Fable 原始最终答复

**Verdict：可进入 grader + B01 quick 实施。** 没有设计级阻塞；前轮五个 quick 必要问题已在 r2 中关闭。但有两处采证口径是句子级空缺，若不在写 grade.mjs 前补上，会在一条模型路径上系统性产生 UNKNOWN → 永远退出 2（假“无法验收”）。建议作为实施前的文字修订，不需再一轮设计复审。

## 仍成立的问题

**1. §6 第 123/130 行：回执来源写成“board”，但 `board.read` 不含回执。**
`board.read` 输出是 `boardSchema`（shared/rpc.ts:88-90），`agentReceipts` 只在 `storageSchema`（shared/model.ts:398/449）。反例：实现者按“board 用于即时回执快照”调 RPC，拿不到 `artifactIds: []` 与字段缺失的区分，C04/C05 的 outputs 子项每回合 UNKNOWN，两模型都无法 PASS。最小修订：写明回执只读来源是 daemon 数据目录的 `board.json`（7 天 `expiresAt`，agent-service.ts:607 会清理）或捕获到的工具结果；删卡后 `removed/task-<id>-*.json` 还保留一份（store.ts:466-483），可作冻结失败时的兜底。`board.read` 只用于实体/事件/workpad。

**2. §4 C05 与 §6 nextMoves 行：“随该交付调用携带”子项没说归哪张表。**
skill 明确允许交付未带时在同回合用 `flowly_suggest_next_moves` 补（SKILL.md:29），而 §5.3 规定必需项 UNKNOWN 即不得最终 PASS。反例：Codex 在 exec 内用 CLI 交付、携带与否无法关联 → 若“携带”算最终表必需项，行为完全正确也退出 2。最小修订：“携带”只进主动表；最终表判“本回合该 agent 有 next_moves 事件”，顺序口径与 `needsNextMoves`（shared/next-moves.ts:36-44，turn_started 之后）一致。
附带、不改决定 4：关联其实常可做到。独立 `next_moves` 写入必留一条 `eventId` 指向该 moves 事件的回执（agent-service.ts:829-838、884-891），而携带的 moves 事件（第 858 行）没有自己的回执。读 `board.json` 后，“无回执引用且紧随交付事件”的 next_moves 事件即为携带；只有读不到回执时才 UNKNOWN。

## 非阻塞实现注意

- 预期 stale：freshness 只做 sha 前缀比较，不看 dirty（shared/workpad.ts:24-31），所以 T1 在 X(dirty) 的检查到 T3 HEAD=Y 必为 stale；fingerprint 含 pad revision 与 head（agent-service.ts:649-656，delivery-gate.ts），拒绝→补 workpad→再拒→ack 链已被产品行为证实。要让“输入完全相同”可证，cases.json 须声明检查的输入闭包（读取文件、脚本哈希、工具链），否则只能 UNKNOWN。
- 事件：board 每卡只留 100 条（store.ts:589-593）；flow 追加在提交后 fire-and-forget（store.ts:137-139）；`removeTask` 把该卡行移到 `removed/` 且 `forgotten` 会丢弃迟到追加（flow-log.ts:68、93-104）。冻结顺序应为：回合结束后稍等、读 `board.json` 与 flow 文件、再 `tasks.delete`。
- 清理：`tasks.delete-check` 给出 git.uncommitted/unpushed；T3 失败时 worktree 有未提交改动，归档需在冻结后有意确认；分支名取自创建后的 workspace 实体并写入 ownership.json。
- 预算：§8 把“停滞到预算耗尽”记 FAIL，T3 含提交、推送、建 PR、合入、重跑检查和可能的两次拒绝，10 分钟可能偏紧，按上轮真实耗时设定，避免假 FAIL。

## 前轮意见状态

| 前轮 | 状态 |
| --- | --- |
| 1 预期拒绝/两表 | 关闭（§5.1、§5.2） |
| 2 T1 依赖吞 T3 | 关闭（§3 事实前置，FAIL 不被 UNRUN 覆盖） |
| 3 T2 免评 test | 按用户决定保留现行 skill，§4 C02 与 SKILL.md:14/25 一致，关闭 |
| 4 证据分工 | 基本关闭，残留即上文 1、2 |
| 5 共享 Git/清理 | 关闭（§7） |
| 6–9 standard 预置/接入/拒绝链/Done | 后置，§9 文字已改为可实施机制，关闭 |
| 7 marker 当顺序证据 | 按决定不采纳，§4/§6 已明示，关闭 |

## 实际核对与限制

读取：CONSTRAINT-BENCHMARK-SPEC 全文（SHA 与冻结副本一致）、fable-review.md、turn-checklist.ts、SKILL.md；agent-service.ts 的 reminders/gate/outputs/recordMoves/receipt 段、delivery-gate.ts、reminders.ts、next-moves.ts、workpad.ts freshness、store.ts 的 event/commit/删除备份、flow-log.ts、insights.ts 的 offered、rpc.ts 的 board.read/tasks.delete/delete-check/workpads。
未验证：Paseo 原生 timeline 中 tool_call/tool_result 参数与结果文本的完整程度；runner 进程删 ref 权限；daemon 运行身份的可取来源；`taskDeletion` 输入是否要求显式确认警告。本轮未运行模型、未创建资源、未改任何文件。设计可实施不等于 benchmark 已 PASS。

## 主会话核对

结论可采纳：前轮主要设计问题已关闭，可进入 grader+B01 quick 的实施准备；实现前仍要把这两处文字补清。不是 benchmark 运行 PASS，也不是已经实现。

1. **回执来源确认。** shared/rpc.ts 的 board.read 返回 boardSchema，不含 agentReceipts；shared/model.ts 的 storageSchema 才加该字段。采证可用被测工具成功结果，或在 daemon 主机只读本次 ID 对应的 board.json 存储字段。server/store.ts 的删卡备份包含该卡回执，可作兜底，但不能因此省略清理前冻结。只投影必要公共字段，不能把原存储、私有 key/payloadHash/凭据整体导出，更不允许直接写 board.json。
2. **两张表的 nextMoves 确认。** skills/flowly/SKILL.md 明确允许遗漏后在同回合用 suggest_next_moves 补齐；shared/next-moves.ts 的 needsNextMoves 按同卡/同 agent 在本轮 turn_started 后是否有 next_moves_suggested 判断，空声明也有效。因此“随交付携带”进主动表，最终表看本轮内的有效声明，合法补齐不应因调用关联未知而永远无法验收。调用关联仍保留 UNKNOWN，不能改写成主动 PASS。
3. **携带与独立调用的推导需完整性条件。** 独立 next_moves 的确有自己的 receipt.eventId，携带事件没有独立回执。只有本次回执集和事件顺序已确认完整、无歧义时，才可用这种差异推导；不能因回执过期/截断或仅“时间相邻”就判定携带。
4. **实现注意事项仍未实测。** 核对输入闭包、flow 异步落盘与删卡先后、tasks.delete-check 的未提交/未推送警告以及预算取值。应核对证据完整性，而不是认为固定等待几秒即可保证 flow 已落盘。耗尽预算时区分模型未履行义务与外部环境等待，保留全部结果，不事后放宽分母。

本轮只登记复审报告与审查快照，不修改 spec 的两处文字、不构建、不 reload、不创建 fixture/PR，不重跑产品测试。Fable 会话完成后归档；元数据记录实际模型、权限和时间。下一步为补充两处说明后再按用户指令决定实施。

