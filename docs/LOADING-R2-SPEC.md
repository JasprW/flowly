# 加载优化 R2：常规路径不再读完整看板（最小方案）

状态：**已确认，实现中**（2026-10-26 用户确认方案，不加切回开关）。前置：[SQLite 存储](SQLITE-STORAGE-SPEC.md)已在维护者本机运行；本方案只改读取，不改写入路径和存储格式。

## 1. 现在慢在哪（真实数据实测）

数据：维护者看板，107 张卡、4552 条事件。在 Paseo Helper 里测量各读取接口第一次返回的大小：

| 接口 | 大小 | 谁在用 |
|---|---|---|
| `board.read-changed`（完整看板） | **2,648 KB**，其中事件 1,788 KB、workpad 347 KB、artifact 246 KB | 宽屏看板（每 3 秒按 etag 轮询）；紧凑布局下打开新建卡片、项目表单、删卡、移除项目、收尾提示、idea 链接、会话内嵌卡片时；新建卡片表单；连接编辑器 |
| `board.overview-changed`（总览） | 179 KB | 紧凑布局的看板 |
| `cards.detail-changed`（单卡） | 中位 18 KB，p90 62 KB，最大 111 KB | 紧凑布局的卡片详情 |
| `projects.card-index-changed` | 最大 26 KB | 紧凑布局的关联卡选择 |

此前手机上实测过，第一次读完整看板仅解码就要约 2.5 秒（[PERFORMANCE-SPEC](PERFORMANCE-SPEC.md)）。紧凑布局的日常浏览已经改用总览和单卡详情（[NATIVE-OVERVIEW-SPEC](NATIVE-OVERVIEW-SPEC.md)、[CARD-QUERY-SLIM-SPEC](CARD-QUERY-SLIM-SPEC.md)）。剩下仍读完整看板的是**宽屏**和**几个按钮打开的功能**。

服务端从 SQLite 缓存组出总览只要约 11 ms（[read-bench](verification/sqlite-min-2026-10-26/read-bench-result.json)），所以本方案**不新增 SQL 查询**：慢的是传过去的数据量和客户端的解码，不在服务端。

## 2. 改动

**A. 宽屏改用总览加单卡详情。** `client/board.tsx` 里几乎每个派生值都已经有两套写法：一套用总览的 facts（紧凑布局已在手机上用过），一套从完整看板的事件现算。宽屏改走总览这一套：
- 看板数据源：所有布局都用总览；客户端不再调用 `board.read-changed`。总览到达前（冷启动直达某张卡），卡面只显示单卡详情给出的元数据，不现算 facts。
- 抽屉：事件、产物、workpad、sidebar 取自单卡详情（现在宽屏是从完整看板里筛出来的）。
- 项目 Ideas 列表：改用 `projects.ideas-changed`。Attention、筛选、角标改用总览 facts。
- 轮询：宽屏改为每 3 秒按 etag 轮询总览，不再轮询完整看板。

**B. 按钮打开的功能不再读完整看板。**
- 新建/编辑卡片表单：卡片标题、标签、已绑定的 workspace 改从项目卡片索引读；外部条目已被哪张卡引用，由索引新增的 `externals: [{ provider, key, taskId }]` 给出（只加字段，不改已有字段）。
- 连接编辑器的“有多少卡在用这个连接”：`connectors.connections` 的返回新增 `linkedCards: { [connectionId]: 卡片数 }`，服务端按原客户端规则计算（连接 id 相同，或该连接能识别其 URL；一张卡只算一次）。连接是全局的，所以不放进项目索引。
- 删卡、移除项目、收尾提示：用已有的 `*-check` RPC 和单卡详情。
- idea 链接（Next moves 卡上的“新卡片”）新增可选的 `projectId`，看板只读该项目的 ideas；没有 `projectId` 的旧链接逐个项目查找，找不到就提示 idea 已关闭。
- Next moves 卡上的“移到 Done”只读这张卡的详情；Ideas 弹窗的继续/忽略只读所属项目的 ideas。
- 会话内嵌卡片：用已有的单卡 RPC（`sessions.card-board`）。

**C. 不留后备开关。** 客户端里从完整看板现算 facts 的那套写法删除；服务端的 `board.read-changed` 保留（旧版客户端仍可能调用），一致性校验用到的旧算法（`olderFinished`、`latestTurnEnds`、`sessionAttentionSummary`、`allAttentionFromSources`）也暂留，下一版删。

**不做**：不改写入、不改存储格式、不新增 SQL 查询、不分页或裁剪事件（会改变显示内容）、不改客户端 bundle 的加载方式。bundle 是手机冷启动的大头，属于另一项工作，见 [CLIENT-PAYLOAD-POC-SPEC](CLIENT-PAYLOAD-POC-SPEC.md)。

## 3. 预期效果（待验收实测）

| 场景 | 现在 | 改后 |
|---|---|---|
| 宽屏首次打开看板 | 2,648 KB | 约 180 KB，打开卡片时再加约 18 KB |
| 平板或手机横屏（宽屏） | 解码约 2.5 秒（按此前手机测量推算） | 约 0.2–0.3 秒（按数据量比例推算） |
| 手机上点“新建卡片”、删卡、收尾 | 先读 2,648 KB | 索引最多 26 KB，加单卡详情 |
| 手机竖屏日常浏览 | 已用总览 | **基本不变**，剩余耗时主要在渲染和 bundle 加载 |
| 桌面 | 首读要解码约 2.6 MB | 待实测；本机较快，收益可能只有一两百毫秒 |

## 4. 验收

1. **一致性**：用维护者真实数据的副本（本地、跑完删除），对每张卡比较两套算法给出的 facts（问题数、workpad 信号、是否已收尾、Attention、是否有产物/外部条目、Next moves），结果必须完全相同。
2. **零完整读取**：宽屏常规操作（打开看板、切换项目、打开和关闭卡片、等待 3 次轮询、拖动卡片），以及手机上打开新建卡片、删卡、收尾提示，`board.read-changed` 的调用次数都是 0。
3. **耗时**：改动前后各测一次。桌面宽屏首次打开看板，用 shot-lib 页面计时；手机横屏首次打开看板、竖屏点“新建卡片”，用插件 `[perf]` 日志。三项都记录数据量和耗时。
4. **界面**：桌面和紧凑布局截图；抽屉、筛选、拖动、Ideas、Attention 的现有测试全部通过；`npm run typecheck`、`npm test` 通过。
5. **独立验收**：合并前由 `claude/claude-haiku-5-5` 在实现提交上复跑以上检查（AGENTS.md）。

## 5. 决定

- **不加切回完整看板的开关，也不给用户选项**（用户 2026-10-26）：维护者先自用一段时间，出问题直接暴露并修复。最坏情况只是宽屏显示不对，写入和存储都没有改动。
- **发布方式**：与 SQLite 迁移分两个版本还是合成一个版本，发布前由用户决定（风险分析见卡片记录）。
