# 调研：openai/symphony 对 Flowly 的启发

2026-10-19 · 卡片“调研symphony提取灵感” · 来源：https://github.com/openai/symphony（`main` 浅克隆：README、`SPEC.md` 2312 行、`elixir/WORKFLOW.md`、`.codex/skills/*`、Elixir 参考实现结构）

## 1. Symphony 是什么

一句话：**“管理工作，而不是监督 agent”**。一个常驻 daemon 轮询 issue tracker（Linear / Jira / GitHub / GitLab / Asana），为每个处于 active 状态的 issue 建一个独立 workspace，在里面无人值守地跑 Codex（app-server 协议），agent 自己改 tracker 状态、开 PR、处理 review、最后合并。人只在 tracker 上拖卡片：`Todo` 开工、`Human Review` 审、`Merging` 让它去合并、`Rework` 打回。

形态上它首先是一份**语言无关的规格**（README 的“Option 1”就是“让你的 coding agent 按 SPEC.md 实现一个”），Elixir 只是参考实现。明确的非目标：富 Web UI、多租户、通用工作流引擎。

| 维度 | Symphony | Flowly |
| --- | --- | --- |
| 定位 | 无人值守调度器 + tracker 读取器 | 人机协作看板，人分派、决策、审 |
| 卡片来源 | 外部 tracker（Linear 等） | 插件自有看板 |
| 谁开工 | orchestrator 轮询自动派发，有并发上限 | 人点 Start session |
| 状态驱动 | **人改 lane = 给 agent 下指令**；agent 按当前状态路由行为 | agent 汇报阶段，lane 是进度展示；Done 由人决定 |
| agent 卡住/提问 | 默认当失败处理（不许问人），只有“缺权限”逃生口 | 一等公民：question → Needs you → Reply |
| 进度记录 | 单个就地更新的 **Workpad 评论**（计划/验收/验证清单） | 追加式 progress note + Haiku 自动摘要 |
| 工作流策略 | 仓库内 `WORKFLOW.md`（YAML + Liquid 模板），热加载 | skill 文本写死在插件里；项目级无策略文件 |
| 可靠性 | 并发槽、重试退避、stall 检测、对账、续跑 turn | 依赖 Paseo session 状态和 attention |
| 观测 | token/速率限制/TPS、JSON API、终端仪表盘 | Insights、按卡 token、Attention 下拉 |
| 收尾 | 终态自动清理 workspace（before_remove hook） | 用户确认的 Wrap up，带 preflight |

结论先行：Symphony 的**自动派发、无人值守**与 Flowly 的产品定位（人管多任务、自动派发在 v1 之外）相反，不该照搬；但它在“**让 agent 的工作可检查、可续跑、可策略化**”上的几个设计，正好补 Flowly 的短板，而且大多已在 `ROADMAP-V2.md` M4/M5 里有雏形。

## 2. Symphony 的特色（值得注意的设计）

### 2.1 WORKFLOW.md：仓库里的工作流策略
- YAML front matter（tracker、轮询、workspace 根、hooks、并发、Codex 参数）+ Markdown 正文作为**每张卡的 prompt 模板**，Liquid 语法，变量 `issue.*` 和 `attempt`。
- 严格渲染：未知变量/过滤器直接失败，而不是静默留空。
- **必须热加载**；新配置无效时保持 last-known-good 并给出可见错误，不崩。进行中的 session 不受影响，只作用于以后的派发。
- 好处：策略和代码一起版本化、走 review；团队可以按仓库定制。

### 2.2 “状态即指令”：按 lane 路由 agent 行为
参考 WORKFLOW.md 的 Status map：每个状态对 agent 有明确含义——`Todo` 立即转 `In Progress` 再开工；`Human Review` 不改代码只轮询反馈；`Merging` 执行 `land` skill 直到合并；`Rework` 是**整套方案重来**（关旧 PR、删旧 workpad、从 `origin/main` 新开分支）而不是小修；`Backlog` 不碰；终态就退出。人的唯一操作界面就是拖卡。

### 2.3 Workpad：单一、就地更新的进度载体
每个 issue 只有一条 `## Codex Workpad` 评论，agent 反复编辑它而不是不断追加：
- 顶部环境戳 `<host>:<abs-path>@<short-sha>`；
- `Plan`（层级 checkbox）、`Acceptance Criteria`、`Validation`（具体命令）、`Notes`（带时间）、`Confusions`（执行中觉得含糊的地方，给人改进需求描述用）。
- 规则：开工先对齐 workpad；每个里程碑后更新；卡片描述里的 `Validation/Test Plan` 必须原样搬进清单且不可降级；“禁止留未勾的已完成项”。

### 2.4 完成门槛（Completion bar）
进入 `Human Review` 前必须：清单全勾、验证对最新 commit 全绿、PR 反馈全部处理（改了或给出有理由的 pushback）、CI 绿、PR 已挂到 issue。实际是把 DoD 写成 agent 的硬约束。

### 2.5 编排可靠性
- **Claim + 并发槽**：全局 `max_concurrent_agents` 和按状态的上限；按优先级 → 创建时间 → 标识排序。
- **续跑（continuation）**：turn 正常结束后若 issue 仍在 active 状态，同一线程继续下一 turn（上限 `max_turns`），续跑只发“继续”指引，不重发完整 prompt；worker 退出后 1 秒再检查一次。
- **重试退避**：失败按 `min(10s·2^(n-1), 5min)` 重试；prompt 里通过 `attempt` 告诉 agent“这是第 n 次，从当前 workspace 状态继续，别重复已完成的调查”。
- **Stall 检测**：距最后一个 agent 事件超过 `stall_timeout_ms`（5 分钟）就杀掉重来。
- **对账（reconciliation）**：每个 tick 刷新运行中 issue 的状态，人把卡移出 active → 停 agent；移到终态 → 停并清理 workspace。
- **无数据库重启恢复**：tracker + 文件系统就是状态，重启后重新轮询即可。

### 2.6 Workspace 生命周期 hooks
`after_create`（如 clone + 装依赖，失败则创建失败）、`before_run`（失败则本次失败）、`after_run`、`before_remove`（失败只记日志），统一超时。agent 只能在该 issue 的 workspace 里跑，路径必须在根目录下且名称经过清洗。

### 2.7 Tracker 写操作走宿主侧工具，凭据不进子进程
agent 通过 `linear_graphql` 等 provider 原生工具改 tracker，工具在 Symphony 进程里用宿主凭据执行，子进程环境里删除相关环境变量。工具规格和 session 快照绑定，热加载不会让进行中的 session 切换 provider。Flowly 的签名请求 + 作用域 MCP 已经是同一思路，而且更严格（CAS revision、幂等回执）。

### 2.8 Proof of work
demo 中 agent 交付时附带 CI 状态、PR review 反馈、复杂度分析和**操作录屏**；`land` skill 循环处理冲突、等 CI、修失败、逐条回复 review（accept / clarify / push back，先回复再改代码）。

### 2.9 其他
- 超出范围的发现由 agent **直接建 Backlog issue**，带验收标准和 `related`/`blockedBy` 链接（Flowly 的 Ideas 收件箱由人把关，更稳，保持不变）。
- token 计数细节：只用绝对累计值（`total_token_usage`）做差，忽略增量事件防重复计数；记录速率限制快照。
- `dispatchable` + `required_labels`：只有带某标签的卡才会被派发（安全过滤）。
- 可选 SSH worker 池（跨主机）。

## 3. 值得吸取的点（按对 Flowly 的价值排序）

### P1 卡片 Workpad：结构化、就地更新的计划/验收/验证清单
**现状缺口**：progress note 是追加流水，Haiku 摘要是事后总结；人审卡时看不到“计划了什么、验收标准是什么、哪些验证跑了没跑”。PROGRESS.md 里 “UNRUN” 这类记录现在全靠 agent 自觉写在文本里。

**做法**：卡片新增 agent 可写的 `workpad`（Plan / Acceptance / Validation / Notes / Confusions，checkbox 有状态），一个 `flowly_update_workpad` 工具整体替换（CAS 保护），卡片显示 `验证 3/5`，抽屉里可读可勾。卡片描述里若有 “Validation/Test plan” 段，skill 要求原样搬入。环境戳 `host:path@sha` 让人一眼知道在哪个 commit 上验证。`Confusions` 很有意思：它是对需求写法的反馈，可以汇总进 Insights。

### P2 交付门槛（soft completion bar）
在 P1 基础上，`flowly_update_status(in_review)` 时若还有未勾的验收/验证项，不拒绝，但要求 note 说明，并在卡片上标“交付时 2 项未完成”。与 AGENTS.md “completed / failed / unrun 分开记录”的项目规矩一致，变成产品能力。

### P3 项目 Playbook（WORKFLOW.md 式策略文件）
**现状**：skill 文本对所有项目一样；项目特有的规矩（比如本仓库 AGENTS.md 里的 onboarding upkeep、Luna 测试要求）只能靠仓库自己的 AGENTS.md。
**做法**（对应 ROADMAP M4 “项目 playbook”）：可选的 `.flowly/WORKFLOW.md`（或项目设置里），包含：
- Start session 的初始 prompt 模板，变量 `card.title/description/type/tags/artifacts/links`；
- **按 lane 的说明**（进入 Test 时做什么、In review 的交付格式、DoD、验证命令）——由 `flowly_get_task` 返回当前 lane 的那段，而不是每条消息前缀（守住“普通 follow-up 只发用户原文”的约束）；
- 默认 provider/model/mode。
- 严格模板 + 热加载 + last-known-good + 可见错误，照搬 Symphony 的语义。

### P4 Stall / 静默结束检测
（对应 ROADMAP M5 watchdog、M3 “静默结束”）
- 运行中 session 超过 N 分钟无任何事件 → Attention 里出现“可能卡住”；
- turn 结束时卡片仍在 Development/Test、本轮既没提问也没交付 → 标“静默结束”，给一个 **Nudge** 按钮（一键发送可配置的续跑指引：“从当前 workspace 状态继续，不要重复已完成的工作”）。
- 是否自动续跑（Symphony 的 continuation，上限 `max_turns`）作为项目级开关，默认关闭——因为它是插件发起的消息，需要用户明确授权。

### P5 Rework 两种语义
Symphony 把打回明确为“整套方案重来”。Flowly 现在 In review → 用户回复 → 自动回到 Development，相当于“增量修改”。可以在 In review 卡上多一个 **Rework from scratch**：新开 session，带上原始卡片上下文 + 用户的打回理由 + 上一轮 workpad 的 Confusions，旧 session 保留。

### P6 交付证据（Proof of work）
Artifacts 已有输入/输出。可以增加 `evidence` 子类（截图、录屏、测试输出、CI 链接），在 In review 卡上直接展示缩略图；配合 M4 的 Git 交付信息（分支、diff stat、PR 链接、CI 状态）。

### P7 Workspace hooks
Flowly 建 worktree 后，新 worktree 常需要 `npm install` 等准备。若 Paseo 的 workspace scripts 已覆盖，则只需在 playbook 里引用；否则可在 playbook 加 `after_create` / `before_remove`（参数数组子进程、超时、失败语义同 Symphony）。

### 远期 / 不建议现在做
- **自动派发队列**（Todo 按优先级自动开工，全局/按 lane 并发上限，`required_labels` 过滤）：Symphony 的核心，但 AGENTS.md 明确“自动分派在 v1 之外”，ROADMAP M5 已记录。若将来做，可直接借用它的 claim / 排序 / 退避 / 对账算法（SPEC §8、§16）。
- **人改 lane 自动停 session**（对账）：在 Flowly 里人可能只是整理看板，自动停会误伤；最多做成“移到 Cancelled 时提示是否停止运行中的 session”。
- agent 自建卡片：保持 Ideas 由人把关。
- SSH worker 池、外部 tracker 同步：属于 M6。

## 3.1 追问：“人改状态 → agent 自动干下一步”（Merging → 合入 → Done）

### Symphony 是怎么做到的
拆开看是四件事叠在一起，没有专门的“触发器”：
1. **轮询 + 对账**：orchestrator 每 5 秒看一次卡片状态；`Merging` 在 `active_states` 里，所以被拖到 Merging 的卡会被派发（或正在跑的 worker 下一轮看到新状态）。
2. **状态路由写在 prompt 里**：WORKFLOW.md 的 Status map 规定 “Merging → 打开并执行 `land` skill”。agent 每轮第一步就是读当前状态再选流程，状态本身就是指令。
3. **流程写成 skill**：`land` = 本地全量检查 → 解决冲突 → 等 CI → 修 CI → 逐条回复 review → squash merge；“合并前不 yield”。
4. **agent 有权改终态**：合并成功后 agent 自己把卡改成 Done；Done 是 terminal state，orchestrator 随之停 worker 并清理 workspace。

人的拖动 = 一次授权（“我审过了，去合吧”）；后续全部是 agent 的事，结果用 Done 回报。

### Flowly 现状
- 已有先例：**人把卡移到 Done/Cancelled 会触发收尾**（询问或自动 Wrap up，带 preflight）。“移动卡片 = 触发动作”的机制和用户心智已经存在，只是动作由 daemon 做，不是 agent 做。
- 泳道是固定的内置状态（可改名/开关/排序），没有 Merging。
- 约束：普通 follow-up 只发用户原文；Done/Cancelled 由人决定；PR 自动化在 v1 之外。

### 可以借鉴的设计：泳道动作（Lane actions）
**核心**：项目可为某些泳道配置“进入动作”。人把卡移入该泳道时，daemon 给卡片的 session 发送该泳道的说明，agent 按说明干完后把卡移到约定的下一列。拖动本身就是人的显式指令，和 “Send Kanban work instructions” 同属显式动作，不是普通 follow-up。

最有价值的一条链：**In review →（人拖）Merging → agent 合入 → Done → 自动 Wrap up**。Flowly 的卡大多是 worktree，Merging 不一定要 PR：
- 本地模式（不涉及 PR 自动化，最适合先做）：把 worktree 分支 rebase/merge 到主分支，跑项目验证命令（如 `npm run typecheck && npm test`），快进主分支，记录 commit SHA 为 output artifact，然后设 Done。Done 再触发已有的 Auto wrap up 归档 worktree——整条链首尾都是现成的。
- 远程模式（需解除“PR 自动化在 v1 之外”）：push + `gh`/`glab` 开或合 PR，等 CI，处理 review，类似 `land` skill。

其他可配的泳道动作（都是可选，默认关）：
| 人的移动 | agent 收到的说明 | 完成后 agent 移到 |
| --- | --- | --- |
| In review → **Merging**（新内置泳道，默认关） | 按项目合入流程合入，验证不过就修，修不了就提问 | Done（需要授权，见下） |
| In review → Development（打回） | 读用户最新反馈/卡片评论，返工 | In review |
| Development → **Test** | 按 playbook 的验证清单跑全量验证、补测试 | In review |
| Todo → Design/Development（卡片没有 session 时） | 用默认 provider/model 新建 session 并带卡片上下文开工 | 按正常阶段流转 |
| 任意 → Cancelled（有运行中的 session） | 不发给 agent；提示是否停止运行中的 turn | — |

### 要从 Symphony 照搬的细节
- **说明放在“lane 说明”里，触发消息很短**：触发消息只写“用户把卡移到了 Merging，请按该泳道的说明执行”；详细流程由 `flowly_get_task` 返回当前泳道的说明（来自项目 Playbook），或写成 skill（如 `land`）。这样改流程不用改代码，旧 session 也能读到最新版本。
- **每次进入只触发一次**：以状态变更事件 ID 做幂等键，daemon 重启、重复渲染、来回拖都不会重复发送；移出再移入算新的一次。
- **session 忙时排队**：session 正在跑一轮时，等它结束再发；或者提示用户“当前 session 正忙，结束后发送 / 现在发送 / 取消”。
- **多个 session 时选目标**：默认发给最近活跃的 session，没有 session 时按默认设置新建一个；目标在 toast 里写明，并带一个短暂的“撤销”。
- **对账**：动作执行期间人把卡移出该泳道 → 提示是否停止运行中的 turn（Symphony 是直接停，Flowly 应该问）。
- **不 yield 直到完成**：说明里要求 agent 循环“合入 → 验证 → 修复”直到成功；真正卡住才用 question 进入 Needs you，而不是静默结束。

### 需要用户决定的边界（与现有约束冲突处）
1. **agent 能否把卡移到 Done**：现在 Done 只能由人决定。建议做成**受限授权**：只有当卡是被人拖入 Merging（带“完成后可设 Done”的泳道动作）时，agent 才能设 Done，且必须附带证据（合入 commit SHA 或已合并 PR 链接的 output artifact）；活动里标注“依据 Merging 授权”。否则 agent 只能回到 In review 并说明。
2. **是否新增内置 Merging 泳道**（默认关闭，开启后出现在 In review 与 Done 之间），还是允许把某个已有泳道改名后挂动作。
3. **本地合入 vs PR**：先做本地合入（不碰 v1 的 PR 自动化边界），PR 模式另立卡。
4. AGENTS.md 需要新增一条 “Exception, user-requested: lane actions” 说明这种插件发起的消息。

## 4. 不需要学的（Flowly 已经更好）
- 人在回路：Symphony 把 “user input required” 当失败；Flowly 的 question → Needs you → Reply 是更适合个人多任务的设计。
- 写入安全：Flowly 的 CAS revision、签名 request、幂等回执、作用域限制比 Symphony 的 “agent 拿 GraphQL 全量权限” 更严谨。
- 多端 UI、i18n、Insights：Symphony 明确不做富 UI。

## 5. 一句话总结
Symphony 把“agent 应该怎么干活”写成了**可版本化的策略（WORKFLOW.md）+ 可检查的工作单（Workpad）+ 可兜底的运行时（续跑/stall/重试）**。Flowly 已经有更好的人机交互面，下一步最值得补的是这三样中的前两样：**Workpad + 交付门槛** 和 **项目 Playbook**，其次是 **stall/静默结束检测**。
