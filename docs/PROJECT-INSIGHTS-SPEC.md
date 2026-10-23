# 项目 Insights：天级统计、等你处理、建议与变更总结

状态：用户 2026-10-16 确认设计（“用途按 A 设计。同意增加流转日志文件”；“先这么实现看看”）。卡片任务 `9f52beff`。

## 1. 目的与范围

用途 A：每天回顾、安排当天。项目级 Insights 页回答三件事：

1. 昨天/今天发生了什么（数字 + 变更总结）；
2. 现在什么在等我；
3. 今天先做什么（规则建议）。

趋势只看最近 7 天。不做（后续 idea）：周/月视图、对外日报导出、跨项目汇总。按天 token 已于 2026-10-16 由 idea 加入（§11）。

Insights 只读，不改卡片状态、revision 或 Paseo 资源（变更总结的临时 summarizer session 除外，见 §7）。

## 2. 流转日志

`board.json` 的事件每卡只保留最近 100 条，而每轮开始/结束各占一条，活跃卡片的早期流转会被挤掉。新增不截断的流转日志。

- 文件：`flow/<projectId>.jsonl`（与 `board.json` 同目录），每行一条事件：
  `{ id, at, taskId, actor, action, from?, to?, reportKind?, outcome?, rule?, agentId? }`。不存 note 正文。
- 写入：`BoardStore.event()` 记下本次事务产生的事件；`board.json` 原子替换成功后，在同一串行队列中按项目追加。追加失败只记录警告，不影响看板写入。
- 补齐（reconcile）：daemon 启动后和每次读取 Insights 前，把 `board.json` 中存在而日志中没有的事件（按 id）补写。首次运行即回填现有事件。
- 历史不完整：卡片的 `created` 事件既不在 board 也不在日志中时（早期事件已被截掉），视为“历史不完整”，按已知最早事件推断初始列；页面以一行脚注说明。
- 删除：
  - 永久删除卡片：重写所在项目日志，去掉该卡记录；被去掉的行写入 `removed/task-<id>-flow-<time>.jsonl`。
  - Remove 项目：整个日志文件移到 `removed/<projectId>-flow-<time>.jsonl`。
  - 归档卡片不删日志。
- 日志行无效时跳过该行（不重置文件）。

## 3. 天级计算

纯函数（`shared/insights.ts`），daemon 调用。

- 日期边界：客户端传入 IANA 时区（`tz`），无效时用 daemon 本地时区。日期格式 `YYYY-MM-DD`。
- 回放：每张卡按时间顺序应用 `status_changed` 的 `to`，得到各列时间段。初始列：`created` 时为第一条流转的 `from`，没有流转时为当前列。
- 每天指标 `DayStats`：
  - `created`、`done`、`cancelled`：当天新建、进入 Done、进入 Cancelled 的卡片数（同一卡当天多次进入只计一次）；
  - `reopened`：离开 Done/Cancelled 的次数；`rework`：In review → 工作列（design/development/test）的次数；
  - `turns`：`{ completed, failed, canceled }`，来自 `agent.turn_ended`；
  - `agentMs`：所有 session 运行区间（turn_started→turn_ended，未结束的截到现在）与当天相交部分之和；`peakSessions`：当天最多同时运行的 session 数；
  - `questions`（reportKind=question）、`permissions`（`agent.permission_requested`）、`ideas`（`idea_proposed`）、`ideasAccepted`（`idea_accepted`）；
  - `lanes`：当天结束（今天为现在）时各列卡片数（不含归档卡片）；
  - `commits`、`added`、`deleted`（§6）。
- 7 天趋势：最近 7 天每天的 `created`、`done`、工作列卡片数；最近 7 天离开某列的时间段的停留时长中位数（按列）。
- 对比：当天数字旁显示前 7 天（不含当天）日均值。

## 4. 等你处理

只在“今天”视图显示。按以下顺序，每组内最久的在前，每项显示已等多久：

1. `permission`：卡片 session 正等待授权（Paseo pending permission）；
2. `question`：卡片的 agent 提问尚未回复（沿用 attention 的 open question 判断）；
3. `error`：session 处于错误状态；
4. `review`：卡片在 In review，时长从最近一次进入 In review 算起；
5. `blocked`：卡片在 Blocked。

权限、提问、错误由客户端从现有 attention 数据得出；In review / Blocked 及其等待时长由 daemon 从日志得出（`review[]` 与 `blocked[]`，含 `since`）。点击打开卡片。

## 5. 今天的建议（规则）

daemon 计算，最多 5 条，按严重度（warning > info）再按规则顺序。阈值为常量。每条 `{ rule, severity, text, taskIds }`：

| 规则 | 条件 |
| --- | --- |
| R1 验收积压 | In review ≥3 张，或最久一张 ≥24 h。附近 7 天进入 In review 与离开 In review 的次数 |
| R2 停滞 | 工作列中的卡片 ≥48 h 没有轮次与状态变化，且没有运行中的 session |
| R3 反复返工 | 一张卡累计 rework ≥2 次（仍未完成） |
| R4 优先级倒挂 | Urgent/High 卡在 Backlog/Todo ≥3 天，而这段时间有更低优先级的卡进入工作列 |
| R5 并行过多 | 工作列卡片数 ≥5 且 > 2 × 近 7 天日均完成数 |
| R6 反复失败 | 一张卡 24 h 内失败轮次 ≥2 |
| R7 可以开工 | 项目没有运行中的 session 且 Todo 不为空：按优先级再按在 Todo 的时长推荐前 3 张 |

文案为英文短句（与界面语言一致）。运行中的 session 判断由 RPC 传入（daemon 用 SDK 列出项目内运行中 agent 的 workspace）。

## 6. Git 变更

- 仓库：项目根目录（`primaryPath`）若是 Git 仓库则包含；再加根目录下一层是 Git 仓库的子目录（含 linked root 的 symlink）。最多 20 个。
- 命令（参数数组）：`git -C <repo> log --all --no-merges --since=<8 天前> --format=%x1e%H%x1f%aI%x1f%s --numstat`。按提交 hash 去重，按作者时间切天。
- 每天：提交数、增删行数（二进制文件不计行数）、改动最多的 5 个文件、提交标题（最多 50 条，供 §7）。
- 缓存：按仓库 `HEAD` 与 refs 指纹缓存 60 秒；git 不可用或出错时返回 `gitError`，其余部分照常。

## 7. 天级变更总结（LLM）

- 输入（≤12000 字）：项目名；当天完成、取消、新建的卡片；每张卡当天的流转（时间、from→to、actor）；每张卡当天最后一版 summary（state/recap/next）与之前最后一版的 state；当天提交标题；当天提问、失败轮次数。
- 输出 `{ headline, done[], progressed[], issues[], next[] }`：`headline` 一句话；每组最多 5 条 `{ text, taskId? }`。语言与卡片内容一致。解析容错同 TASK-SUMMARY-SPEC §3（代码块、首个 JSON 对象、字符串数组）。
- 触发：
  - 打开 Insights 查看“昨天”或更早的某天，若无该天总结且开关开启，自动生成一次；
  - “今天”只在手动 Refresh 时生成；任意一天都可 Refresh 重新生成；
  - 该天没有任何活动时不生成，显示“No activity”。
- 每个项目同时最多一个生成任务。
- 运行：`agents.create`，`config.provider` 为 Summary model（TASK-SUMMARY-SPEC §4，Auto 同解析），标签 `flowly=summarizer`、`flowly-project=<id>`，`waitForFinish(120000)`，`finally` 中**硬删除**该 session（`server/summarizer-remove.ts` 的 `daemonRemoveAgent`，与 card summarizer 同一条 AGENTS.md 例外，用户 2026-10-23 采纳；只删本次刚创建的 id，删除失败回退归档并记日志）。workspace：项目的「Flowly background」workspace，用前恢复/复用，最后一个后台 run 结束后归档，从不用卡片 workspace（[BACKGROUND-WORKSPACE-SPEC](BACKGROUND-WORKSPACE-SPEC.md)，2026-10-23 取代原先“按目录匹配项目根 workspace、否则用最近卡片 workspace”的规则：single-root 下所有卡片 workspace 目录相同，旧规则会选中某张卡的 workspace）。
- 开关：设置 `task-summary` 增加 `digestEnabled`（默认 true），只控制自动生成；手动 Refresh 始终可用。
- 存储：`digests.json`，串行写、备份、原子替换；无效时保留文件并报错。`{ version: 1, entries: [{ projectId, day, tz, at, model, headline, done, progressed, issues, next }], errors: [{ projectId, day, at, message }] }`。每个项目保留最近 60 天；Remove 项目时备份到 `removed/` 后删除。

## 8. RPC

| 方法 | 输入 | 输出 |
| --- | --- | --- |
| `insights.project` | `{ projectId, tz, day?, etag? }` | `{ etag, value? }`；value 见下 |
| `insights.digest` | `{ projectId, tz, day }` | `{ entry \| null, running, error \| null, enabled }` |
| `insights.digest-refresh` | `{ projectId, tz, day }` | `{ queued: true }` |

`insights.project` 的 value：`{ day, today, stats, average, trend[], dwell, review[], blocked[], insights[], git: { repos, error, topFiles }, incomplete }`。

## 9. UI

- 入口：看板概览栏末尾的 “Insights” 按钮，以及快捷键 `i`。打开后看板区域换为 Insights 页，顶部 “‹ Board” 返回（Esc 同样返回）。
- 页面（纵向滚动，宽度 ≤760 居中）：
  1. 日期切换：‹ 日期 ›，“Today”/“Yesterday” 显示为文字；不超过今天；
  2. 数字行：Done、New、Rework、Turns、Agent time、Commits，每项下方弱化显示 7 天均值；
  3. Waiting on you（仅今天）；
  4. Suggestions；
  5. Summary（变更总结）：Refresh、“Updated · 模型”，运行中显示 “Generating…”，错误一行弱化；
  6. Last 7 days：新建/完成柱状对比与工作列卡片数；各列停留中位数；最常改动文件。
- 点卡片引用打开卡片侧栏。
- 数据：仅页面打开时查询，`insights.project` 用 etag，看板 etag 变化时重新读取；关闭后不轮询。

## 10. 验收

- 单元：日志追加/补齐/去重/删卡重写/项目移除；回放与切天（跨天、时区）；DayStats 各项；等待时长；R1–R7 触发与不触发；git 输出解析；总结输出解析与输入构造。
- typecheck、全量测试；reload 本插件；对本项目调用 `insights.project` 核对数字。
- Luna 6 全权限测试 session 用 fixture 项目实测桌面与紧凑布局并清理。

## 11. 按天 token（2026-10-16，idea “Insights：按天统计 token 用量”，用户选择在本卡继续）

- 数据源与口径同 USAGE-STATS-SPEC：本机 Claude Code / Codex 日志，只读，不落盘内容，只算 token。
- 分桶：解析日志时按 15 分钟时间片累加（所有时区偏移都是 15 分钟的倍数），再按客户端时区切天。
  - Claude：每条 assistant 消息（按 `message.id` 去重，含子 agent 日志）计入其 `timestamp` 所在时间片。
  - Codex：`token_count` 为累计值，相邻两次的差值计入后一次的时间片；任一字段变小视为计数重置，从零计。
- 范围：项目内所有卡片 workspace 的 session，含已归档与 progress summarizer（标签区分不再细分）。后台 workspace 中的 digest session 不属于任何卡片，不计入。
- RPC `insights.tokens { projectId, tz, day?, etag? }` → `{ day, today, tokens, average, trend[7]: {day,total}, tasks[≤5]: {taskId,tokens}, sessions, missing }`。与 `insights.project` 分开，页面不等日志解析。
- UI：数字行增加 Tokens（总量、缓存命中率、7 天均值）；Summary 之后的 **Token use** 区块：按类型合计、缓存命中率、当天最耗 token 的 5 张卡（点击打开）、无日志的 session 数与来源脚注；Last 7 days 增加“Tokens per day”柱。
- 验收：解析分桶（去重、跨天、计数重置）与按天汇总单元测试；对真实 Claude 与 Codex 日志，插件按天合计与独立脚本手工统计一致。
