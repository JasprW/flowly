# Luna 验证：扩展 idea 工具 Astra 修复 — 2026-10-22

卡片：`5fcd00c8-2869-456a-96c8-3e1f4fa8b637`（扩展idea工具）
范围：独立验证 Astra 提出的 P2 回执与 P3 Activity 本地化修复；仅测试与证据所有权。
测试 session ID：`5affa8a0-d7fc-49c0-8842-d70c65bbbcba`（父会话根据创建记录补登记；测试者未读取 session context/credential 或推测 ID）。父会话已归档并删除该测试 session，native lookup 返回 not found，本卡会话列表也已确认无遗留。

## 输入与工作树

- `HEAD`: `fab80456ead870e7b7e6a493bae276ee878e34fd`
- 工作树：dirty=true（共享工作区；测试完成后、写本报告前核计 76 项既有变更）。
- 运行前后复核相关源文件 SHA-256 一致，见文末；因此检查结果对应同一组文件内容，HEAD 本身不代表这些未提交内容。
- 保留了首轮报告 [idea-tools-2026-10-22](idea-tools-2026-10-22.md) 和 Astra 审查 [idea-tools-2026-10-22-astra](idea-tools-2026-10-22-astra.md)，未覆盖或修改。

## 检查结果

| 检查 | 命令 / 方式 | 结果 |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS，exit 0；`tsc --noEmit` 无错误 |
| 全量测试 | `npm test` | PASS，exit 0；110 test files、938 tests passed。按要求未另跑 `server/agent-service.test.ts` 与 `shared/i18n.test.ts` 的定向命令 |
| 9 种语言翻译函数 | 用 Node 26.9.0 加载各 locale catalog，逐一注册后以 `withLocale(code, () => t(key))` 翻译两个 Activity key | PASS，18/18 翻译非空且不等于英文源键 |
| Activity 的 msg 标记 | 检查 `client/drawer.tsx` 中的 `activityText` 映射 | PASS，两个动作都由 `localizedLabels` 包裹，值为 `msg("Edited the idea")` 与 `msg("Removed the idea")` |
| 实际 MCP/CLI/UI 回归 | 本轮未调用 Flowly/Paseo 工具；由父会话负责真实 MCP 回归 | UNRUN |

翻译函数结果：

| locale | Edited the idea | Removed the idea |
|---|---|---|
| de | Hat die Idee bearbeitet | Hat die Idee entfernt |
| es | Editó la idea | Eliminó la idea |
| fr | A modifié l'idée | A supprimé l'idée |
| ja | アイデアを編集しました | アイデアを削除しました |
| ko | 아이디어를 수정했습니다 | 아이디어를 삭제했습니다 |
| pt-BR | Editou a ideia | Removeu a ideia |
| ru | Изменил(а) идею | Удалил(а) идею |
| zh-CN | 编辑了想法 | 移除了想法 |
| zh-TW | 編輯了想法 | 移除了想法 |

## 独立审查

### P2：提案删除后的精确重放

- `shared/model.ts` 的 `receiptSchema.ideaId` 为可选字段，兼容旧回执。
- `server/agent-service.ts` 在写回执时把生成的 `ideaId` 与事件、回执一起持久化；精确重放优先返回 `existing.ideaId`，旧数据仍可由提案事件反查，update/remove 则可从请求 ID 回退。
- 新增回归“proposal replay keeps the idea ID after removal and service reload without resurrecting it”先提案、删除、重建服务后重放原请求；断言返回同一 `ideaId` 与回执、ideas 仍为空、revision 不变、重放前后的 board 文件字节完全一致。该覆盖直接对应 Astra 指出的生命周期缺口，也验证重放不复活实体、不写文件。
- 旧回执回归删除持久化 ID 后重建服务并重放；idea 仍存在时能从事件反查 ID，且文件不变。删除后已无法从旧回执恢复的实体 ID 不做迁移，与 `docs/IDEAS-SPEC.md` 第 57 行说明一致。

### P3：Activity 本地化

- `client/drawer.tsx` 的 `activityText` 增加 `idea_edited` 与 `idea_removed`，各自使用 `msg()` 并在渲染时经 `localizedLabels` 翻译。
- 上述九种非英文语言的运行时翻译都非空且与英文 key 不同；规格第 58 行和验收第 247 行与实现相符。

## 汇总

- P2：PASS
- P3：PASS
- Typecheck / 全量单测 / locale 翻译：PASS
- 真实运行时 MCP、CLI、UI：UNRUN（本轮明确不操作；不创建 fixture 或 Paseo 资源、不读 session context/credential）
- 本轮发现：没有剩余缺陷。

## 相关文件 SHA-256

这些哈希在 typecheck 和全量测试前后复核一致。

```text
5980dfe95d9979541b2e1e18fb6d251e40777bb76dfc6d74a79a2027910f5b2c  shared/model.ts
7cb206219e46dec073c7c1b7dae960cd543a1a93a86dc13c3eedb63463daab4c  server/agent-service.ts
058d603f4252c9f7827d1de370619c19da56e513577f50338c3c1efd9d755b98  server/agent-service.test.ts
b4b67e32dd68b8fb3ece09b1e93c966c008b60655e4eadb056bf3875be312b96  client/drawer.tsx
9ec15a2b7eb85bb6da83bb5d86312f8943d821ba61a8d2c3e9c24277d8fbe7de  shared/i18n/de.ts
81f2998244835b6d23e7276db760ce8e96f677d2c011a240748591600bec0bb2  shared/i18n/es.ts
bdfc34094443ba4dd823064a59a11f30c67fc3804acb0fe9651b6099187c9bf7  shared/i18n/fr.ts
cdaa2e63648a60e1e28c701e6a5280c587b971f72c0d120939dc31538947f350  shared/i18n/ja.ts
e852e6d85763765e6ae66b878a8bd5fdb554a5b20c682fd84cc0df0ffecbd932  shared/i18n/ko.ts
9c8d95861173a7e0d9716b7c11a19b53f760bf8053b7d4f68a6e84dcb0d7be23  shared/i18n/pt-BR.ts
95c0d790156ea4126c5866e7dcf2a88ec0ec4df3b51ea15f666e0336d2106ed1  shared/i18n/ru.ts
9fb29895f626089cc8e39cfe0d6c668a65d89b629103cb1e36f7328e84b4079f  shared/i18n/zh-CN.ts
dcd2e1d85bccdaaaf8ca158707b50781217914e3231d1c8518be8c0d6173b6ed  shared/i18n/zh-TW.ts
1ba8ced4031945ad8e01a86ae7f56a682572885e8ef3b123ddf8ef7a161c0195  docs/IDEAS-SPEC.md
```
