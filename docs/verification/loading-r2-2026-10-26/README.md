# Loading R2 独立验收报告

- 验收对象：提交 `16a117d`（分支 `feat/loading-r2`，PR #67）。`a0cbe68..16a117d` 同时包含实现 `a5a4d9f` 和文档提交。
- 验收人：`claude/claude-haiku-5-5`，未参与编写。
- 检查位置：临时 worktree（检出 16a117d，`node_modules` 软链到主仓库），检查结束后已删除。
- 未执行：install、reload、daemon 重启。界面截图和改后耗时（§4.3 后半、§4.4 截图）按要求记为 UNRUN。

## 结论

**暂不建议合并。** 没有发现 High 级别的回归，但验收未完成：§4.1 的比较不完整，§4.4 的界面检查未跑。

## 命令与结果

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | 0 | 通过 |
| 单元测试 | `npm test` | 0 | 130 个文件通过；1079 通过，1 跳过（1080） |
| 一致性（§4.1） | `FLOWLY_PARITY_BOARD=<副本> npx vitest run docs/verification/loading-r2-2026-10-26` | 0 | 1 通过；107 张卡、4552 条事件、118 个会话、67 条 attention |
| 变异检验（测试能否抓错） | 在临时 worktree 注入 4 处缺陷 | 见下 | 2 个抓到，2 个未抓到 |
| 零完整读取（§4.2，静态） | 搜索 client 中 `board.read` / `board.read-changed` | — | 客户端无调用；仅测试断言 |
| 界面、改后耗时（§4.3 后半、§4.4） | — | — | UNRUN（按要求） |

计数：通过 1081（typecheck 1、单元 1079、一致性 1），失败 0，跳过 1，UNRUN 为界面和耗时两项。

## 变异检验

对 `server/board-overview.ts` 逐个注入缺陷并运行一致性测试，每次之后还原：

| 缺陷 | 退出码 | 是否抓到 |
|---|---|---|
| M1：`turnEndedAt` 取最早而不是最晚 | 1 | 抓到 |
| M2：`hadTurnEnd` 改为“有 turn_started” | 0 | **未抓到**。原因：副本数据里没有“只有开始、没有结束”的会话（开始/结束的会话数为 0/0），这个缺陷在该数据上等价，测试没有覆盖这种情况 |
| M3：`questions` 恒为 0 | 0 | **未抓到**。测试没有比较 `questions` |
| M4：`silent` 恒为 false | 1 | 抓到（经由 attention 比较） |

## §4.1 比较范围（读测试得出）

§4.1 要求比较：问题数、workpad 信号、是否已收尾、Attention、是否有产物/外部条目、Next moves。

测试实际比较：`turnEndedAt`、`hadTurnEnd`、`finishedAt`（经 `olderFinished`）、attention 及 `silent`（经 attention）。

**未比较**：问题数（`questions`，M3 已证明）、workpad 信号（`workpad`）、是否已收尾（`wrapped`）、是否有产物/外部条目（`hasArtifacts`、`hasExternal`、`external`）、Next moves（`hasNextMoves`）。

这些字段在服务端和旧客户端调用的是同一个函数、同样的入参，所以大概率等价；但 §4.1 明确要求比较，现在没有证据。

## 发现

| # | 严重度 | 位置 | 场景 | 说明 |
|---|---|---|---|---|
| 1 | Medium | `docs/verification/loading-r2-2026-10-26/parity.test.ts` | 任何改动 `questions`、`workpad`、`wrapped`、产物/外部条目、`hasNextMoves` 的实现，测试都会通过 | §4.1 验收不完整。变异检验 M2、M3 未被抓到。补充这 5 项比较，并构造“只有开始、没有结束”的会话数据。 |
| 2 | Medium（待 UI 确认） | `client/drawer.tsx:186`，`client/query-activity.ts:11` | 宽屏打开卡片抽屉后选中某个会话（`selected` 为会话 id）。`pollBoard` 为 false，抽屉的卡片详情不再轮询；`board.tsx:475` 的详情观察者没有 `refetchInterval`。 | 旧版宽屏靠每 3 秒的完整看板轮询，抽屉的事件总会更新。现在会话预览（`SessionPreview`，接收 `events`）期间，卡片事件不刷新，直到退出会话。需要在界面上确认影响范围。 |
| 3 | Low | `client/board.tsx`（想 idea 链接的 effect） | 卡片刚在 3 秒内创建，之后点击 Next moves 上的“新卡片”，宽屏的 overview 仍是旧的。 | 旧代码在卡片找不到时会重读一次看板（`ideaRetried`）。新代码直接报“This idea is no longer open.”。删掉重试的理由没有写在规范里。窗口很小。 |
| 4 | Low | `client/native-actions.ts`（`freshCard`、`openIdea`），`client/board.tsx`（idea effect） | 手机网络抖动，读取 `cards.detail-changed` 或 `projects.ideas-changed` 失败。 | `.then(r => ..., () => [])` 把读取失败吞掉，变成“This idea is no longer open.”或“This card is unavailable.”。旧代码会抛出真实错误。 |
| 5 | Low（未测量） | `index.server.ts`（`connectors.connections`） | 连接列表每次调用都 `store.read()`（完整看板）。 | 客户端传输量没有增加，但服务端每次调用都读完整看板。规范说“不新增 SQL 查询”，这里是完整读取，没有测量耗时。 |
| 6 | Low | `client/overview-query.ts:39`，`:41` | 代码维护。 | 第 39 行的注释后面没有函数（`preferOverviewMetadata` 已删除），是孤立注释；第 41 行的注释也已过时。 |
| 7 | Low | `client/native-actions.test.ts:18` | 测试质量。 | “不得读完整看板”只靠 mock 抛错来断言，没有断言调用列表。目前能工作，因为 `openIdea` 的吞错会让测试失败，但不是显式断言。 |

## 已确认没问题的部分

- 一致性：`client/` 中已无 `board.read` / `board.read-changed` 的调用（`readBoard`、`readBoardChanged` 仅在 `shared/rpc.ts` 定义）。
- 会话链接（`resolveCardDetailLink`）：仍然校验卡片的 `workspaceId` 与链接一致，以及会话的 `workspaceId`。
- 连接数（`linkedCardCounts`）：与旧客户端规则一致（连接 id 相同，或 URL 能被识别，每张卡只计一次）。
- 外部条目（`externals`）：与旧 `externalUse` 的键（`pickKey(familyOf, key)`）一致，只统计本项目未归档的卡。
- 卡片 face 的外部条目文本（`faceKey` + “+n”）：与旧逻辑一致。
- 侧栏标志 `fullSidebar`：`cardDetail` 返回该卡全部 ideas（不分状态）与产物，与旧逻辑一致。

## 未覆盖

- §4.3 后半（改后耗时）与 §4.4（界面截图、抽屉/筛选/拖动/Ideas/Attention 的 UI 行为）按要求未跑。
- 发现 2 需要界面确认。
- 未在 daemon 上测量 `connectors.connections` 的服务端耗时（发现 5）。
