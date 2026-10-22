# 独立审查：回合清单与统计校准

- 日期：2026-10-22
- 审查会话：`6698b422-7a2f-4b1e-b58e-5739bf2a485d`
- 范围：`docs/TURN-CHECKLIST-SPEC.md`、统计审计核心及两个入口、清单服务/Schema/skill/对应测试。
- 限制：只读审查；本报告为本会话唯一写入。没有创建临时 fixture 文件、Paseo 资源或宿主操作。

## 结果

### PASS

- `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs`：14/14 通过（在主会话增补审计边界后重跑）。覆盖两个入口、项目隔离、子 agent 排除、旧 session 窗口分母、显式样本分组、完整 PR URL、失败退出、回执时 artifacts 快照、未答复的 MCP 登记调用，以及回执重放。
- 审计中先解析完整对话，再按回合起始时间筛选；`first` 在筛选前确定，回执按回合时间区间及 agent/task 归属过滤。项目当前 task 通过 projectId，已删除 task 通过对应项目完整 flow 文件历史归属；子 agent 依据 parent-agent 标签排除。两个入口共享 `audit-core.mjs`。
- 主会话提出的三项修正已见于当前代码：非零 `exit_code` 会阻止确认 PR URL（`audit-core.mjs:129,192`）；每个 receipt 优先匹配同次响应的 `current.artifacts`，避免后来 role 修改倒灌历史（`audit-core.mjs:188-189,243-246`）；未返回的 MCP add_artifact/update_status/report_progress 会标登记状态 unknown（`audit-core.mjs:180,230`）。对应测试通过。
- 清单由 `shared/turn-checklist.ts` 单一导出；`skill-source.ts` 编号渲染同一数组，生成的 `skills/flowly/SKILL.md` 有逐字一致测试。`AgentService.get` 每次返回数组副本，`toolContextSchema` 将新增字段设为可选、最多 8 项，兼容旧结果且新服务仍返回 6 项。`agent-service.test.ts` 检查读取前后 board 文件内容相同，并检查调用方改写返回数组不会改变下一次读取。
- 保留了旧卡的只读 scope 解析路径；已有服务测试验证 legacy 多仓目录仍返回且不会因读卡重挂/迁移。MCP `flowly_get_task` 标注 `readOnlyHint: true`，走 `AgentService.get`。
- 主会话消息称：typecheck、57 个聚焦测试和重载后的当前旧会话 CLI `current` 已通过，收到 6 项清单且 board hash 未变。此为主会话提供的结果，本审查未重复运行。

### FAIL

1. **回合分母漏掉仅含图片的用户消息。** `audit-core.mjs:148-150` 只从 `text`/`input_text` 提取内容；没有文字的 image block 得到空字符串，不会建立新回合。合成复现：Claude transcript 依次包含 `00:00` 文本用户消息、`00:05` `content:[{type:"image",...}]` 用户消息、随后 get_task；`parseTurns` 只返回 `00:00` 一回合。若图片消息开始新工作回合，后续调用会被并入前一回合，`first`/时间窗分母错误。建议识别有实际 user content 的 image/input_image block 为回合边界，同时不把空消息/元数据误计为用户回合。

2. **CLI 引号参数中的文字可伪造 acknowledgeOpen。** `shellInfo` 在整段命令字符串上分别全局搜索 `status in_review` 和 `--acknowledge-open`（`audit-core.mjs:102-109`），不解析 shell argv。精确复现命令：
   `node '/x/flowly.mjs' status in_review --note 'Use --acknowledge-open only after refusal' --outputs '[]'`
   该 argv 没有 acknowledgeOpen 开关，但当前结果为 `acknowledgements:[{kind:"upfront"}]`。这会误报提前确认尝试并污染 ack 分组。建议对静态 shell argv 做保守解析；含动态/无法分词的命令标 unknown，不从 note 内容推断旗标。

3. **未答复的 CLI artifact 登记调用没有标为 unknown。** pending 结束时只把未答复的 MCP 名称 `add_artifact/update_status/report_progress` 标记为 unresolved（`audit-core.mjs:180,230`）；CLI 形式记为 `cli:artifact`，不匹配该集合。精确复现：同一回合成功观察 `gh pr create` 返回 `https://github.com/o/r/pull/7`，随后发起 `node '/x/flowly.mjs' artifact --role output --target 'https://github.com/o/r/pull/7'`，但 transcript 没有该调用的结果。当前 `prRegistration` 为 `missing`，规范要求没有登记结果时保持 `unknown-registration`。`audit.test.mjs` 新增的“unanswered registration”只测 MCP update_status，未覆盖 CLI artifact/status/result。

4. **`evidence()` 返回值会原样保留产物 target 中的 URL 凭据。** `audit-core.mjs:134-135` 将 `a.target` 直接放入 evidence。精确复现：target 为 `https://github.com/o/r/pull/7?access_token=secret`，`JSON.stringify(evidence(...))` 仍包含 `access_token=secret`。当前 `runAudit()` 对外 turn 结果没有直接导出该原始 evidence/artifact target，且 PR URL 会经 `prUrl()` 归一化，所以本次未复现 CLI 报告泄漏；但导出的 evidence helper 及其“仅公开证据”契约不满足脱敏要求，后续复用会泄漏。建议移除原始 target，或只保存已规范化的 PR/MR URL/白名单字段，并加 query/userinfo 凭据测试。

### UNRUN（本独立审查未运行）

- `npx vitest run server/agent-service.test.ts server/tool-server.test.ts server/skill-source.test.ts`、`npm run typecheck`、`npm test`：主会话报告已通过；此独立审查未重复执行。
- 宿主重载及真实旧会话 CLI current：由主会话负责，本审查未操作宿主；主会话报告 PASS。
- 未创建/清理额外临时数据；指定 Node 测试自身的 temp home 在 `finally` 中清理。

## 建议优先级

先修正未答复 CLI 登记与图片回合边界，它们直接改变规范要求的 unknown 状态和回合分母；随后修正 shell 参数解析与 evidence target 脱敏，并分别补针对性用例。当前 14/14 通过不覆盖以上复现。

## 复核结论（2026-10-22，按主会话要求）

初轮四项 FAIL 保留为历史记录；当前源码已针对其修复，本轮只复核这四项及空 eventId 去重补充，不扩展到其他范围。

- **PASS — 图片回合边界：** `userText` 现在识别 Claude `image` / Codex `input_image`，以及 Codex user event 的 `images` / `local_images`；仍过滤 meta/sidechain。测试 `Luna: image-only Claude and Codex messages start their own turns` 覆盖两种 provider 和 meta 排除。
- **PASS — CLI 静态 argv：** `cliCall` 逐词处理引号及参数值，`--note` 的值不会伪装成 `--acknowledge-open`；检测到变量、命令替换或 shell 运算符时将调用标为 dynamic。测试覆盖引号 note、实际 ack flag 和动态 note，分别得到 none/upfront/unknown。
- **PASS — 未答复 CLI 登记：** pending 标记涵盖 `cli:artifact`、`cli:status`、`cli:note` 和无法静态识别的 CLI 调用；结束时设 `unresolvedRegistration`。测试覆盖 artifact/status/note 三类，均得到 `unknown-registration`。
- **PASS — evidence 凭据过滤：** artifacts 只保留 `prUrl(target)` 的规范化结果；PR URL 去掉 query、fragment 和 userinfo，非 PR URL 输出为 null。新增测试确认 secret 不出现在 helper 结果中。
- **PASS — 空 eventId 去重：** receipt 缺少非空 eventId 时改用 agent/task/action/time/artifact 字段组成稳定区分键，避免多个合法无操作回执互相覆盖。新增测试确认两条空 eventId 回执能保留两个 PR 的登记结果。
- **PASS — 聚焦检查：** 再次运行 `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs`，21/21 通过，0 fail。无额外 fixture 文件或宿主资源。

本轮限定复核的五处均 PASS。初轮 FAIL 仍保留用于审计轨迹，表示修复前的复现结果，不代表当前源码状态。未运行全量测试、typecheck、Vitest 或宿主操作。
