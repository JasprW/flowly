# Fable 独立审查：回合清单（建议 1+3）与统计校准

- 审查者：Claude Fable 5.1（claude-fable-5-1），独立 reviewer，未改任何实现/测试/spec，未创建子 agent 或 native fixture。
- 时间：2026-10-22。HEAD `7f98f021867e37650e5072f60eb8163981452887`（工作树 dirty，审的是工作树内容）。
- 临时合成复现只在进程内（`node -e`）运行，无文件产物；真实 transcript/board 仅只读统计，报告不含任何用户正文。

## 结论

- 清单集成边界（建议 1）：**PASS**。单一来源、旧会话实时读取、schema 兼容、读卡不写 board 均成立，见 §3。
- 统计校准（建议 3）：**FAIL（2 个 Medium，3 个 Low）**。核心 `laterNoFlowly` 分母会被 Claude 后台任务通知行抬高；登记成功无法从回执证实时被判成 `missing` 而不是 `unknown`。当前本机样本受影响很小（见各项“实际影响”），但在用于真实样本数字前应修正。
- 没有发现影响产品行为（权限、状态、写入、回执）的缺陷。

## 1. 审查的源码 hash（sha256，工作树）

| 文件 | sha256 |
|---|---|
| shared/turn-checklist.ts | 982231e5460fe139f883e22a059a6beb88ec45bf0de2e8144cbcced6018696a4 |
| server/skill-source.ts | 6c5e3a42f1bd74143a80a36b02b51079688ee5ce2b34024697db72ecffec64e6 |
| server/agent-service.ts | ebf35207e44a3f8c5a8f4bbe6bb941aef993493eb880696d4875964572081d79 |
| shared/tools.ts | 1a1109fc10b99773c18d9711d2dd7d027b58bee788b6d8255fb5fac5001321dd |
| server/tool-server.ts | 5f581a0f17969dd28db0eeabf5ab0792462d084f6094f0579c989899d9dca51e |
| skills/flowly/SKILL.md | 78cfb2a7c1f5ba8b359d1039b4f387a379c96fe6b6e35fbfede5465cbeac7d6f |
| server/skill-source.test.ts | e44927ea9d0821033b80e524120795655c090c5e10cb746a6d77ecfb843335d7 |
| server/agent-service.test.ts | 4f901e4bea1269fe4e00cc51cd6bb7e31dcbf62e8b724d7e961cf22584b18ea0 |
| server/tool-server.test.ts | 222e80686b3a1bef9ccb6c61a0be87c778924b881c4154f51aeb3f4da509338d |
| docs/verification/flow-constraints-audit-2026-10-22/audit-core.mjs | 6579b50212378262fe4fb8dc24b22c96fc71a2320bc8fa449d3341cd5ad4178a |
| …/audit.test.mjs | 31f6eec9a4efdb24c23fed7b9e8f54a9a750503b83896f6db93e4114d6a96ed9 |
| …/audit.mjs | 61656a0647233556f91f3b7703522fec90547e4c10b8da7eba8514ce6696e44b |
| …/audit-codex.mjs | 0211a341345644f5cc0ad611c8b06914e3e9ee65d9325fb8cc9da330505356c3 |
| …/README.md | cb6d7fc0b2f84f73eb938cca6103f1ac3efdfda1f31a6f985cb26ea0f27fd068 |
| docs/TURN-CHECKLIST-SPEC.md | f4b2a7daede6443c31753d0ba52911f4bcf9a73727ea4fe07b8a6cc76a5e5377 |

主会话 `verification.json` 列出的 6 个 hash 与上表一致（它记录的 `sha` 05de1691 是当时的 HEAD，现在 HEAD 为 7f98f021；被审文件内容未变）。

## 2. 我实际运行的检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 审计聚焦测试 | `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs` | PASS 21/21 |
| 服务/MCP/skill 聚焦测试 | `npx vitest run server/skill-source.test.ts server/agent-service.test.ts server/tool-server.test.ts` | PASS 57/57 |
| SKILL.md 与生成字符串逐字一致 | `npx tsx -e` 比较 `skillText` 与文件 | PASS（20166 字节相同） |
| 合成复现 F1/F2/F3 | 进程内 `parseTurns`/`calibrate`（见各 finding） | 复现成功 |
| 真实样本只读统计（Claude 44 个 flowly 会话、Codex 23 个） | 自写只读扫描，仅输出计数/前缀/工具名 | 见各 finding“实际影响” |
| typecheck / 全量 `npm test` / 重载 / Luna 复查 | 未重复 | UNRUN（采用主会话记录，未独立证实） |
| ACP 指令实际送达、无工具回合提醒、长期遵守率 | 不在本次范围 | UNRUN，不作为事实 |

## 3. 清单集成边界（建议 1）：PASS

已核实（源码 + 测试 + 主会话 live-current.json 只作旁证）：

- 单一来源：`shared/turn-checklist.ts` 6 条，`server/skill-source.ts:14` 按编号渲染，`server/agent-service.ts:301` 以拷贝返回（调用方改数组不影响下次读取，`agent-service.test.ts:39-44`）。
- 旧会话实时读取：`AgentService.get` 每次读运行中模块的常量，不依赖 session 创建时的 prompt；MCP `get_task`、HTTP/CLI `current`、写入返回的 `current` 同一构造路径。
- schema 兼容：`shared/tools.ts:331` 为 `optional()`，`toolContextSchema` 是非 strict `z.object`，旧结果可解析（`agent-service.test.ts:41-42`），`toolVersion` 仍为 1，无新错误码。
- 读卡不写 board：`get()` 只读 board；写入的只有 `artifactReads.mark`（已读时间戳，单独文件，原有行为），`agent-service.test.ts` 断言 board 文件内容不变。
- `tool-server.ts:189` get 描述、`SKILL.md` 与 spec §2 描述一致；6 条合计长度 < 1800（`skill-source.test.ts:11`）。

## 4. Findings（按严重性）

### F1 · Medium · Claude 后台任务通知行被当成用户回合，抬高 `later` / `laterNoFlowly`

- 位置：`audit-core.mjs:174-186`（`userText`），排除正则在 185 行只列了 `<paseo-system|<local-command|<command-name>|[Request interrupted|# AGENTS.md|<environment_context>`。
- 事实：Claude Code 在后台 Agent 完成时写入 `type:"user"` 行，正文以 `<task-notification>` 开头，`isMeta` 为 false，有 `timestamp`，附带 `promptSource:"system"`、`turnOrigin:"task_notification"`、`origin.kind:"task-notification"`。本机 `~/.claude/projects` 中共 272 行（无一 isMeta），另有 `<local-command-stdout`（6）、`<ide_opened_file`（5）、`<chat-history-summary`（5）同样不被排除。
- 最小复现（进程内）：`[user(t0), user(t1), get_task, <task-notification 行@t1+5min>, Edit]` → 窗口内 2 个 later 回合，`laterNoFlowly=1`、`editedLaterNoFlowly=1`；正确值应为 1 个回合、0。真实回合的 `until` 也被切到通知时间，通知之后的回执被归到幻影回合。
- 实际影响：Flowly 项目的 44 个 Claude 会话中 2 个含此类行，共 3 个幻影回合（对比 294 个真实回合）；主会话 11:52–12:23 窗口样本不含此类行，故 `claude-audit-v2.json` 数字未受影响。但任何使用后台 Agent 的会话都会系统性被高估"无 Flowly 调用回合"，与 spec §3 "不推断回合" 相悖。
- 建议：在 `userText` 中跳过 `row.promptSource === 'system'` 或 `row.turnOrigin === 'task_notification'` 的行，并把 `<task-notification`、`<local-command-stdout`、`<ide_opened_file`、`<ide_selection`、`<chat-history-summary`、`<command-message` 加入前缀排除；补一条 `audit.test.mjs` 用例。

### F2 · Medium · 登记尝试已应答但无法提取回执时判为 `missing`，不是 `unknown`

- 位置：`audit-core.mjs:224-237`（`response` 只在输出里能解析出 receipt/error 时记录证据）、`272`（只有未应答才标 `unresolvedRegistration`）、`300-301`（有 opened 无 registered 且无 unknown → `missing`）。
- 事实：Codex code mode 的 `custom_tool_call_output` 只是脚本打印的内容；脚本不打印结果时输出为空。Claude CLI 路径同理（`> /dev/null`、`| head` 等）。回退到 board `agentReceipts` 只覆盖 7 天：`server/agent-service.ts:607-609` 每次写入都会清掉过期回执。
- 最小复现（进程内，无 board）：Codex `exec` 内 `exec_command({cmd:"gh pr create"})` 输出 PR 链接，随后 `tools.mcp__flowly__flowly_update_status({status:"in_review",outputs:[{target:PR}]})` 输出为空 → `prRegistration:"missing"`，`receipts:0`。Claude `node flowly.mjs status in_review --outputs … > /dev/null` 同样 `missing`。
- 实际影响：7 天内的真实样本可由 board 回执补救（主会话样本在 7 天内，未受影响）；超过 7 天、卡片已 Remove/Delete（回执随 board 删除）或代码模式脚本不打印结果的回合，会把"无法确认"报成"未登记"。此外 `audit-core.mjs:284` 的 `receipt:<action>` 回退（包装脚本的 Flowly 调用）在回执过期后失效，`laterNoFlowly` 也会被高估。spec §3 要求"无法确认…保持 unknown"。
- 建议：`call()` 记录 registration 尝试后，若其应答中既无 receipt 也无 error code，标记 `turn.unverifiedRegistration = true` 并在 `prRegistration` 中归入 `unknown-registration`；README 注明 board 回执仅保留 7 天，超窗审计必须依赖 transcript 中打印的结果。

### F3 · Low · Codex 顶层 `shell_command` / `shell` 工具不被识别

- 位置：`audit-core.mjs:265` 正则 `/exec_command|apply_patch|write_stdin/`；`audit-core.mjs:92` code-mode 内同样只认 `exec_command|apply_patch|write_stdin`。
- 事实：本机 Codex rollout 中 `shell_command`（参数 `{command: string, workdir}`）52,456 次、`shell`（`{command: string[]}`）2,295 次，`exec_command` 3,875 次。走这两种工具的 `gh pr create` 与 `node flowly.mjs …` 全部不可见。
- 最小复现：`function_call name:"shell_command" arguments:{command:"gh pr create --fill"}` + 同类 CLI `status in_review` → `prAttempts:0, flowly:[], prRegistration:"not-applicable"`；同样内容用 `exec_command` → `prAttempts:1, flowly:["cli:status"]`。
- 实际影响：Flowly 项目 23 个 Codex 会话（gpt-6-luna / gpt-6.1-sol）全部使用 `exec` code mode，内部 `exec_command(` 437 次、无 `shell_command(`，所以当前样本不受影响。关闭 code mode 或旧版 Codex 的会话会被整体算作"零调用"，且 `shell` 的数组 `command` 传给 `shellInfo` 时会被字符串化、`cliCall` 按字符遍历失效。
- 建议：顶层与 code-mode 正则都加入 `shell_command|shell`，`command` 为数组时取 `bash -lc` 后的脚本字符串，否则标 dynamic。

### F4 · Low · skill 内"Start of every turn, step 2"交叉引用已失效

- 位置：`server/skill-source.ts:32-33`（= `skills/flowly/SKILL.md:32-33`）。
- 事实：旧清单第 2 条是"Fix setup.missing（type/tags/workpad）"；新清单第 1 条是"fix setup.missing"，第 2 条变为"Before changing code: set development and write workpad…"。tags 与 type 两条仍写"at the start of the work (Start of every turn, step 2)"，现在指向错误条目。测试只校验编号行存在，不校验引用。
- 建议：改为"step 1"或去掉编号引用。agent-facing 文本，无 i18n 影响。

### F5 · Low · 两个入口默认 `--since` 不同

- 位置：`audit-core.mjs:22`：codex 默认 `2026-10-19T00:00:00Z`，claude 默认 `2026-10-21T06:00:00Z`。
- 事实：README 要求"固定同一时间窗口…用 v2 重算两侧"，但不带 `--since` 直接运行两个入口得到的是不同窗口，且输出里的 since 容易被当成"同一口径"。
- 建议：两边同一默认值，或要求显式 `--since`（缺省即报错）。

## 5. 已核实无问题（覆盖范围）

- 时间窗口：先解析完整历史再按 `t.at ∈ [since, until)` 筛选，`first` 来自整个会话，old/new 按 createdAt（`calibrate` 279-296；测试 22-28）。
- 回执匹配：成功需 receipt 的 `artifactId(s)` 对应 role=output 且规范化 PR URL；优先回执当时的 `current.artifacts`，后期改角色不回溯（63-66 测试）；eventId 去重，失败/`is_error` 不计。
- 多 PR 完整 URL 比对、不同仓库同号不混淆（`prUrl` 取 origin+pathname）。URL 带尾随 `)`、`.` 时判为 `unknown-creation`（保守方向，可接受）。
- ack 分类：`attempt()` 在 tool_use 时判定、`refused` 在 tool_result 时设置，顺序正确；多调用批次置 unknown；`cat` 出的 `WORKPAD_OPEN` 文本不算拒绝（`use.flowly` 门槛）。真实 Claude 样本两回合均为 `upfront → after-refusal`，与新门禁"首次总是拒绝"一致，不是误分类。
- 项目隔离/子 agent：按 `labels['flowly-task']`、`paseo.parent-agent-id`、board 任务归属或 flow 历史筛选；未标记样本只称 unclassified。
- 隐私：`evidence` 只导出 eventId/action/status/at/artifactId(s)、错误码、规范化 URL（`origin` 丢弃 userinfo，`pathname` 丢弃 query）；`--turns` 不含用户正文；Codex 只做 AST 读字面量，无 eval。
- 参数错误非零退出；`--repo` 兼容吞值。

## 6. 剩余风险（未证实，不作为事实）

- `gh pr create` 的识别是源码启发式：heredoc/注释/`echo` 中出现也计入 `prAttempts`，README 已声明。
- CLI 动作位置不在 `flowly.mjs` 之后第一个位置（例如 flag 在前）时判为 `cli:unknown`，不做 ack 分类；skill 给出的命令格式不会触发。
- 被硬删除的 summarizer 子会话若删除失败而被归档，其 agent 记录带 `flowly-task` 标签且无 parent 标签，会作为"仅首回合"会话被读入，不影响 `later` 分母。
- `userText` 把 `<paseo-system kind="agent-message">` 视为非用户回合：由其他 agent 驱动的会话（如本 reviewer 会话）在审计中为 0 回合，这是口径选择，不是缺陷，但 README 可以写明。

---

# 复核（第二轮，2026-10-22）：F1–F5 修复确认

范围限定为初轮五项 finding 与对应回归；未重做完整审查，未重复全量/57 个服务测试。HEAD 仍为 `7f98f021867e37650e5072f60eb8163981452887`（工作树 dirty）。初轮报告原文保留，含当时的 FAIL 与 hash。

**编号勘误**：初轮把"建议 1+3"理解为"清单集成 + 统计校准"。按主会话说明，建议 1+3 指 skill 与 get_task 清单，统计校准是原建议 5。初轮 §3 对应建议 1+3，§4 F1/F2/F3/F5 对应建议 5，F4 属于建议 1+3 的 skill 文本。结论不受影响。

## 复核结论

- 建议 1+3（skill 与 get_task 清单）：**PASS**。F4 已修复。
- 建议 5（统计校准）：**PASS（带 1 个新的 Low 剩余风险）**。F1、F2、F3、F5 均已修复并有回归测试；见 R1。

## 复核时的源码 hash（sha256，工作树）

| 文件 | sha256 |
|---|---|
| docs/verification/flow-constraints-audit-2026-10-22/audit-core.mjs | 0f41289f1e386f20eace7d985f919cc50367753005116c3f3a5f78628a554ff5 |
| …/audit.test.mjs | 99492796aeb6b0618424e10000114e47d97d7ca677a42129b73a88422bfaa3da |
| …/README.md | 7e20c43d8a25ab57b27e2141a70056e514fa771484f73292a8ae10b44fc5e698 |
| docs/TURN-CHECKLIST-SPEC.md | 67e7e35ab225da0dab782c8125d02778c8c9e27a372d2d20402604155b77956a |
| server/skill-source.ts | bca39875cd2d476a883befb826aab7902f860fe27cc638272441743339b1b6a9 |
| skills/flowly/SKILL.md | a6d92d5e699af81a4e44e1bc0f7ec9a300addea6253557ed1759de1da9aa435d |
| server/skill-source.test.ts | 96bb866f1c04b5a0c9aeb3d79ee583610c930700a400a22fffa1ceb6243fa11d |
| shared/turn-checklist.ts | 982231e5460fe139f883e22a059a6beb88ec45bf0de2e8144cbcced6018696a4（未变） |
| docs/verification/turn-checklist-2026-10-22/verification.json | cc8b8b845d2dd72d91d27ce55f7129edbe20731f4ea764f7c01e7bf6bb054eb6（sha 已改为 7f98f021867e，产品源码 hash 与初轮一致） |

未列出的产品文件（agent-service.ts、tools.ts、tool-server.ts 及其测试）本轮未改动、未复审。

## 我实际运行的检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 审计聚焦回归（含 3 个新 Fable 用例） | `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs` | PASS 24/24 |
| skill 一致性（SKILL.md 逐字 = 生成字符串，且不含 `Start of every turn, step \d`） | `npx vitest run server/skill-source.test.ts` | PASS 1/1 |
| F1/F2/F3 初轮合成复现重跑 + 新增反例 | 进程内 `parseTurns`/`calibrate`/`summarize` | 见下表 |
| 真实 Codex 样本只读统计（23 个 flowly 会话、595 个 code-mode 脚本） | 自写只读扫描，仅计数 | 见 R1 |
| typecheck / 全量 / 57 服务测试 / 重载 / Node 24 回归 | 未重复 | UNRUN（采用主会话记录） |

## 逐项确认

| 项 | 修复位置 | 复现结果（修复前 → 修复后） | 回归测试 |
|---|---|---|---|
| F1 通知行幻影回合 | audit-core.mjs:175-176（promptSource=system / turnOrigin=task_notification / origin.kind）、:186（`<task-notification`、`<local-command`、`<command-message`、`<ide_opened_file`、`<ide_selection`、`<chat-history-summary` 前缀） | 前缀型、仅元数据型、`<local-command-stdout` 三种：2 回合/laterNoFlowly=1 → 1 回合/0 | "Fable F1" PASS |
| F2 空应答判 missing | audit-core.mjs:236-237（应答无 status/progress/artifact 回执且无错误 → `unverifiedRegistration`）、:309 | Codex code-mode 静默脚本：missing → unknown-registration；同一回合有 board 回执 → pass；Claude CLI `> /dev/null`：missing → unknown-registration；反例：登记调用返回 `REVISION_CONFLICT` 仍为 missing（正确，确实未登记） | "Fable F2" PASS |
| F3 `shell_command`/`shell` 不可见 | audit-core.mjs:92（code mode）、:211-216（bash/sh/zsh `-c`/`-lc` 三元数组取脚本，其余数组计 `unknownShellCalls`）、:273（顶层） | `shell_command` 字符串、`shell` + `bash -lc`、`zsh -c`：prAttempts 0 → 1，flowly [] → [cli:status]；裸 argv `["gh","pr","create"]`：unknownShell=1、prRegistration=not-applicable（见 R2）；code-mode `shell_command(...)` 识别 cli:status | "Fable F2/F3" PASS |
| F4 skill 失效引用 | server/skill-source.ts:32-33 改为"(Start of every turn)"；SKILL.md 同步；skill-source.test.ts:13 新增断言 | — | PASS |
| F5 默认 since 不一致 | audit-core.mjs:22 两入口同为 `2026-10-21T06:00:00Z`；README:15、SPEC:39 已写明 | — | 参数测试 PASS |

README:26 的 `laterObservable`/`laterUnknownFlowly` 与 summarize（audit-core.mjs:316-319）一致；README:28 已注明 board 回执仅保留 7 天。

## 剩余风险

- **R1 · Low · code mode 动态命令按空命令处理，不计入 `unknownShellCalls`**。`scriptCalls` 对模板字符串含 `${}` 或标识符参数返回 `{dynamic:true}`（audit-core.mjs:90-93），`call()` 在 :211 取 `cmd` 得到 `''`，走正常路径而非 :214/:216 的 unknown 分支。合成复现：`exec_command({cmd: \`node ${cli} --context-file ${ctx} current\`})` → `flowly: []`、`unknownShellCalls: 0`、该回合计入 `laterNoFlowly`（`current` 是读，board 无回执可回退）。实际影响：真实 23 个 Codex flowly 会话的 818 个 code-mode shell 调用中 15 个为动态参数，其中 0 个出现在提到 `flowly.mjs` 的脚本里；另有 4 个脚本文本含 `flowly.mjs` 但未检出调用（未逐个核对，可能是注释/字符串或动态拼接），当前样本影响为 0–4 个脚本。建议：`c.input?.dynamic === true` 时也 `unknownShellCalls++`，并补一个用例。
- **R2 · Info**：裸 argv 数组（非 `-c/-lc` 包装）计入 `unknownShellCalls`，但 `prAttempts` 仍为 0，`prRegistration` 为 `not-applicable` 而不是 unknown；README 已声明"其余 argv 单列"，`laterUnknownShell` 可见，口径一致，只是 PR 相关分母不会把它当潜在创建。可接受。
- 初轮 §6 其余风险（`gh pr create` 启发式、CLI flag 顺序、summarizer 归档会话、`<paseo-system>` 驱动会话为 0 回合）未变。

---

# 复核（第三轮，2026-10-22）：R1 修复确认

范围仅限 R1 及其回归。HEAD 仍为 `7f98f021867e37650e5072f60eb8163981452887`；本轮只有离线审计文件变化。

| 文件 | sha256 |
|---|---|
| docs/verification/flow-constraints-audit-2026-10-22/audit-core.mjs | de2af97964273612b06a8bc6d43e2dcde09b411897d3cb98b95baac7a36b8340 |
| …/audit.test.mjs | 70f76ec85e8043f1ec70dcbec156693f6571ada2242a6df157d61436dfcb60b9 |
| …/README.md | 7e20c43d8a25ab57b27e2141a70056e514fa771484f73292a8ae10b44fc5e698（未变） |

**修复位置**：audit-core.mjs:211-214。`exec_command`/`shell_command`/`shell` 的 `input.dynamic === true` 或无法静态读出 `cmd`/`command` 时 `unknownShellCalls++` 并跳过，不再退化为空命令；未解析的 argv 数组仍走 :216-217 的 unknown 分支。

**我实际运行的检查**

| 检查 | 结果 |
|---|---|
| `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs`（新增 "Fable R1" 用例，覆盖模板字符串、cmd 标识符、整个 input 标识符、command 数组标识符） | PASS 25/25 |
| 初轮 R1 合成复现重跑（code-mode 模板字符串 `current`） | `flowly: []`、`unknownShellCalls: 1`、`laterObservable=0`、`laterNoFlowly=0`、`laterUnknownFlowly=1`（修复前 `laterNoFlowly=1`） |
| 追加变体：cmd 标识符、input 标识符、command 数组标识符、顶层 `exec_command` 缺 `cmd` | 五种均为 unknown=1、laterNoFlowly=0 |
| 反例：字面量命令仍识别 `cli:current`；同一脚本内静态 `get_task` + 动态 shell 调用时回合仍为可观察（`laterObservable=1`，unknown 仅记数） | 符合预期 |
| typecheck / 57 聚焦 / 933 全量 / reload | UNRUN（本轮只有离线审计变化，采用主会话记录） |

**结论**：R1 已修复，建议 5（统计校准）在我审过的范围内无未解决 finding。初轮 §6 与第二轮 R2 的信息级风险不变。
