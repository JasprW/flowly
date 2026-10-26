# 匿名使用数据（遥测）

Status: **已实现，待随 1.7.0 发布**（2026-10-26，卡片“遥测建设”；实现：`server/telemetry.ts`）。发布前要先在 `POSTHOG_KEY` 填入 PostHog 项目 key，常量为空时不发送。用户决定：使用 PostHog Cloud 的 EU 区；由 daemon 直接调用 capture HTTP API，不引入 SDK；每天发送一次心跳；字段按白名单；默认开启、可以关闭；遵守 `DO_NOT_TRACK`。2026-10-26 补充决定：

- 用户被告知之前就可以发送，关闭之后不再发送；
- 设置里只放简要说明，不提供逐字段预览，具体内容以开源代码和本 spec 为准；
- 不提供重置 ID；
- 不做 IP 地理解析，i18n 需要的语言分布由 `ui_locale` 提供。

## 1. 目的与反目标

Paseo 的插件注册表不提供安装或更新统计，npm 的下载量又混有 CI 和镜像，所以现在无法回答下面三个问题：

1. 有多少个安装还在用 Flowly，它们分别在哪个版本（新版本发布后，多快有人升级）；
2. 哪些功能被打开、被关掉；
3. 核心循环（建卡、agent 交付、Next moves、Ideas、Memory）实际用得多频繁。

本功能只回答这三个问题。

反目标：

- 逐个事件上报；
- 崩溃报告和错误堆栈；
- 客户端（界面）埋点、session replay、feature flags；
- 任何能还原用户在做什么的内容（标题、描述、路径、仓库、对话、命令）；
- 按用户或团队识别身份；
- 用遥测数据驱动产品内的任何行为。

## 2. 总体形态

- **只有 daemon 发送**。客户端不发起任何网络请求，也不加任何依赖，所以冷启动约束不受影响（AGENTS.md 的 Cold start 一条）。
- **每天最多一个事件** `flowly_heartbeat`，内容是第 4 节的白名单字段。不发送其他事件。
- **接收方**：PostHog Cloud EU 区的一个项目，由维护者持有。项目设置里打开 *Discard client IP data*。
- **不用 SDK**：一次 `fetch` POST，超时 10 s，不重试队列，失败就等下一次检查（第 3 节）。
- 遥测失败**不影响任何功能**：不抛错，不弹提示，不写入看板数据。

## 3. 发送时机

### 3.1 前提条件（全部满足才发送）

1. 遥测开关为开（第 5 节），并且没有被环境变量强制关闭（第 6 节）；
2. 距离上次**成功**发送已超过 20 小时（`lastSentAt`）。用 20 小时而不是 24 小时，是为了在每天固定时间开机的情况下，不会被推迟到第二天。

发送不以用户是否已被告知为前提（用户决定 2026-10-26）。插件升级、或新用户第一次加载插件后，只要满足以上两条就开始发送。告知通过 What's new、导览和 README 完成（第 7 节）。

### 3.2 检查节奏

- daemon 启动（插件加载）后先等 **5 分钟**再做第一次检查，之后**每小时**检查一次。计时器要 `unref`，插件卸载或重载时清除。
- 一次检查最多尝试发送一次。HTTP 2xx 算成功，写入 `lastSentAt` 和计数窗口的终点（§4.4）。其他结果（网络错误、超时、非 2xx）只记一行 debug 日志，下一小时再试。
- 机器休眠、daemon 停止期间不会补发。恢复后第一次检查满足条件就发一条，覆盖整个空档（§4.4）。

### 3.3 本地状态

存放在 plugin-data 下的 `telemetry.json`（daemon 侧，原子写入，无效时保留原文件并当作首次处理）：

```json
{ "installId": "uuid-v4", "lastSentAt": "ISO 时间或空", "windowStart": "ISO 时间" }
```

- `installId` 在第一次需要发送时生成（`crypto.randomUUID()`），**不从机器信息派生**，之后不再更换。不提供重置入口（用户决定 2026-10-26）；删除 `telemetry.json` 会得到一个新 ID。
- 关掉遥测**不删除** `installId`。重新打开后沿用同一个 ID，避免重复计数。

## 4. 发送内容（白名单）

### 4.1 请求

```
POST https://eu.i.posthog.com/i/v0/e/
Content-Type: application/json

{
  "api_key": "<PostHog 项目 key，phc_ 开头，只写不读，写在源码常量里>",
  "event": "flowly_heartbeat",
  "distinct_id": "<installId>",
  "timestamp": "<发送时间 ISO>",
  "properties": {
    "$process_person_profile": false,
    "$geoip_disable": true,
    ... 4.2 与 4.3 的字段
  }
}
```

- `$process_person_profile: false`：作为匿名事件处理，PostHog 不建 person profile。
- `$geoip_disable: true`：不做 IP 地理解析（用户决定 2026-10-26：做 i18n 时看界面实际使用的语言，即 §4.2 的 `ui_locale`，比按 IP 推断国家更准，也不会留下城市级位置）。
- 实现前要先对照 PostHog 官方文档，核对 EU 入口地址（`eu.i.posthog.com`）和这两个属性名。若有出入，按官方文档修改本节。

### 4.2 环境与设置（每次都发）

| 字段 | 取值 | 说明 |
|---|---|---|
| `flowly_version` | `shared/version.ts` 的常量，测试保证它等于 `package.json` 的 version | |
| `paseo_version` | 不发送：插件服务端 SDK 目前拿不到 Paseo 版本；SDK 提供后再加 | |
| `node_major` | `process.versions.node` 的主版本号，如 `24` | |
| `os` | `process.platform`：`darwin` / `linux` / `win32` / 其他原值 | |
| `arch` | `process.arch` | |
| `ui_language` | `language` 设置值（`auto` 或语言代码） | 用户是否手动选过语言 |
| `ui_locale` | 界面实际使用的语言代码：`language` 不是 `auto` 时取它；是 `auto` 时取 `device-language.locale`（最后打开的设备的语言）；两者都没有时发 `""` | 只取 `localeCodes` 中的值，其他值一律发 `""` |
| `ai_language` | `ai-language` 设置值 | |
| `f_memory` / `f_insights` | `features` 设置 | 布尔值 |
| `f_ideas` / `f_artifacts` | `ideas` 设置 | 布尔值 |
| `f_outside_sessions` | `native-session.outside` | 布尔值 |
| `f_auto_status` | `auto-status.autoStatus` | 布尔值 |
| `f_auto_wrapup` / `f_archive_on_delete` | `wrap-up` 设置 | 布尔值 |
| `f_workflow_insights` | `workflow-insights.enabled`，且 Insights 开着（Workflow insights 是 host 级开关，不是按项目） | 布尔值 |
| `f_summary` | `task-summary.summaryEnabled` | 布尔值 |
| `projects` | 未归档项目数，按 §4.5 分桶 | |
| `cards_open` | 所有项目中未归档、且不在 Done/Cancelled 的卡片数，按 §4.5 分桶 | |

新增设置**不会**自动进入心跳。要加字段，必须先修改本节表格。

### 4.3 计数（窗口内）

窗口是 `[windowStart, 发送时刻)`。数据来自 `flow/<projectId>.jsonl`，不读 `board.json` 的事件（每卡只保留 100 条，见项目记忆里的这条坑），以及 `memory.json`。所有项目的数字加在一起：

| 字段 | 统计的是 |
|---|---|
| `c_cards_created` | `created` 事件 |
| `c_turns` | `agent.turn_ended` 事件 |
| `c_deliveries` | 由 agent 发起、`to = in_review` 的 `status_changed` |
| `c_next_moves` | `next_moves_suggested` 中 moves 非空的次数 |
| `c_next_moves_picked` | 带 `pick` 的 `agent.turn_ended` |
| `c_ideas_proposed` / `c_ideas_accepted` / `c_ideas_dismissed` | `idea_proposed` / `idea_accepted` 与 `idea_adopted` / `idea_dismissed` |
| `c_memory_proposed` / `c_memory_confirmed` | `memory_proposed` 事件 / `memory.json` 中 `confirmedAt` 落在窗口内的条目 |
| `c_wrapups` | `wrapped_up` |
| `models` | `agent.turn_ended.model` 的计数表，例如 `{"claude/claude-sonnet-5-5": 12}` |

`models` 的限制：

- 键必须匹配 `^[a-z0-9._-]+/[a-zA-Z0-9._:-]+$`，不匹配的归入 `"other"`；
- 最多保留 10 个键，其余合并进 `"other"`。

### 4.4 窗口

- 第一次发送时，`windowStart` 取 `max(遥测开启时刻, 发送时刻 − 24 h)`。
- 成功发送后，`windowStart` 更新为这次的发送时刻。
- 空档超过 7 天时，只统计最近 7 天，并加字段 `window_days`（向上取整的天数）。没有空档的普通心跳不带这个字段。

### 4.5 分桶

数量一律按桶发送，不发精确值：`"0"`、`"1"`、`"2-5"`、`"6-20"`、`"21-100"`、`"100+"`。

窗口计数（§4.3）发送精确整数。单个计数上限为 10 000，超过的按 10 000 发送。

### 4.6 绝不发送

以下内容一律不发：

- 项目、卡片、session 的 ID、标题、描述、标签；
- 任何路径、仓库名或 remote、分支名；
- 消息、prompt、summary、命令、artifact；
- connector 的类型或地址；
- 主机名、用户名、邮箱、IP（客户端不发 IP；PostHog 项目设置丢弃 IP）、时区；
- 环境变量、token。

## 5. 设置

- 新增 host 设置 `telemetry`（`shared/settings.ts`）：`{ enabled: boolean, default true }`。
- 放在 **Settings → General**，单独一组 **Usage data**，只有一个开关 **Send anonymous usage data**。说明行（涉及隐私，所以按 UI 文案规则保留）只做简要说明，不逐项列字段：*Once a day: versions, which features are on and usage counts. Never your content, paths or code.* 不提供逐字段预览（用户决定 2026-10-26：项目开源，发送内容以 `server/telemetry.ts` 和本 spec 为准，README 的 Telemetry 一节链接到这两处）。
- 被环境变量强制关闭时（第 6 节），开关显示为关、不可操作，说明行改为 *Turned off by DO_NOT_TRACK on this computer.* 客户端通过 RPC `telemetry.status`（返回 `{ forcedOff: boolean }`，有 schema 校验）得知这个状态。
- 关闭后**立即生效**，从下一次检查开始不再发送任何东西，包括关闭这个动作本身。重新打开后照常发送。
- daemon 读设置时使用 `*Values()` 解析函数（存储的值可能缺字段）。

## 6. 环境变量

只在 **daemon 进程**的环境里生效（Paseo 启动 daemon 时继承的环境），任一条满足就强制关闭，并且优先于设置：

- `DO_NOT_TRACK` 非空且不等于 `0`（https://consoledonottrack.com 约定）；
- `FLOWLY_TELEMETRY=0`（或 `off` / `false`）。

另外两种情况也一律不发，以免开发和测试的数据混进统计：

- `NODE_ENV=test`；
- 插件从本地路径安装（`paseo plugin install "$PWD"`）。插件服务端拿不到自己的安装来源，所以不做自动判断；AGENTS.md 的本地安装说明要求维护者给 daemon 设置 `FLOWLY_TELEMETRY=0`。

## 7. 告知

| 位置 | 内容 |
|---|---|
| What's new（引入遥测的那个版本，`client/whats-new.ts`） | 一条：*Flowly now sends anonymous usage data once a day: versions, which features are on and usage counts. Never your content, paths or code. You can turn it off in Settings.*，带 **Open settings** 按钮，打开 General |
| 首次导览最后一页 Ready when you are（`client/onboarding.tsx`） | 在 More features 下面放同一个开关（`UsageDataGroup`），文案同第 5 节，默认开。Built in 页讲的是每张卡都在跑的功能，遥测放在那里不合适 |
| README（英文、中文） | 新增 **Telemetry** 一节：几句话概括发送什么、不发送什么，关闭方法（设置或 `DO_NOT_TRACK=1`），数据存放地（PostHog EU），并链接到本 spec 和 `server/telemetry.ts` |
| ONBOARDING-SPEC | 记录最后一页新增的这一行。不加一次性 tip：What's new 已经覆盖老用户，导览覆盖新用户 |

所有新文案进入 `shared/i18n/` 的全部目录（I18N-SPEC）。

## 8. 维护者侧（不在插件代码里）

- PostHog 项目选 EU 区，打开 *Discard client IP data*，数据保留期用免费档的默认值。
- 建议的看板，全部基于 `flowly_heartbeat`，统计每天的独立 `distinct_id`：
  - 版本分布：按 `flowly_version` 分组；
  - 升级曲线：新版本发布后各版本的占比；
  - 功能开启率：各 `f_*` 的占比；
  - 使用频率：各 `c_*` 的中位数和 P90，以及 DAU/WAU。
- 项目 key 只能写入，不能读取，放在源码里没有问题。可能有人伪造数据，这一点已接受：数据只用于参考。

## 9. 验收标准

1. 开关为开、距上次成功发送超过 20 h 时，daemon 启动 5 分钟后发出**恰好一个**请求：发往 `https://eu.i.posthog.com/i/v0/e/`，`event = flowly_heartbeat`，`properties` 的键集合与第 4 节完全一致。用 fetch 桩加单元测试断言键集合，任何多出来的键都判失败。
2. 用户还没看过导览或 What's new 时，只要开关为开，照常发送。
3. 关闭开关后，之后的每次检查都没有任何请求；重新打开后恢复发送，并沿用原来的 `installId`。
4. `DO_NOT_TRACK=1`、`FLOWLY_TELEMETRY=0`、`NODE_ENV=test` 三种情况各自都没有任何请求，设置页显示强制关闭的状态。
5. 网络失败、超时、返回 500 时：不抛错、不改动 `lastSentAt`，一小时后重试；连续失败不会多发。
6. `ui_locale`：`language` 为固定语言时发该语言；为 `auto` 时发 `device-language.locale`；两者都没有时发 `""`。
7. 计数测试：构造一个包含窗口外事件的 flow 日志，只统计窗口内的事件；`models` 中的非法键归入 `other`，最多 10 个键。
8. `telemetry.json` 损坏时保留原文件、重新生成状态，不崩溃。
9. 客户端 bundle 不新增依赖；`npm run typecheck`、`npm test` 通过，包括 i18n 目录检查。
10. README、What's new、导览、ONBOARDING-SPEC 同步更新（AGENTS.md Onboarding upkeep）。

## 10. 以后可能加（本版不做）

- 客户端平台（web / 桌面 / iOS / Android）：需要客户端经现有 RPC 告诉 daemon，等证明需要再加；
- 主动反馈入口；
- 崩溃和错误计数。

每一项加进来之前都要先修改第 4 节和告知文案。
