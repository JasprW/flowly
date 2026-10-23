# Insights 重设计：评估工作流，而不是计产量

状态：**spec 第二版，用户审阅通过，已实现，待验收**（2026-10-22，卡片 `ccefebbe` “Insights重设计”）。第一版（产量统计，见 §13）已实现但未提交，审阅时被用户否定：

> 这个不应该是用来让用户焦虑、鼓励用户卷的机制，而是看这个 workflow 对于生产力的提升、整体效率的评估等。

用户确认的方向：

> Insights 只评估工作流本身（每卡介入次数、来回轮数、等待摩擦、每卡成本、改进闭环），按周看、只和自己的过去比。产量类数字只作为分母或上下文，不做大字和涨跌。

本 spec 取代 [PROJECT-INSIGHTS-SPEC](PROJECT-INSIGHTS-SPEC.md) §3 的天级数字、§5 的部分规则和 §9 的页面，以及 [WORKFLOW-INSIGHTS-SPEC](WORKFLOW-INSIGHTS-SPEC.md) §5.2、§12.6 的摆放位置。以下内容不变：流转日志、digest、token 日志的解析、Workflow insights 和 Agent habits 的口径。

## 1. 定位

Flowly 的分工是：人给意图和判断，agent 干活。所以稀缺的是**人的注意力**；agent 的时间和 token 便宜，但不免费。

Insights 回答一个问题：

> 这套工作流能不能用越来越少的人的介入，换来一次到位的交付？时间和成本漏在哪里？改进之后有没有变好？

评估对象是**流程和工具**，不是人。

### 1.1 原则

1. **产量不做主角**。完成卡数、commit 数、token 总量、agent 时长是产量或投入，只用作分母或一行背景文字，不做大字，不标涨跌。原因：会诱导拆卡、刷量，也会带来压力。
2. **看每卡比率**，例如“每张卡要我介入几次”，不看“做了多少”。
3. **每个数字都指向一个能调的杠杆**：写清卡片描述、加 paseo 脚本、调权限模式、换模型、补 AGENTS 规则。说不出对应杠杆的数字不放。
4. **按周看，只和自己的过去比**。不设目标，不做排名，不搞连续天数，不按天看。
5. **用中性语言**。不用红绿色和 ▲▼ 涨跌标记。变化写成“比前 4 周平均少 1 次”这样的句子，不评价好坏。
6. **不估算“节省了多少小时”**：没法验证，等于编数字。
7. **限制要明说**。人实际花了多少时间无从得知，用介入次数代替；交付有没有价值 Flowly 也不知道，只能用重开和失败来近似质量。页面脚注写清这两点。

## 2. 原页面信息的去留

| 原信息 | 结论 |
| --- | --- |
| 数字块 Done / New / Commits / Agent time / Tokens 及 7 天均值 | **去掉**大字。完成卡数只在标题句里作为分母出现；agent 时长和 token 改成每卡数值（§3.4） |
| 数字块 Rework | **改成**“来回轮数”（§3.2）。原口径把“回消息让卡继续”漏算或误算 |
| Turns / 失败轮次 | **改成**失败轮次占比（§3.4） |
| Waiting on you（列表） | **去掉**（第一版已定）。看板顶栏的 Attention 和 Needs you 负责 |
| “等你”的时间占比 | **改成**“等待审阅/回复”在卡片时间里的占比，只用于定位瓶颈（§3.3） |
| Suggestions R1–R7 | **只保留反映流程问题的三条**：R2 停滞、R3 反复返工（阈值改为来回 ≥3 轮）、R6 反复失败，改名“流程异常”。R1 审阅积压、R4 优先级倒挂、R5 并行过多、R7 可以开工都是在催进度，**去掉** |
| 天级 Summary（AI） | **保留**，放在页底“每日记录”里，默认收起。它是叙事记录，不是效率指标 |
| Last 7 days：新建/完成柱、在制数 | **去掉** |
| 各列停留中位数 | **并入** §3.3 |
| 最常改动的文件、commit、增删行 | **去掉** |
| Token use 明细、最耗 token 的卡 | **改成**每卡 token 与按模型对比（§3.4、§3.5） |
| Workflow insights | **保留**，放进“改进”部分，并显示建议落地前后的变化（§3.6） |
| Agent habits | **保留**，放进“改进”部分 |

## 3. 指标定义

### 3.0 统计对象

- **完成卡**：第一次进入 Done 的时间落在统计窗口内的卡片。Cancelled 和从未完成的卡不计入每卡指标。
- 每卡指标只统计这张卡从创建到第一次进入 Done 之间的事件。之后重开再完成的部分不计入，重开次数单独计数（§3.4）。
- 早期历史已被截断的卡（`incomplete`）不计入每卡指标，脚注写明张数。
- 汇总统一取**中位数**，旁边弱化显示 P75。原因：分布很偏，Flowly 有两张卡来回了 30 轮和 44 轮，会把均值拉到 4.5，而中位数是 2。

### 3.1 介入次数／卡：每张卡要我多少注意力

介入次数是以下三项之和：

| 组成 | 来源 | 说明 |
| --- | --- | --- |
| 你发的消息 | `agent.turn_ended` 的 `byUser`（§7.1）：本轮由一条真实用户消息开始 | 包括新建 session 时的首条消息、Kanban 工作指令、排队发出的后续消息。agent 后台任务通知、system reminder 等注入不算 |
| 权限请求 | `agent.permission_requested` | 每次都要你点一下 |
| 你手动移卡 | `status_changed` 且 `actor=human` | 包括验收后移到 Done |

提问不单独计入：你的回答本身就是一条消息，单独算会重复。

杠杆：卡片描述写清楚、权限加进允许列表、开启自动状态、换更合适的模型。

### 3.2 来回轮数／卡：一次交付是否到位

- **来回轮数**：卡片离开 In review、回到工作列或 Todo 的次数，包括你发消息让它继续（A1 自动恢复）和你手动拖回。离开到 Done 或 Cancelled 不算。被 A1r 撤销的成对恢复已由 `withoutRevertedResumes` 去掉。
- **一次通过率**：完成卡里来回轮数为 0 的比例。
- Flowly 的历史数据（60 张完成卡）：来回轮数中位数 2，一次通过率 10%。
- 杠杆：描述和验收标准写清楚（workpad）、交付前让 agent 自查、换模型。

### 3.3 时间去向：等待摩擦

每张完成卡的活跃期从第一次进入工作列开始，到第一次进入 Done 结束，分成三段，互不重叠：

- **agent 在做**：这张卡的 session 有轮次在运行（`sessionIntervals`，同一时刻多个 session 也只算一次）；
- **等待审阅/回复**：没有轮次在运行，并且满足以下任一条件：
  - 卡片处于 In review 或 Blocked；
  - 这张卡最近结束的一轮里有 `reportKind=question` 的汇报，下一轮还没开始。

  agent 用自带的提问工具（例如 AskUserQuestion）提问时，等待发生在轮次内部，会被算作“agent 在做”。这是已知偏差，脚注写明；
- **空闲**：其余时间，即卡在工作列里但没有任何 session 在跑。

显示内容：三段时间在所有完成卡中的合计占比，以及每卡活跃期的中位数。只描述时间去了哪里，不写“你回复得慢”这类话。

杠杆：等待长，可以集中批量审阅、加自动验证；空闲长，说明卡开了但没人推进，可以减少同时开着的卡。

另外附**打断来源**：本窗口内权限请求最多的前 3 个工具（`tool`，§7.2，带次数），对应“加入允许列表”；以及提问最多的前 3 张卡，对应“描述不清”。

### 3.4 每卡成本与质量

| 指标 | 定义 |
| --- | --- |
| token／卡 | 卡片 workspace 中所有 session 在活跃期内的 token 之和（本地 Claude/Codex 日志，同 USAGE-STATS-SPEC），取中位数。缓存命中率弱化显示 |
| agent 时长／卡 | §3.3 中“agent 在做”这一段，取中位数 |
| 失败轮次占比 | 窗口内 `turn_ended` 结果为 failed 的轮次所占比例 |
| 重开 | 窗口内从 Done/Cancelled 被移出的次数 |

### 3.5 按模型对比

- 一张卡归属于它轮次最多的那个模型（`turn_ended.model`，取不到时按 WORKFLOW-INSIGHTS-SPEC §12.5 回退）。
- 每个模型一行：卡数、介入次数／卡、来回轮数／卡、token／卡（都是中位数）。
- 窗口内少于 3 张卡的模型并入“其他”。原因：样本太少，比较没有意义。
- 只做对比，不排序成名次；行按卡数排列。

### 3.6 改进闭环

- **周趋势表**：最近 8 个自然周（周一开始，按客户端时区），每周一行：完成卡数（背景）、介入次数／卡、来回轮数／卡、一次通过率、token／卡。
  - 本周还没结束，标“至今”，不参与比较。
  - 比第一张完成卡更早的周没有意义（项目还很新），从表尾去掉，只保留本周。
  - 某周完成卡少于 3 张时，该周数值弱化显示。
- **建议落地标记**：Workflow insights 的建议被采纳（建了卡），且那张卡已经完成时，在完成那一周的行上标注建议标题（例如“加了 paseo 脚本 verify”）。这样可以对照落地前后的数字，但不做因果判断，文案只写“这周落地了…”。
- Workflow insights 和 Agent habits 的内容与操作沿用原样（WORKFLOW-INSIGHTS-SPEC §5.2、§12.6），版式改成行列表。

### 3.7 流程异常（现在）

保留 R2 停滞、R3 反复返工、R6 反复失败，其中 R3 的阈值改为“来回 ≥3 轮且仍未完成”。只在查看的窗口包含今天时显示；没有异常时整块隐藏，不显示“没有风险”。

## 4. 时间窗口与对比

- 默认窗口是**最近 7 天**（滚动），用 ‹ › 每次移动一周。不再提供“今天”和“30 天”。
- 对比基准是**前 4 个同长窗口合在一起后的中位数**（28 天内完成的卡合并计算），只出现在标题句里。
- 周趋势表（§3.6）固定是最近 8 个自然周，不跟着窗口移动。

## 5. 页面

单列，内容最大宽度 760，只用主题色（§6）。从上到下：

1. **标题句**：一段普通文字，不做大字。窗口内完成卡少于 3 张时改为“这周完成的卡太少，数字参考意义不大”，下面的数字仍然显示，但弱化。示例：
   > 最近 7 天完成 12 张卡。每张卡中位需要你介入 6 次、来回 2 轮，一次通过 3 张。和前 4 周相比，介入少了 1 次。
2. **流程异常**（§3.7），没有时不显示。
3. **注意力**：一个 Panel，三行：介入次数／卡（备注“消息 4 · 权限 1 · 移卡 1”）、来回轮数／卡（备注“一次通过 25%”）、提问／卡。
4. **时间去向**：一句话写三段的占比，下面是每卡活跃期中位数；再下面是打断来源两小列（权限最多的工具、提问最多的卡，可点按打开）。
5. **成本与质量**：一个 Panel，四行：token／卡、agent 时长／卡、失败轮次占比、重开。
6. **按模型**：每个模型一行（§3.5）。
7. **周趋势**：8 周的表格，5 列（§3.6），建议落地的标注写在行内。紧凑布局下只显示“周 / 介入 / 来回 / token”4 列，其余列点按行后展开。
8. **改进**：Workflow insights（行列表，点开看依据、proposal 和操作）、Agent habits。
9. **每日记录**：默认收起；展开后每天一行 AI headline，点按看当天的完整总结。
10. **脚注**：“介入次数以消息、权限、移卡计，不代表实际耗费的时间；Flowly 无法衡量交付的价值。”以及历史不完整的卡数、`byUser` 开始记录的日期（§7.3）。

不再分“概览/改进”两个标签页：整页都在讲工作流改进，改进建议只是最后一节。

## 6. 图表与风格

- 用户决定（2026-10-22）：保持 Paseo 原生、简约，只用主题色，克制使用图表。
- 这一版**不用图表**：趋势就是 §3.6 那张表。表格能准确对比数字，也没有“曲线往上”的激励暗示。如果以后确实需要一张图，只用 `DayBars` 那种中性柱图，并且先征得用户同意。
- 不用状态色区分“好坏”。状态色只用于流程异常的图标，与原页面一致。

## 7. 数据变化

### 7.1 `byUser`：本轮是不是由用户消息开始

- 写在 `agent.turn_ended` 事件（看板事件与流转日志）上，新增可选字段 `byUser: boolean`。只有 `turn_ended` 的钩子带 timeline，`turn_started` 的钩子拿不到。
- 计算：本轮 timeline 里有 `user_message`，且至少一条文本去掉首尾空白后，**不以** `<task-notification`、`<system-reminder`、`<command-`、`<local-command` 开头（与 USAGE-STATS-SPEC §3 的过滤一致），即为 `true`；否则为 `false`。timeline 不可用时不写这个字段。
- 写入点：`index.server.ts` 的 `agent.turn_ended` 钩子，复用现有的 `userTexts(event.timeline)`，把它扩展成同时返回是否有真实用户消息；在 `recordLifecycle` 的 habits 参数里加 `byUser`。
- `flowEntry` 保留该字段，`flowEntrySchema` 加 `byUser: z.boolean().optional()`。
- **已知局限**：Paseo 的 schedule 和 heartbeat 发出的提示同样是 `user_message`，会被算作用户消息。从 timeline 无法区分；如果以后 SDK 提供来源字段，再改。

### 7.2 权限请求的工具名

- `agent.permission_requested` 事件新增可选字段 `tool`：取 `request.name`（缺失时取 `request.kind`），截断到 80 字符。不记录 input、description 等参数内容，避免记下命令正文。
- `flowEntrySchema` 加 `tool: z.string().max(80).optional()`。

### 7.3 历史数据

- 来回轮数、权限请求次数、手动移卡、时间去向、失败轮次、token：历史数据里都有，可以直接算。
- **消息数**：`byUser` 上线之前的轮次没有这个字段。规则如下：
  - 窗口内完成卡涉及的轮次中，有 `byUser` 的少于 80% 时，“介入次数／卡”显示“—”。旁边的备注改为“消息数从 10 月 22 日起记录”，只列出权限和移卡这两项。
  - 周趋势表中，这类周的“介入”列同样显示“—”。
  - 不做近似推算。

> 可选的后续（不在本卡范围）：用 SDK 的 `timeline.refetch` 读取最近 8 周卡片 session 的历史，一次性回填消息数（只读，并发 2，同 WORKFLOW-INSIGHTS-SPEC §3.3）。要不要做由用户决定。

## 8. RPC

- `insights.project` 的输入改为 `{ projectId, tz, end?, etag? }`，`end` 是窗口最后一天，缺省为今天；去掉 `range`。返回 `InsightsView`：
  ```
  { window: { from, to, current },
    finished, incomplete,
    attention: { messages|null, permissions, moves, questions, perCard|null, p75|null, coverage },
    rounds: { median, p75, onePass, onePassShare },
    time: { working, waiting, idle, activeMedian, topTools[], topAskers[] },
    quality: { failedShare, reopened },
    models: [{ model, cards, attention|null, rounds, tokens|null }],
    weeks: [{ week, partial, finished, attention|null, rounds, onePassShare, tokens|null, landed[] }],
    baseline: { attention|null, rounds, ... },
    anomalies: Insight[],
    habits }
  ```
  其中 `coverage` 是带 `byUser` 的轮次占比；模型行和周行里的 token 值由下面的 tokens 接口补充。
- `insights.tokens` 改为返回完成卡在活跃期内的 token：`{ cards: [{ taskId, tokens }], weeks: [{ week, perCard }] , missing, sessions }`。仍然与 `insights.project` 分开读取，页面不必等日志解析完。
- `insights.digests`（已读取的 headline 列表）保留，供“每日记录”使用。
- 计算放在纯函数里（新文件 `shared/workflow-stats.ts`，替换第一版的 `shared/work-stats.ts`）。

## 9. 引导与文案

- 欢迎页的 *Project insights* 改为：“How much of your attention each card takes, how many review rounds, where the time goes and what it costs, week by week against your own past.”
- 一次性提示 `insights-redesign` 保留，文案改为：“Insights now measures the workflow, not output: attention and review rounds per card, where time goes and cost, by week.”
- README 两份的 Insights 一节同步改写；所有新文案加入全部语言目录。

## 9.1 总开关（2026-10-22，ONBOARDING-SETUP-SPEC §6）

host 设置 `features.insights`（默认开），在 Settings → AI features → **Insights** 和欢迎导览第 4 页。关闭时：隐藏项目菜单、概览栏的 Insights 入口和快捷键 `I`，已打开的 Insights 页关闭；不生成 daily digest（daemon 把 `digestEnabled` 与它相与），Workflow insights 不收集也不运行（`enabled` 与它相与）；`insights-redesign`、`first-workflow-insight` 提示不出。flow 事件照常记录，重新打开时历史还在。

## 10. 不做

- 天级产量、目标、连续天数、排名、跨项目汇总、按人统计。
- 估算节省的时间。
- 图表（§6）。
- 本卡不做历史消息数回填（§7.3）。

## 11. 验收

- 单元测试：
  - `byUser`：真实消息为 true；只有注入消息为 false；timeline 为空时不写；进入流转日志。
  - `tool`：截断；不含参数。
  - 统计口径：每卡窗口只算到第一次 Done；来回轮数包括 A1 和人工拖回，排除 A1r 成对撤销，离开到 Done 不算；一次通过率；时间三段不重叠，多个 session 同时运行只算一次；`coverage` 低于 80% 时介入为 null；模型归属与“其他”合并；自然周切分（周一开始、时区）、本周标“至今”、少于 3 张卡时弱化；建议落地标注落在完成那一周；R3 新阈值；去掉的 R1/R4/R5/R7 不再出现。
- 检查：`npm run typecheck`、`npm test`（含 i18n 完整性），在只含本卡改动的隔离 worktree 上运行。
- 实测：
  - reload 插件，在 Flowly 项目上用独立脚本手工统计 8 周的来回轮数和一次通过率，与页面逐周对照；
  - 桌面和紧凑布局截图存入 `docs/verification/`；
  - 按 AGENTS.md，用显式 full-access 的 `codex/gpt-6-luna` 测试 session 实测。

## 12. 实现计划（审阅通过后）

1. 数据：`byUser` 与 `tool` 的写入、schema、测试。可以先单独上线，让数据尽早开始积累。
2. `shared/workflow-stats.ts` 与测试；`server/insights.ts` 的新 RPC；删除 `shared/work-stats.ts`。
3. 客户端：重写 `client/insights.tsx` 的概览部分，删除第一版的数字块、Throughput 柱图和标签页；保留 Workflow insights 和 Agent habits 的组件。
4. 引导、README、i18n、PROGRESS、SPEC-OUTLINE。

## 13. 决定记录

1. 2026-10-22（第一版）：默认 7 天、改进建议放单独标签页、去掉“等你处理”。其中“标签页”已被第二版取代（§5）。
2. 2026-10-22（第一版审阅）：保持 Paseo 原生简约风格，只用主题色，克制使用图表。第二版沿用，并且不用图表（§6）。
3. 2026-10-22（第二版方向）：只评估工作流本身，按周看，只和自己的过去比；产量只作分母或上下文。
4. 第一版实现（产量统计、`shared/work-stats.ts`、Throughput 柱图）未提交，按 §12 替换。原页面的问题分析与第一版截图保留在 `docs/verification/insights-redesign-*`。
