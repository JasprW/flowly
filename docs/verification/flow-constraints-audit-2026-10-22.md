# Flowly 流程约束失效调查（2026-10-22）

卡片：流程约束不足（`08a37039`），调查会话 `69bb87f5`（Claude Opus 5.5）。只读调查，没有改产品代码。
复现：`node docs/verification/flow-constraints-audit-2026-10-22/audit.mjs`（默认统计 2026-10-21T06:00Z 之后创建的 Flowly 卡片会话）。本文数字取自 2026-10-22T08:10Z 的一次运行，输出在 `flow-constraints-audit-2026-10-22/audit-output.txt`。窗口内还有会话在继续工作，重跑时数字会有小幅变化：约 10:00Z 重跑时，PR 是 24 个、登记 6 个，多出来的 #33 见下文。

## 结论

1. **主因不是 context compaction。** 19 个会话里只有 2 个发生过压缩。Flowly skill 放在会话的 system prompt 里，压缩时不会丢。压缩之后的回合都正常调用了 Flowly。17 个开 PR 的回合里，只有 1 个发生在压缩之后。
2. **约束挂在“交付”这一刻，PR 却是在交付之后的回合里开的。** 典型流程是：agent 交付到 In review，用户回一句“创建 PR 并合入”，agent 开 PR、合并，然后结束回合，期间不调用任何 Flowly 工具。服务端的提醒只附在 Flowly 写入的返回值上，这个回合没有写入，也就收不到提醒。窗口内的 23 个 PR 只有 6 个登记为 output。
3. **服务端把这类回合当作“没有工作”，并替它把状态改回去。** 规则 A1r 会把卡片移回 In review，事件记作 “No work was reported in that turn; restored”。36 次这样的恢复里，有 18 次的回合其实改了文件或开了 PR。看板上看不出任何异常，失效被掩盖了。
4. **模型差异很大。** 第一回合两种模型都 100% 读了 get_task。后续回合里，Sonnet 有 77% 一次 Flowly 都不调用；改了文件的回合里，这个比例是 68%。Opus 分别是 7% 和 4%。Codex 上的 GPT（样本小）几乎每个回合都会调用 Flowly，开的 PR 也都登记了。
5. **有服务端兜底的约束基本都守住了，只写在 skill 文本里的普遍失效。** type、tags、workpad、next moves 都接近 100%。PR 登记、阶段切换、后续回合更新 workpad 没有兜底，大量缺失。workpad 的软闸门（`WORKPAD_OPEN`）被 agent 预先传 `acknowledgeOpen=true` 绕过，几乎从未真正拦截。
6. **ACP 类 provider 根本收不到规则。** Flowly 只通过 system prompt 下发 skill 和卡片上下文，而 Paseo 的 ACP provider（Hermes、Gemini CLI 等）不读 system prompt。这是读代码得出的结论，未实测，见“跨 provider 和模型的核对”。

## 数据与方法

- 会话：`~/.paseo/agents/*/*.json` 里带 `flowly-task` 标签、不是子 agent、属于 Flowly 项目、创建于 2026-10-21T06:00Z 之后的会话，共 19 个：18 个 Claude（Sonnet 5.5 / Opus 5.5），1 个 Codex（gpt-6-luna）。这个时间点之后，卡片设置提醒（#9）和 “Start of every turn” 已经上线。
- 回合：读 Claude Code 的 transcript（`~/.claude/projects/.../<sessionId>.jsonl`）。每条真实的用户消息开始一个回合，Paseo 的 agent 通知不算。回合内记录：改文件（Edit/Write，以及 Bash 里的 `sed -i`、heredoc 等写文件命令）、`gh pr create`、Flowly 的 MCP 和 CLI 调用、调用返回的 reminders 和错误码、压缩边界。
- 卡片：读 `board.json` 里的实体（type、tags、workpad、ideas、artifacts）。完整历史读 `flow/<projectId>.jsonl`，不用 board.json 里截断过的事件，见项目记忆 8b78be01。
- PR：`gh pr list --state all`，和所有卡片的 output artifact 对照。

## 各约束的遵守情况

| 约束 | 兜底机制 | 结果（2026-10-21T06:00Z 之后） |
|---|---|---|
| type / tags / workpad | `get_task` 的 `setup.missing`；每次写入都附提醒；交付时软闸门 | 19 张卡全部齐全。tags 提醒 11 次，当回合补上 11 次；workpad 提醒 24 次，补上 23 次 |
| 交付带 next moves | 交付调用自带 `nextMoves` 参数，漏了会提醒 | 27 次交付全部带上 |
| 第一回合先读 get_task、写 workpad | skill 的 “Start of every turn” | 读 get_task 18/18，写 workpad 17/18 |
| 后续回合先读 get_task | 只有 skill 文本 | 75 个后续回合里，52%（39 个）一次 Flowly 都没调用 |
| 改代码时切到 development 阶段 | 只有 skill 文本，加上 A1/A1r 自动改状态 | 19 张卡里 7 张 agent 从没设过工作阶段（从 Todo 直接到 In review） |
| 交付前收尾 workpad | `WORKPAD_OPEN` 软闸门 | 27 次交付里 19 次预先传了 `acknowledgeOpen=true`，其中 17 次确有未完成项；闸门只拦下过 1 次 |
| 交付时考虑 ideas | 提醒 “Zero is fine; decide on purpose”，附在交付调用上 | 提醒了 16 次，当回合跟进 0 次；19 张卡里只有 5 张有 idea |
| PR 登记为 output | 只有 skill 里的一句括号说明 | 23 个 PR 只登记了 6 个；开 PR 的回合里，当回合登记的只有 3/17 |

## 根因

### 1. 约束跟着 Flowly 的“交付”事件走，不跟着真正的工作事件走

- 开过 PR 的 17 个回合里，13 个不是交付回合，其中只有 1 个登记了 PR。11 个回合从头到尾没有调用 Flowly。
- 典型时间线（`37a3ffe8`，PR #22）：01:19:27 交付 In review → 01:20:45 用户：“创建pr合入” → 01:21:30 开出 PR #22，合并，回合结束，期间零次 Flowly 调用。#23、#24、#26、#27、#28、#32、#14、#11、#21 都是同一个模式（见下方清单）。
- skill 的回合清单（`server/skill-source.ts` 第 10–18 行）只有约 780 个字符，后面跟着 23 条长段落（全文 18.5 KB）。清单第 4 步只写了 “workpad checks updated, next moves on deliveries, questions and results”，没有提 output artifact。PR 要登记这条规则，在第 11 条段落中间的一个括号里（全文第 10684 个字符处）。
- skill 自己也给了跳过的理由：Details 第 1 条写着 “Read flowly_get_task before starting a work phase”，和 “Start of every turn” 矛盾；阶段、ideas、next moves 的规则都以“交付”或“工作阶段”为前提，而“提交、合入”这类回合看起来两者都不是。
- 所有提醒都附在 Flowly 写入的返回值上（`server/agent-service.ts:507`）。一个回合只要不做写入，就收不到任何提醒。ideas 提醒附在交付调用上，而交付通常是这个回合的最后一个调用，agent 拿到提醒时已经准备结束回合，所以 16 次提醒一次也没有跟进。
- 就算在交付回合里，PR 也容易被漏掉：#17、#18（`406cdcb3`）、#30（`787f42ac`）、#31（`022a6806`）都在 PR 之后交付了，但只把 PR 链接写在交付说明里，没有登记为 artifact。首次统计之后又出现一例：#33（`fc9417a0`，Opus，08:16Z），那个回合依次调用了 get_task、更新 workpad、交付到 In review，流程完全合规，PR 还是没登记。可见只要登记 PR 是一个单独的、可选的调用，连认真交付的回合也会漏。

### 2. 后续回合整轮跳过 Flowly，规则 A1r 把它掩盖了

- 规则 A1/A1r（`server/progress-rules.ts:63`、`:105`）：用户在 In review 的卡上发消息时，卡片自动移到 Development。如果这个回合没有任何 Flowly 报告，回合结束时再移回 In review，事件备注是 “No work was reported in that turn; restored”。这条规则原本是为“谢谢”这类闲聊设计的，分不清一个回合到底有没有干活。
- 36 次 A1r 恢复里，有 18 次的回合改了文件或开了 PR，其中 10 次开了 PR。例如 `022a6806`（memory、ideas 汇总区微调）在 In review 之后又经过 6 轮返工，改了动画代码，没有更新过阶段、workpad 和 next moves，每轮都被 A1r 默默移回 In review。
- 后果是看板上永远看不出偏差。用户只能事后发现，比如 PR 没登记，或者卡片已经 Done 了 workpad 还是 0/2、0/2（手机端 attention 打不开）。在 `1c09da9f` 里，用户直接问过“为什么这个session里你一直没有更新卡片状态”，agent 承认漏了。

### 3. 项目自己的指令占满了注意力，而插件管不了项目指令

插件管不了用户项目里的指令：别的项目可能有更长的流程规则，也可能什么都没有。所以 Flowly 的规则必须自己在合适的时刻出现在 agent 眼前，不能指望项目指令来提醒。这个项目里的情况如下：

- 开 PR 的回合里，agent 的推理几乎全花在 AGENTS.md 的 Git 规则上：工作区共享、按 hunk 提交、用临时 worktree 或临时 index、`git push <sha>:refs/heads/...`、合并后 `git reset origin/main`。`37a3ffe8` 的思考全程在处理 hunk 隔离，Flowly 一次都没出现。
- AGENTS.md 的 Git workflow 一节，最后一步是 “bring the local main up to date”，没有“把 PR 登记到卡片”这一步。
- agent 自己写的 next moves 也把下一回合导向 AGENTS.md：43 个提交/PR 类的 next move 里，只有 1 个提到登记 PR，其余都是“按 AGENTS.md 的 Git workflow……开 PR 并合并”。用户点了这个 next move，agent 就照 AGENTS.md 的清单做完，然后结束回合。

### 4. 模型差异

| 模型 | 后续回合不调用 Flowly | 改了文件的后续回合不调用 Flowly | 开 PR 的回合不调用 Flowly |
|---|---|---|---|
| claude-sonnet-5-5 | 37/48（77%） | 17/25（68%） | 11/14 |
| claude-opus-5-5 | 2/27（7%） | 1/23（4%） | 0/3 |

窗口内唯一的 Codex 卡片会话（gpt-6-luna，`aced5490`），在同样的“创建PR并合入”回合里登记了 PR #29，但样本只有 1 个。两种 Claude 模型第一回合都 100% 读了 get_task，差别几乎全部出现在后续的短回合里。

### 5. 软闸门被预先绕过

skill 写的是：有未完成项时，“deliver only with acknowledgeOpen=true and a note that explains every open item”。agent 把它理解成交付时默认带上的参数：Opus 11 次交付全部预先带上，Sonnet 16 次里带了 8 次。闸门那条列出每个未完成项的 `WORKPAD_OPEN` 消息因此几乎发不出来，起不到“让 agent 看一眼还差什么”的作用。

### 6. 次要：skill 在会话创建时就固定了，而且越来越长

- 卡片会话的 skill 写在 `config.systemPrompt` 里，创建时就固定。从 10-19 到现在，skill 改了 14 次，长度从 13.3 KB 涨到约 22 KB。
- 长期使用的会话一直拿着旧规则。PR #13 来自 10-19 创建的 Opus 会话 `132ad340`，当时还没有 PR 要登记的规则。PR #7 来自 `760da1c1`，它创建时这条规则还没上线，system prompt 里也没有。
- 影响不大：10-22 漏登记的那些会话，system prompt 里都有这条规则。另外，“Card setup missing: …” 这行开头也会一直留在 system prompt 里，即使后来已经补齐，目前没看到它造成问题。

## 已排除的原因

- **Compaction**：19 个会话里压缩过的有 2 个（`787f42ac`、`d633c8ab`），都是在约 97 万 token 时自动压缩（1M 上下文）。压缩之后的 4 个后续回合里，只有 1 个没调用 Flowly（25%）；压缩之前的后续回合是 54%（38/71）。把窗口放宽到 10-19 起（`--since 2026-10-19T00:00:00Z`，6 个会话压缩过）：压缩前 34%（67/200），压缩后 31%（5/16），两者没有差别。压缩之后紧接着的调用也都正常（get_task、workpad、交付）。
- **规则没写进 prompt**：10-22 漏登记 PR 的会话（#22–#28、#31、#32）的 system prompt 里都有 “a pull or merge request you opened yourself too”。

## 漏登记 PR 清单（2026-10-21T06:00Z 之后）

| PR | 会话 / 模型 | 开 PR 的回合 | 该回合的 Flowly 调用 |
|---|---|---|---|
| #11 | `f7b43804` Sonnet | 交付之后：“按项目 git 流程提交……开 PR 并合并。” | 无 |
| #13 | `132ad340` Opus（10-19 创建，旧 skill） | 同一张卡之前登记过 #1/#8/#10/#12 | 不在本次统计范围 |
| #14 | `816fda4f` Sonnet | 交付之后：“没问题，提PR并合入” | 无 |
| #17、#18 | `406cdcb3` Sonnet | “继续release吧” | 有交付；登记了 issue 链接，但没有登记 PR |
| #19 | `406cdcb3` Sonnet | “提交的issue有问题……在AGENTS里增加约束” | 无 |
| #21 | `ca637072` Sonnet | “开” | 无 |
| #22 | `37a3ffe8` Sonnet | 交付之后：“创建pr合入” | 无 |
| #23 | `46789f59` Sonnet | 交付之后：“创建pr并合入” | 无 |
| #24 | `857d5880` Sonnet | 交付之后：“只提交这张卡的改动……” | 无 |
| #25、#28 | `1c09da9f` Sonnet | “提pr并合入” / “ok 把相关的全部提交并合入” | 无 |
| #26、#27 | `eb030745` Sonnet | “提交PR并合入” / “合入” | 无 |
| #30 | `787f42ac` Opus（压缩之后） | “按仓库 Git 流程提交本卡改动……” | 更新了 workpad，也交付了，PR 链接只写在说明里 |
| #31 | `022a6806` Sonnet | “创建PR并合入” | 之后有 get_task、workpad、remember 和交付，但没有登记 PR |
| #32 | `8823c099` Sonnet | 交付之后：“提交、合入” | 无 |
| #33 | `fc9417a0` Opus（首次统计之后） | “只提交这张卡的改动……” | get_task、workpad、交付都做了，但没有登记 PR |

## 跨 provider 和模型的核对

Flowly 面向所有 provider 和模型，所以方案不能只按 Claude Code 设计。下面分两步核对：规则能不能送到各 provider 的 agent 手里，以及不同模型拿到规则之后表现如何。

### Flowly 的规则怎么送到各 provider

Flowly 只在创建会话时，把任务上下文和 skill 放进 `config.systemPrompt`（`client/session.ts:128`），再由 Paseo 交给各 provider。下表是读 Paseo 自带代码（`/Applications/Paseo.app/Contents/Resources/app.asar`，按其中的源文件名定位）得到的结果：

| provider | 规则怎么交给模型 | 压缩之后还在不在 |
|---|---|---|
| Claude（含 claude-* 变体） | 追加到 system prompt | 在。system prompt 不参与压缩 |
| Codex（含 codex-* 变体） | 作为 `developer_instructions`，每个回合的 turn context 都带上 | 在。已在 `aced5490` 的 rollout 里确认：压缩后的 `replacement_history` 里仍有 skill |
| OpenCode | 每次 prompt 的 `system` 参数；新版用 session instructions | 每次都发，应该在（未实测） |
| Pi | 由扩展追加到 system prompt | 应该在（未实测） |
| ACP（Hermes、Gemini CLI 等走 ACP 的 agent） | **不传**：`acp-agent.js` 里完全没有读取 `systemPrompt` | 这类会话从一开始就收不到 skill 和卡片上下文，只能看到 Flowly 的 MCP 工具 |

本机配置里 Hermes 就是 `extends: "acp"`。ACP 这一行只是读代码得出的结论，还没有实际跑一个 ACP 会话验证。这是一个独立于本次失效的缺口：不管 skill 写得多好，ACP 会话都看不到。

### 不同模型的表现

Codex 会话用 `audit-codex.mjs` 统计（输出见 `audit-codex-output.txt`）。Codex 把 MCP 调用写在 `exec` 脚本里，脚本按脚本文本识别。窗口说明：2026-10-21T06:00Z 之后只有 3 个 Codex 会话，所以 Codex 取 10-19 起；Claude 取 10-21T06:00Z 起，约 10:20Z 重跑。

| 模型（provider） | 后续回合不调用 Flowly | 改了文件的后续回合不调用 Flowly | 开 PR 的回合当回合登记 | 交付带 next moves |
|---|---|---|---|---|
| Claude Sonnet 5.5 | 37/48（77%） | 17/25（68%） | 2/14 | 16/16 |
| Claude Opus 5.5 | 1/38（3%） | 0/33（0%） | 1/5 | 21/21 |
| GPT-6 Luna / GPT-6.1 Sol（Codex） | 1/20（5%，唯一一例是故意断开 MCP 的测试） | 0/9（0%） | 2/2 | 18/18 |

几点观察：
- GPT 在 Codex 里几乎每次写入之前都会先读一次 `get_task`，短回合也一样（如“只看当前卡片的”“给我完整的！”），还会主动切换 design、development、test 阶段。同一个任务（Handle expired links）的对照里，Sonnet 从 Todo 直接交付到 In review，Luna 依次经过 design、development、test 再报告结果。
- Codex 的样本小：18 个会话里大部分是验证用的临时会话，真实卡片会话只有 5 个。结论是方向性的。
- 问题集中在 Sonnet，Opus 主要在“交付回合漏登记 PR”这一点上出问题（#30、#33）。方案要按最弱的模型来设计，同时不能依赖某个 provider 独有的入口。

### 建议 1–3 是否通用

| 建议 | 是否通用 | 说明 |
|---|---|---|
| 2. 交付调用加 `outputs`，`acknowledgeOpen` 先拒后放 | **通用** | 完全在 Flowly 服务端的工具契约里，任何能调用 Flowly 的 provider（MCP 或 CLI）面对的都是同一个参数，也不依赖 skill 能否送达。同类做法 nextMoves 在 Claude（37/37）和 Codex（18/18）上都有效 |
| 3. `get_task` 返回当前回合清单 | **机制通用，效果因模型而异** | 工具返回值每个 provider 都会放进上下文，这也是 ACP 会话和老会话唯一能拿到最新规则的地方。GPT 几乎每次写入前都读 get_task，效果最好；Sonnet 的后续回合常常不读 |
| 1. 重写 skill 核心 | **内容通用，送达不通用** | 短表可以写成与模型无关，但它走 system prompt，ACP 会话收不到。需要补一个不靠 system prompt 的渠道（见修订后的第 1 条） |
| 4. Claude hooks | **不通用** | 只有 Claude 有入口，不作为核心方案 |
| 5. 统计 | 通用 | Claude 用 `audit.mjs`，Codex 用 `audit-codex.mjs` |

## 改进建议（修订版：只靠插件，让 agent 当回合自己做到）

第二轮反馈里你做了两个决定：
- **不改仓库的 AGENTS.md。** Flowly 面向所有用户，别人的项目里没有这些规则。
- **不做事后补救。** 不在回合结束后由服务端代为登记 PR，也不自动给会话发补登消息。插件的初衷是让 agent 在当回合自己做到。

所以第一版的三条建议（服务端自动登记 PR、A1r 补登提醒、改 AGENTS.md）全部撤回，对应的 3 个 idea 也作废。

### 插件能用的手段

下表是核对 Paseo SDK（`@getpaseo/plugin` 的 lifecycle 定义）和 Paseo 自带的 provider 选项之后的结果。

| 手段 | 何时生效 | 覆盖范围 |
|---|---|---|
| system prompt 里的 skill | 会话创建时写入，之后每回合都在上下文里，但不会再更新 | Claude、Codex、OpenCode、Pi。**ACP 类 provider（Hermes、Gemini CLI 等）收不到**，见下一节 |
| Flowly 工具的参数和返回值 | agent 调用工具时 | 所有 provider，但前提是 agent 去调用。工具描述不一定在上下文里：Claude Code 把 MCP 工具藏在 ToolSearch 后面，Codex 的 code mode 要 agent 自己查 `ALL_TOOLS` 才看得到描述；工具的返回值则每个 provider 都会放进上下文 |
| `flowly_get_task` 的返回内容 | agent 读卡时，内容由插件实时生成 | 所有 provider |
| `before("agent.create")` 改会话参数 | 会话创建时 | Claude 的 `providerOptions.extraArgs` 可以给 Claude Code 传 `--settings`（里面可以配 hooks）。Codex 的 provider 选项里没有对应项 |
| `agent.turn_started` / `agent.turn_ended` | 回合开始、结束之后通知插件 | 只能事后观察，按你的决定不用来补救 |
| `agents.ref(id).send` | 给会话发一条消息 | 会多开一轮，属于事后补救，不用 |

插件没有能在回合进行中拦截 agent 的钩子，也改不了已经在运行的会话的 system prompt。要让 agent 当回合自己做到，只有三条路：
- skill 写得让 agent 在每种回合都想得起来；
- 把要做的事放进 agent 本来就会调用的工具里；
- 在 agent 动手的那一刻把要求放到它眼前。目前只有 Claude 能做到这一条。

### 建议（按投入从小到大）

1. **重写 skill 的核心，按 agent 自己的动作来触发，覆盖每一种回合。**
   - 开头放一张短表，格式是“你做了 X → 当回合就做 Y”：
     - 改了代码：先设 development，再更新 workpad；
     - 跑了检查：记到 workpad；
     - 开了 PR/MR：用 `flowly_add_artifact role=output` 登记；
     - 提交、合入、返工、验证这类短回合也算：结束时照样交付或报告结果，并带上 next moves。
   - 其余细节放到后面。删掉 “before starting a work phase” 这类会被当成例外的说法。
   - 写法与模型无关：用祈使句和固定格式，不依赖某个 provider 独有的工具名。
   - 送达不能只靠 system prompt。Flowly 的 MCP server 目前没有返回 server 级的 `instructions`，可以在 initialize 时把这张表（加上任务标题和 card ID）作为 `instructions` 返回。这是 MCP 协议自带的字段，ACP 会话也会连上 Flowly 的 MCP server。但各客户端（Claude Code、Codex、Gemini CLI 等）会不会把它展示给模型，要逐个验证。
2. **把要做的事放进交付调用的参数里。** #33 说明，即使交付流程完全合规，单独的登记调用也会漏。这个办法已经被证明有效：next moves 做成 `update_status` 的参数之后，27 次交付全部带上；ideas 只靠提醒，16 次一次都没跟进。照这个办法：
   - `update_status(in_review)` 和 `report_progress(result)` 增加 `outputs` 参数，填这一回合交付的 PR/MR 链接和文件，没有就传 `[]`。漏传时和 nextMoves 一样返回提醒。
   - `acknowledgeOpen=true` 只在同一组未完成项已经被 `WORKPAD_OPEN` 拒绝过一次之后才接受，让 agent 至少看一次清单。
   - ideas 要不要也这样做：你之前定过“0 个也可以”，所以可以不做。
3. **让 `flowly_get_task` 返回当前的回合清单（第 1 条那张表）。** 会话的 system prompt 在创建时就固定了，skill 却已经改了 14 次，长期使用的会话一直看到旧规则。get_task 由插件实时生成，把清单放进去，老会话一读卡就能看到最新要求。
4. **（可选，仅 Claude，不属于核心方案）Claude 会话：在动手的那一刻把要求放到眼前（要先验证可行）。** 只有在 1–3 上线后 Sonnet 仍然明显落后时才考虑。 插件在 `before("agent.create")` 里通过 `providerOptions.extraArgs` 给 Claude Code 传 `--settings`，配两个只提示、不拦截的 hook：
   - `UserPromptSubmit`：每回合开始时，附上一两行卡片现状（当前阶段、workpad 有几项过期、上次交付之后有没有新改动），再附上那张表。这正好补上“后续回合想不起来”的缺口。
   - `PostToolUse`：Bash 命令匹配 `gh pr create`、`glab mr create` 或 `git commit` 时，附一句“你刚开了 PR，把它登记为 output”或“你刚提交了，更新 workpad”。
   - 这些 hook 只往上下文里加提示，由 agent 自己决定怎么做，不替它做，也不阻止它结束回合。hook 命令用插件已经下发的 CLI（`flowly.mjs`）和每个会话的 context file 来实现。
   - 风险：要先确认两点，Paseo 会把 `extraArgs` 原样传给 Claude Code，而且 Claude Code 在 SDK 模式下会读取 `--settings` 里的 hooks。Codex 没有对应入口，只能靠第 1–3 条。
5. **用同一套脚本衡量效果。** 上线后跑 `audit.mjs --since <上线时间>`（Claude）和 `audit-codex.mjs --since <上线时间>`（Codex），按模型对比三个数字：后续回合不调用 Flowly 的比例、PR 登记率、预先 acknowledge 的比例。这只是统计，不做补救。

建议顺序：先做第 2 条，它最通用，跟模型和 provider 都无关；再做第 3 条和第 1 条（包括 MCP `instructions`）。三条都只改插件自己的工具和文字。做完在 Tinylink 上分别用 Sonnet（Claude）和 GPT（Codex）会话复现“交付 → 创建 PR 并合入”这个场景，再按模型重跑统计。另外要单独开一个 ACP 会话（如 Hermes）确认它能不能拿到规则。第 4 条只在 Sonnet 仍然明显落后时再考虑。

## 局限

- `audit.mjs` 按回合统计只覆盖 Claude 的 transcript。Codex 另用 `audit-codex.mjs`：10-19 起有 18 个 Codex 卡片会话，其中真实卡片会话只有 5 个，其余是验证用的临时会话。Codex 的结论是方向性的。
- 没有任何 ACP、OpenCode 或 Pi 的卡片会话数据。这几类 provider 怎么收到规则，只是读 Paseo 代码得出的结论，没有实测。
- Bash 写文件靠命令模式识别，可能多算（例如 `cat > /tmp/pr.md`）或少算。CLI 方式的 Flowly 调用只按命令里的第一个子命令归类。最终的 PR 登记数以 `gh pr list` 和看板的对照为准（6/23）。
- 10-21 之前的旧标签会话（`ultra-kanban-task`）不在按回合统计的范围内。
