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

## 复验（24e417c）

- 验收对象：提交 `24e417c`（fix: R2 review findings），上一次验收对象为 `16a117d`。验收人同上，未参与编写。
- 检查位置：临时 worktree（检出 24e417c，`node_modules` 软链到主仓库），结束后已删除。数据为只读副本，未写 `~/.paseo`，未 install、reload 插件，未改实现文件，未 commit。

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | 0 | 通过 |
| 单元测试 | `npm test` | 0 | 130 个文件通过；1081 通过，1 跳过（1082） |
| 一致性（§4.1） | `FLOWLY_PARITY_BOARD=<副本> npx vitest run docs/verification/loading-r2-2026-10-26` | 0 | 1 通过；107 张卡、4552 条事件、118 个会话、67 条 attention；各项出现次数：问题数 1、workpad 65、收尾 91、外部条目 30、Next moves 40、open ideas 18 |
| 注入检验 | 在临时 worktree 注入 9 处缺陷 | 见下 | 8 个抓到，1 个未抓到 |

计数：通过 1 + 1081 + 1 = 1083，失败 0，跳过 1，UNRUN 为界面和耗时两项（同上次）。

### 注入检验（`server/board-overview.ts`，每次还原）

| 缺陷 | 退出码 | 是否抓到 |
|---|---|---|
| turnEndedAt 取最早 | 1 | 抓到 |
| hadTurnEnd 改为“有 turn_started” | 0 | **未抓到** |
| questions 恒为 0 | 1 | 抓到（修复生效） |
| silent 恒为 false | 1 | 抓到 |
| workpad 恒为 null | 1 | 抓到 |
| wrapped 恒为 false | 1 | 抓到 |
| hasNextMoves 恒为 false | 1 | 抓到 |
| hasArtifacts 恒为 false | 1 | 抓到 |
| openIdeas 恒为 0 | 1 | 抓到 |

`hadTurnEnd` 仍未被抓到。副本数据中没有“只有开始、没有结束”的会话，而 `parity.test.ts` 没有构造这类数据。上次报告的这一项缺口仍然存在。

### 逐条核对修复

- **#1 一致性覆盖**：成立。测试逐卡比较问题数、workpad、收尾、外部条目、Next moves、open ideas，且要求每项在真实数据里至少出现一次。但 `hadTurnEnd` 的构造数据没有补上。
- **#2 宽屏抽屉轮询**：成立。`drawerNeedsBoard(compact, active, selected)` 在宽屏下只要抽屉可见就轮询（`client/query-activity.ts:11`），紧凑布局行为不变；`query-activity.test.ts` 覆盖了两种布局。界面效果未验证（UNRUN）。
- **#3 idea 链接不依赖总览**：成立。`client/board.tsx` 改用 idea 自身的 `projectId` 设置项目；idea 已删除时 `store.ts:369` 会同时删除该卡的 ideas，因此去掉卡片存在性检查不会打开孤儿 idea。
- **#4 读取失败如实报错**：成立。`gone(e, reason)` 只把“卡/项目不存在”当作不存在（`shared/card-detail.ts`），其它错误原样抛出（`client/native-actions.ts`、`client/board.tsx`）。`native-actions.test.ts` 新增离线用例覆盖。
- **#6 过时注释与完整看板分支**：成立。`client/overview-query.ts` 的两处孤立或过时注释已删除，`projectOpenIdeaCount` 只接收总览。
- **#7 测试显式断言**：成立。新增精确的 RPC 调用列表断言，以及“卡/idea 已不存在”与“读取失败”两类用例。

### 发现 #5 的更正

上次报告写“connectors.connections 只在打开连接编辑器时调用”，这一点不准确。实际调用方有 4 处，都经由 `useConnections`（`client/connectors.tsx:40`，staleTime 60 秒）：`client/connectors.tsx:452`、`client/connectors.tsx:519`（连接编辑器）、`client/task-artifacts.tsx:40`。`store.read()` 在 SQLite 模式下是 `structuredClone` 整个内存中的看板（`server/sqlite-storage.ts:216`），开销随看板大小增长；“约 6 ms”未测量。仍记为 Low，但“只在编辑器打开时调用”的说法应当修正。

### 新问题

未发现新的回归。

### 结论

可以合并的前提：`hadTurnEnd` 的缺口补上（构造一个只有开始、没有结束的会话），并完成 §4.4 界面检查。当前 24e417c 上代码层面的修复均成立，typecheck 与单元测试全部通过。
