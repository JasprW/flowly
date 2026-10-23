# Fable：约束 Benchmark 设计审查

2026-10-22。审查会话 `341216af-88e1-442a-b095-5505a31165c5`，实际 `claude-fable-5-1` / `high` / `bypassPermissions`，复用当前卡片 workspace。审查对象哈希与会话记录见 [review-session.json](review-session.json)。以下只保存最终公开答复，不保存思考过程。设计原文保持不变；本轮不实现 benchmark。

## Fable 原始最终答复

**结论：修改后实施。** B01 三回合加确定性 grader 确实能重现并锁定原始失效（交付后短回合开 PR 不登记），服务端事实（receipt.artifactIds、role=output 产物、GitHub 状态）足以客观判定。但现稿有两处会让 quick 的结果失真（"首次主动遵守"对设计内拒绝的处理没定义；T1 依赖规则会吞掉 T3 观测），standard 的 B03/B04 预置依赖一条产品里不存在的人工写 workpad 路径，必须先改。

## 发现（按严重性）

**1. 阻塞 quick｜§4 C03/C05、§5 第 66 行：设计内的首次拒绝没有定义为"主动遵守失败"还是"正常流程"，基线会随解释漂移。**
机制：B01 T3 提交后 HEAD 变化，T1 的检查全部变 stale，首次 in_review 必然收到 WORKPAD_OPEN（agent-service.ts:645-661）。真实证据：两次 Sonnet 都在 T3 首次交付被拒后才重跑检查（77ce54fc 11:48:23、7d43e887 11:55:39，final-capture.json），产品报告把它们记为 PASS。按现稿"在各动作第一次应履行时是否完成"，同样的运行会被判 C03 主动 FAIL；两种读法都说得通，于是"修复前后对比"失去基线。
最小修订：cases.json 每回合声明 `expectedOpenAtFirstDelivery`（B04 为那条失败检查；B01 各回合为空）。首次拒绝的 open 列表与期望集合完全一致时记为"设计内拒绝"，不扣主动分；含 stale/unchecked/setup 等 agent 本可在交付前解决的项，才记对应规则（C03/C02/C01）主动 FAIL，恢复进"当回合"。并在 §5 明说"整例严格通过"用的是哪张表（建议：当回合最终遵守；主动遵守只作对比指标），退出码 0 据此定义。

**2. 阻塞 quick｜§3 第 41 行："T1 未正确交付"未定义，会把 quick 唯一要看的 T3 观测藏掉。**
机制：若理解为"T1 全部规则 PASS"，T1 一个 C01 顺序失误就令 T3 UNRUN，quick 对 PR 登记零观测，却可能以"无失败"收场。
最小修订：依赖改成状态前置条件：T2 需文件存在且 T1 结束；T3 需文件存在且卡片至少交付过一次（status in_review 或 result 回执）。T1 规则失败照记，不阻塞。前置条件不满足才 UNRUN(dependency)，且报告首行和退出码 2 标明"主要观测未取得"。

**3. 阻塞 quick｜§3 B01 T2 与 §4 C02"纯验证回合使用 test"会制造假失败或反向激励。**
机制：T1 后卡片已在 in_review；复验回合把业务状态退回 test 再送回 in_review，清单原文只是"use design or test to match the current work"，不是硬要求。按现稿，agent 老实重跑检查、更新 workpad、报 result 会被判 C02 FAIL；而 77ce54fc 在 T1 就自发切过 test，说明这一项只会表现为模型间噪声。
最小修订：T2 的 C02 记 N/A，除非该回合发生文件编辑（则要求 development）。T2 只评 C01、C03（真实返回码、fresh sha、未提交文件 dirty=true）、C05。

**4. 阻塞 quick｜§7 第 117 行与 §4 C04/C05：证据来源分工没写清，Codex 入参大多提不出来。**
机制：Codex 常把 `get_task` 与 `update_status` 放进同一 exec（6a79016f 中十余次），批内顺序按 §4 规则是 UNKNOWN；capture.py 对 Codex 只正则匹配工具名（第 61-63 行），audit-core 的 `literal()` 对标识符返回 undefined（第 72 行）。如果 C04/C05 依赖 transcript 入参，Codex 侧会大面积 UNKNOWN。
最小修订：写明 C04/C05 只用服务端事实：`receipt.artifactIds` 为空数组 = 显式 `outputs: []`，无字段 = 省略（DELIVERY-CONSTRAINTS-SPEC §1 第 19 行已持久化这一区分）、产物实体、flow 事件、gh 查询。transcript 只用于 C01 顺序与 C06 的"预带 ack"，动态即 UNKNOWN。调用顺序优先取 Paseo 原生 timeline 的 `tool_call` 项（server/workflow-insights.ts:212-226 已经这样读，provider 中立），原始 ~/.codex JSONL 只用于 exec 脚本 AST。未验证：nextMoves 省略与 `[]` 是否有服务端可观测差异；若没有，v1 的 C05 对 nextMoves 只记"是否出现"，不判省略。

**5. 阻塞 quick｜§8 第 125 行"隔离 worktree 的一次性 Git 管理区"与事实不符，清理与退出码会连带失真。**
机制：Paseo worktree 与 Tinylink 主 checkout 共享 `.git`（refs、config、remote）。上轮 4 个 `test/delivery-*` 本地分支至今留在 Tinylink `.git`，原因是沙箱拒绝删 ref（delivery-constraints 报告第 60 行）；Codex 自建临时 Git 数据库是 agent 行为，不能当设计前提。按 §8 第 131 行和 §9 退出码，同样环境下每次 quick 都会 cleanup=FAIL、退出 1。
最小修订：删掉"一次性 Git 管理区"措辞，改为：分支 ref 位于 Tinylink `.git`，清理 = `tasks.delete`(archive) 移除 worktree + 在主 checkout `git branch -D <本次前缀>`；preflight 先在 scratch ref 上验证 runner 进程有删 ref 权限，没有就 UNRUN 而不是开跑；对比前后 `git for-each-ref`、`git remote -v`、`git config --list`，fixture 说明保留"不得 add remote"。另外"固定远端基线 commit"做不到（每次合入都推进该仓库 main，第 129 行自己也要求保留历史）：改为本地 Tinylink main 固定为 worktree 基线，manifest 记录当时远端 main sha，PR 只新增唯一文件。

**6. 阻塞 standard｜§3 B03"以正常工具添加一项 workpad 验收"、B04"卡片有一项必须执行的检查"：产品没有人工写 workpad 条目的路径。**
机制：shared/rpc.ts 的人工 workpad RPC 只有 `workpads.check`、`resolve-confusion`、`refresh`；WORKPAD-SPEC 第 17 行明确 v1 不做人工新增/编辑条目。要预置只能用一个"设置用 agent 身份"走工具端点，会留下非被测身份的 by=agent 条目和回执，也和"预置来自受支持工具/RPC"的本意相悖。
最小修订：B04 改为描述里写"执行 {check}，把真实结果记入 workpad，如实交付"，由被测 agent 自己写检查项：记 fail → open → 首次拒绝 → C06 路径；记 pass → C03 FAIL（runner 已知确定性退出 1）；不记 → C02/C03 FAIL。B03 的"新要求"改为 `tasks.update` 改描述（task revision 变化，get_task/current 可见）加一个 unread input。两者都要用 `tasks.create` 预置 type/tags，避免 SETUP_INCOMPLETE 混进拒绝列表。

**7. 仅 standard｜§3 B02 的"unread 返工"名不副实，证据可以更简单。**
机制：CARD-ARTIFACTS-SPEC §4.2：从未读过卡的 session 全部产物都是 unread，所以新 session 的 B02 测的是"动工前读 inputs"，真正的"新到 unread"只在 B03（已读过卡的旧会话）出现。
最小修订：改名为"输入驱动返工"；C01 证据直接用 marker：marker 只存在于 input 文件，它出现在目标文件即证明读取先于写入，不需要工具顺序解析。切回 development 可行（in_review 非 finished，不触发 TASK_FINISHED）。

**8. 仅 standard｜§3 B03 的接入机制与回合划分缺细节。**
机制：显式接入 = `tools.prepare-existing` + `agent.send(prepared.instructions)`（client/session-preview.tsx:955-965）。这次发送本身是一个用户回合，指令里就有"Read current context before any work"，agent 很可能当场开工；而 `managedIdentity`/turn_started 清空门槛记录只在接入后生效。
最小修订：定义 T0 为接入回合、不计分；等 idle 后再改描述/加 input（否则不是接入后新变化）；再发 T1。B03 的 C06 默认 N/A，发生拒绝时才评。

**9. 仅 standard｜§4 C06 把拒绝链写成单次。**
机制：门槛 fingerprint 含 workpad revision 和 HEAD（agent-service.ts:648-656）。B04 中 agent 在拒绝后补 evidence 再确认，会再次被拒，这是产品行为。
最小修订：grader 接受 拒绝→workpad 写→再拒→ack 的链，§9 正反例加这一条。另外 C05 的"agent 不得自行设 Done/Cancelled"删掉：agentStatuses 不含 done，`moveTo:"done"` 只是给用户的按钮，工具层面不可能发生，这项永远 PASS 只是凑数。

## 保留、简化、延后与顺序

保留：B01 三回合与模板措辞；三组分开报数、P/F/U + VALID/INVALID/UNRUN、不做加权总分、保留首次失败；manifest 记 model/mode/transport、禁止 best-of-N；ownership.json 随动作落盘；quick/standard/confirm 只是配置。

简化（quick 前）：§2 的"运行 bundle 哈希"改为数据目录 SKILL.md 哈希 + 源码 tree/dirty patch 哈希即可，客户端 bundle 与此无关；§7 的 evidence.mjs 以 Paseo timeline 为主源；grader 的首批正反例直接用已保存的 initial-complete.json（真实 ARTIFACT_INVALID、WORKPAD_OPEN）和 final-capture.json（成功登记），不必手造。

延后：C03 squash tree 等价备注（不是遵守项）；§7 断线后续发消息的恢复（崩溃即 INVALID，只保证 `cleanup --run` 可独立重跑）；`compare` 子命令（有第二次运行再做）；§9 契约层迁移公共 helper（现有 vitest 直接引用命令即可）；§4 C01 对 Codex shell 内编辑的首次编辑时点，接受 UNKNOWN。

推荐顺序：先改 spec 的 1、2、3、4、5（quick 必需），6 至 9 同时改文字但实现放第二步；然后 grade.mjs 纯函数 + 既有证据做正反例；再把 live.mjs 的硬编码改 manifest 驱动跑一次 quick；通过后再做 B02–B04。

## 来源

实际读取：CONSTRAINT-BENCHMARK-SPEC.md 全文；shared/turn-checklist.ts；TURN-CHECKLIST-SPEC、DELIVERY-CONSTRAINTS-SPEC；audit README 与 audit-core.mjs 全文；live.mjs、capture.py、verify.py、results.json、final-capture.json 的调用序列、remaining-options.md；delivery-constraints 与 turn-checklist 两份报告；server/agent-service.ts（turnStarted、get、交付门槛段）、server/delivery-gate.ts、shared/tools.ts 状态/outputs schema、shared/workpad.ts 新鲜度、shared/card-setup.ts、shared/rpc.ts 的 tasks/artifacts/workpads/tools RPC、server/tool-server.ts 的 prepare/prepareExisting/sessionContext、index.server.ts 的 hook 绑定、client/session-preview.tsx 的接入按钮、server/workflow-insights.ts 的 timeline 读取、@getpaseo/protocol 中 tool_call 类型存在。

未验证：nextMoves 省略与 `[]` 的服务端可观测性；Paseo timeline 中 tool_call 入参的完整程度（只确认了类型存在与产品已据此解析 shell 命令）；runner 进程实际是否受同样的 ref 删除限制；Claude 侧"等价 full-access"模式名以外的 provider 配置可见性。本次未运行模型、未创建任何资源、未改任何文件。

## 主会话复核与建议

Fable 的结论是“修改后实施”，本次审查已经完成，不等于设计或 benchmark 已通过验收。优先处理事实来源、回合依赖、可实施预置和资源归属；不按发现数量制造功能扩展。

核对后建议采纳：

- 发现 1：明确定义“预期拒绝”和“可避免拒绝”，分开首次主动遵守与回合最终遵守，写清整体通过/退出码的含义。补拒绝后更新 workpad 导致 fingerprint 变化、再次拒绝的合法链。仅提交改变 SHA 并不意味着必然拒绝：agent 可在交付前处理检查；也不能仅因 SHA 改变就断言检查不可信，须保留已有相同输入/树的证据。
- 发现 2：B01 后续回合取决于文件/会话/先前交付事实，不取决于前一回合评分全 PASS。早期 FAIL 保留，同时尽量取得 T3 观测；主要观测未取得须明确标注。但已有明确 FAIL 时不能把退出 1 改成只有未完成的退出 2，保持失败不被隐藏的优先级。
- 发现 4：C04 的主证据应为成功回执、实际 output 角色/完整 URL 和 GitHub 状态。C05 的 nextMoves 可从服务端完整 flow 的 next_moves_suggested 事件读取，[] 也会持久化：server/agent-service.ts 的 recordMoves 和 if(carried) 路径明确保留了空数组；因此不必降级成只计“出现过”。缺失完整证据仍是 UNKNOWN。原生 timeline 作为事实来源可取，但 exec 外层 tool_call 不能证明内部动态调用的精确顺序。
- 发现 5：Paseo worktree 共享 Git common-dir；“一次性 Git 管理区”的假设应删除。需预检 runner 清理自有 ref 的权限并核对 refs/config/remotes。固定的应是本地 fixture 的具体 commit 和内容，远端 main 可随测试 PR 前进并记录运行前后 SHA；不改动永久 Tinylink 的 main 或配置。
- 发现 6/8：B03 用受支持的 tasks.update 改描述并加 input；B04 让被测 agent 自己创建/记录检查。B03 明确接入 T0、idle 后更新材料、实际被测 T1，分母排除 T0。避免额外 setup-agent 身份，type/tags 预置齐全。
- 简化建议：先独立 grader + B01 quick；保留 ownership 与可独立重跑 cleanup。compare、自动续跑、额外场景和公共 helper 迁移可后置。旧失败/成功证据可作 grader 样本，但只在证据足够的规则上评分，不把老的 Codex 简化采集当完整时序证据。

不直接采纳的部分：

1. **发现 3 的“纯验证阶段免评”不符合现行 skill。** skills/flowly/SKILL.md 的清单要求 verification 使用匹配的 test 阶段，Details 还明确写“switch ... to test when you verify”。应按当前规则评估实际工作阶段；如果想放宽，这是另一个产品规则决策，不能由 benchmark 偷改。合法 result 汇报可以接受，不能仅因没有再次交付 in_review 扣分。
2. **发现 7 的 marker 只能证明使用过输入，不能证明第一次编辑前已读取。** 可能先编辑、后读取再写 marker；C01 的顺序仍需执行证据，无法确定时 UNKNOWN。B02 改名“输入驱动返工”可采纳，新到 unread 的真实后续回合由 B03 覆盖。
3. **bundle 身份不能只用源码/skill 哈希替代。** 客户端 bundle 与本 benchmark 无关，但运行的 daemon 实现身份仍应有证据，避免测到旧安装版本。取不到时明确限制，不伪称运行版本已确认。
4. **Done/Cancelled 不必作为正常模型得分项，但可留资源/业务不变量检查。** 工具 schema 的拦截应记在契约层，不能拿一个必然通过项抬高行为成绩。

本轮仅交付审查与上述复核。设计原文未修改，runner、模型 benchmark 和 PR 操作均未执行；需要先按确认的口径修订 spec，再实施 quick。

