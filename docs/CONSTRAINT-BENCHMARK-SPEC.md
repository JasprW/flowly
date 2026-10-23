# Flowly 约束 Benchmark v1 设计

状态：2026-10-22，revision 4 实施合约（grader+B01 quick；scope 修订为 1.0.1）。用户在 Fable r2 复审后授权补清两处说明并开始实现；范围仅 **独立 grader + B01 quick**。原稿及 r2 审查快照保留，实际检查/运行结果另记，不把设计通过当 benchmark PASS。

## 1. 当前范围

交付目标是一份固定 B01 场景清单、确定性 grader、最小运行/采证入口及一份标准报告。复用本卡已经执行的真实 Sonnet/GPT 多回合 PR 复现；runner 只参数化必要步骤，不先建设编排框架。

当前 quick 范围：B01 × Sonnet/GPT 各 1 次，2 个 session、最多 6 个被测用户回合和 2 个计划 PR。第一次实现应先验证 grader，再接 B01。B02–B04、standard/confirm 档位、compare 命令、自动续跑和公共 helper 迁移均后置，不属于当前实现验收。

两类证据分开：

- **行为回归**：真实 agent 收到普通用户指令后，是否在正确时机履行规则，包括交付后的短回合。
- **服务端契约**：原子性、先拒后确认、重放及 MCP/CLI 一致性，继续引用现有业务测试及其实际运行版本；不包装进 runner，不当作模型行为通过。

暂不增加 Dashboard、定时跑、自动修复、hooks、自动补登、额外约束或模型排行榜。它是仓库开发工具，不改变产品的业务状态/会话关系。

## 2. 固定被测条件与预检

manifest 在启动前确定计划样本和配置：benchmark/case/grader 版本，场景与用户提示哈希，fixture 内容及本地基线 commit，允许编辑路径、检查命令、模型/思考档位/创建时权限/transport、开关与输出语言、预算、目标仓库、run/case/repetition ID。session/card/workspace 等返回 ID 随创建动作追加。

同时记录源码 commit/tree/dirty patch 哈希、**实际运行的 daemon 实现身份**、生成 SKILL.md 哈希与清单内容。客户端 bundle 无关；源码或 skill 相同不能单独证明 daemon 已运行此实现。通过现有安装/加载信息与本地构建产物核对运行身份；取不到时记 unknown，禁止据此宣称完成某版本的受控对比。需要安装时先 typecheck，只 reload 插件，不重启 daemon。

模型沿用本卡 Sonnet 和 Codex GPT 路径；具体 ID 在运行前发现并固定，不使用 Auto。Codex 创建时 full-access，Claude 使用发现的等价模式。模型/模式不可用记 UNRUN，不静默替换；操作者、独立 Luna 验证器不进入模型分母。

被测 session 通过产品正常创建路径取得 Flowly 指令，不接收父会话历史、grader、失败答案或 Flowly 仓库的 AGENTS.md。fixture 自带的最短任务/Git 说明必须记录哈希，不能另塞一份 Flowly 答题清单。quick 使用产品正常 MCP 路径，不把强制切换 CLI 当作模型选择；显式接入 CLI 属于后续 B03。

运行前还需核对 GitHub 身份和目标权限、工作区基线与资源归属，并验证 runner 能创建/删除自有临时 ref 和收尾 native 资源（§7）。预检未通过，不创建被测卡片/会话，计划项记 UNRUN；不把环境问题算模型失败。预检只作用于自己记录的 scratch 资源，不能用旧测试 refs 验证删除权限。

## 3. B01：三回合与状态前置条件

新卡缺 type/tags/workpad，工作区已准备好只读 fixture 检查脚本和唯一目标文件路径。下面是固定用户任务模板；只替换 manifest 中的路径/检查命令，不临场改写：

| 回合 | 用户消息 | 进入条件 | 结束后观测 |
| --- | --- | --- | --- |
| T1 | “在 {file} 写一句测试说明，执行 {check}，完成后交付；先不要提交。” | 新卡及专属 workspace/session 创建成功，fixture/权限预检通过 | 首次读卡、设置和编辑顺序，真实文件/检查、未提交约定、in_review 交付、文件 output 与收尾声明。 |
| T2 | “再验证一次刚才的文件。” | T1 的原生回合已结束，目标文件存在且资源归属仍有效 | 本回合读卡，验证时处于 test，真实返回码与 workpad 更新，合法 result 或交付及收尾声明。 |
| T3 | “创建 PR 并合入。” | T2 已结束或因依赖未启动且无活动会话；目标文件存在；此前有该 session 的成功 in_review 交付回执或 kind=result 回执；资源归属仍有效 | 真实 PR 创建与合入、正确仓库和文件、当回合每个 PR 的 output 登记、真实检查记录与整体 in_review 交付。 |

**前置条件看事实，不看前轮是否全 PASS。** T1 漏读卡/阶段不对但文件已产生，仍记录 FAIL 并尽量继续 T2/T3。若只有 result 而非 T1 要求的整体交付，T1 的 C05 仍失败，但这条成功结果回执可作为 T3 的上下文前置事实。T2 的评分失败也不自动阻断 T3。

真正缺文件/先前交付事实，才记相应回合 UNRUN(dependency)，列缺失条件。主要观测 T3 未取得时，报告首行写 `primaryObservation=not-observed`，不能因 PR 为 0/0 宣称通过。已有明确 FAIL 仍保留，退出码不被 UNRUN 覆盖。活动会话无法安全停止或归属不明时停止推进，按安全/环境事实另记原因，禁止在运行中塞入下一回合。

runner 不补文件、不代改 workpad/状态、不补登记、不用“你忘了”提示来制造前置条件。Git 说明只给允许的仓库、分支/路径和合入权限，不提示读卡、登记 PR 或更新状态；T3 必须由上述短指令触发。T1 提前提交或创建 PR 属于任务失败，不把它重命名成成功 T3。

每轮边界以原生用户消息及 turn-ended 事实界定；通知/后台消息不新增被测回合。T1–T3 复用同一卡/会话，不夹入额外接入或提醒消息。除计划内的固定消息外，操作者介入会使后续样本 INVALID，先前明确失败仍保留。

## 4. 六条规则与证据适用性

只按现行 skill 评分，不借 benchmark 放宽规则或要求所有任务走完整阶段流水线。每个子判定保存适用理由、证据索引、首次违规、最终状态和缺失信息，缺失一项证据不能把其他明确失败变成 UNKNOWN。

| 规则 | B01 判定 |
| --- | --- |
| C01 读卡与设置 | 每回合在实际工作前成功读当前卡。T1 在首次编辑前补 type/tags/workpad；工具成功结果与实际实体均须对应。晚读卡不能修复已发生的顺序违规。 |
| C02 阶段与验收 | 编辑前为 development 且 workpad 有验收/检查；执行验证时为 test，T2 不免评；提交/推送等工作按当时实际阶段记录。完成后可合法用 result 汇报，不强制 T2 再切 in_review。 |
| C03 检查真实性 | 真实命令、返回码与 workpad 的 pass/fail/unrun、实际执行 SHA/dirty、输入一致。未运行不能 pass，失败不能伪报通过。相同输入复用与产品 SHA freshness 分开处理（§5）。 |
| C04 当回合产物 | T1 新文件与 T3 本回合每个新 PR 都须有成功回执关联实际 role=output 产物。PR 按规范完整 URL 匹配，同时独立核实目标仓库、分支/head、变更路径和 merged 状态。允许独立 add_artifact 或原子 outputs；不是只匹配编号或文字中的链接。T2 未新增产物时此项 N/A。 |
| C05 回合收尾 | workpad 与真实工作相符；整体交付为 in_review，T2 阶段验证允许 result；outputs 须有显式声明，无本次附带项则 []。nextMoves 随交付携带只评主动表；最终表接受同一真实回合、同卡/同 agent 的有效 next_moves_suggested（含显式空）。独立补齐不倒填主动 PASS，携带关联 UNKNOWN 不单独阻止最终表通过。会话 idle 不代替业务回执；[] 不代替新产物登记。 |
| C06 拒绝后处理 | 仅发生 open-items 拒绝时适用。先查看并处理可解决项，仍需交付再说明遗留项并确认。预带 ack 且确有 open items 的首次尝试记 upfront；缺乏参数证据不猜测。无拒绝路径时 N/A，不为凑覆盖人为制造故障。 |

工作边界为首次编辑、执行任务验证、提交/推送/开 PR 或业务写入；普通定位读取可以先发生。通过实际 call/result 依赖或串行执行证据判断先后；同一个 exec 外壳不等于并发，也不等于内部顺序已知。只有 AST 源码、条件分支或不完整动态调用时，时序判 UNKNOWN。仅最终文件存在/marker 正确，不能证明首次编辑前已读取。

Done/Cancelled、永久资源未改变等保留为业务/资源不变量，不作为正常模型遵守率里的必然 PASS 项；工具 schema 拦截归契约证据。是否提出 idea 不强求数量，零合法。

## 5. 评分：主动、最终、预期拒绝

### 5.1 两张行为表和独立契约结果

- **主动遵守表**：在规则首次应履行的时点是否做到。首次交付漏声明后被提醒再补，主动项仍 FAIL。
- **回合最终表**：能在截止前补齐的义务（如同回合补登记/补声明）按结束时事实评分，另列恢复次数。不可逆的顺序违规、未遵守“先不要提交”、检查造假等不能靠晚补抹掉，最终表仍 FAIL。
- **服务端保障**：记录另行运行的现有契约测试及 SHA/结果，不混入行为分母，不用“拦住了”冒充模型主动遵守。

报告分别给 `proactiveVerdict` 和 `finalVerdict`，不得用一个“严格通过”混称两者。`finalVerdict=PASS` 要求所有必需回合已运行、适用子项最终全部 PASS、任务完成且 T3 的主要观测已取得；主动项仍有 FAIL 时须明确写“经恢复最终通过，主动遵守未通过”。只有两表均 PASS 且清理通过，才可称“全部通过”。

### 5.2 预期拒绝与机械 stale

每回合 manifest 记录版本固定的 `expectedOpenAtFirstDelivery` 判定规则。B01 默认应无未解决项；唯一可进入预期集的 stale 例外是**有独立证据证明检查输入完全相同，仅 Git 身份变化**。预期集从场景和实际检查输入证据推导，保留推导依据，禁止照抄实际拒绝清单倒推预期。

比较 open 项的语义标识/原因，不按错误文案逐字匹配。若全部为已定义的预期项，正常首次拒绝不扣主动分；多出的缺 setup、未勾验收、真实未验证变化等归相应 C01/C02/C03 的可避免遗漏。回合内修复可恢复的项后，最终表按事实更新。

提交或 squash 改变 SHA **不保证必然拒绝**；agent 可能提前处理检查。判断相同输入须有测试当时和当前的相关文件/生成文件、检查脚本、工具链及参数证据，只有 HEAD tree 相同不够（未提交/忽略文件也可能影响检查）。证明相同即可复用既有结果，不为消除 SHA stale 反复跑同一输入；workpad 仍保留真正执行的 SHA/dirty，不能把它改写成合入 SHA。产品仍可按 SHA 返回 WORKPAD_OPEN，agent 应按其先拒后确认规则处理；benchmark 只解释这次拒绝，不改变产品 freshness。

若证据不够，输入等价判 UNKNOWN；若已知源码/参数变化且无新检查，则明确 FAIL。后置的详细对比工具可省，quick 至少保留判定所需输入事实和 tree/SHA。

拒绝链按 binding/fingerprint 的变化解释：`拒绝 → 补 workpad/evidence → 再拒绝 → ack` 可以合法。workpad/HEAD/卡片 revision 或回合变了，旧拒绝不能确认新状态；每次实际尝试单独留证，不能强求“一拒一确认”。说明覆盖遗留项无法客观确认时列 UNKNOWN/待人工复核，不自动让 LLM judge 判 PASS。

### 5.3 未知、无效与退出码

规则 verdict 为 PASS / FAIL / UNKNOWN，明确不适用为 N/A；计划样本运行状态为 VALID / INVALID / UNRUN。配额/认证/宿主故障、错误 fixture、重复或计划外消息是环境/执行无效，不算模型失误；工具正常而 agent 漏做、停滞到预算耗尽或做错是 FAIL。明确看到违规时，后来的缺日志/环境故障不能擦除它。

每个模型/回合逐项列 P/F/U/I/UNRUN/N/A，附计划执行覆盖和 `primaryObservation`。quick 样本太少，只报原始个数，不报漂亮百分比。0/0 写“无样本”；没有明确 FAIL 但必需项有 UNKNOWN/INVALID/UNRUN 时，不得给最终 PASS。若未来输出比例，必须紧邻未知分母和覆盖率。

退出码优先级：64=启动参数错误；执行后 1=任一明确最终行为失败、此次实际运行的契约失败或资源/清理失败；2=没有上述失败，但仅因 UNKNOWN/INVALID/UNRUN 或主要观测缺失而无法验收；0=两模型必需回合 finalVerdict 均 PASS 且资源/清理通过。主动表的可恢复 FAIL 不阻止退出 0，但必须在摘要首行说明“经恢复最终通过”，不能称全部通过。明确 FAIL + T3 未运行仍退出 1，并同时报告主观测未取得。

不做加权总分、不做 best-of-N、不无限重试直到通过。新一轮复现有新 run/attempt ID，保留首次失败。以后需要重复次数时预先确定所有样本；3/3 也不外推真实用户成功率。

## 6. 最小采证与 grader

实现结构（运行证据和最终验收状态见验证报告）：

```text
benchmarks/constraints/
  run.mjs           # B01 quick；内部预检/创建/发送/采证；独立 grade/cleanup 入口
  cases.json        # B01 T1–T3、前置事实、适用规则、预期拒绝与固定模板
  facts.mjs         # 公共事实白名单、timeline/provider 归一化
  io.mjs            # 参数、进程与 Git 归属校验
  runtime.mjs       # SDK/RPC、独立快照与资源收尾
  grade.checks.mjs  # 确定性反例
  README.md         # 使用说明
  grade.mjs         # 确定性纯函数，不能代 agent 写入
docs/verification/constraint-benchmark/<runId>/
  manifest.json
  ownership.json    # 创建意图、实际ID、归属、收尾回执，逐动作落盘
  fixtures/        # 每个模型的只读检查脚本（不污染被测PR）
  facts.json        # 逐回合calls/events、当时实体/回执、检查与Git/PR事实
  verdicts.json    # 主动/最终逐子项、恢复路径与证据索引
  cleanup.json
  report.md
```

证据在每回合结束立即保存，并在删卡/归档前冻结：

| 评分事实 | 首选来源与限制 |
| --- | --- |
| 当前卡/设置/阶段/workpad | 成功工具结果的当时实体与 revision、业务事件、必要的只读实体快照。结束时状态不能替代编辑前状态。 |
| output 登记和 outputs 声明 | 公共成功 receipt 的 artifactId(s) 对应实际 role=output 和完整 target；`artifactIds: []` 与字段不存在分别为显式空/省略，collector 必须保留字段存在性。精确重放按 eventId 去重。仅接口入参/命令尝试不能证明成功。 |
| nextMoves 声明 | 主动表的“随交付携带”须成功调用参数或完整、无歧义的回执/事件关联；未知仍 UNKNOWN。最终表按本轮真实 turn_started 之后、结束前同卡/同 agent 是否有有效声明，允许独立 suggest_next_moves 补齐，与 needsNextMoves 一致。实体事件含 moves，flow 以 offered=0 保留显式空。独立 next_moves 有指向该事件的 receipt，携带事件没有独立 receipt；只有回执集/事件顺序完整时才推导携带，不只看时间相邻。 |
| 真实产物/PR/检查 | runner 独立检查文件内容/hash、允许变更路径和检查结果；通过 gh 查询真实仓库、URL、head、merge 状态。stdout 只贴链接不算 PR 事实，只有 workpad 自报不算跑过检查。 |
| 工作先后、提前 ack、拒绝链 | Paseo 原生 timeline 的实际 tool_call/result ID 与依赖，必要时补原生 provider transcript。动态 exec 里不能确认的内容仍 UNKNOWN，外层 tool_call 不证明内部顺序。 |

证明“agent 跑过检查”必须关联该 agent 的实际执行调用与返回码；runner 自己复跑检查或核实文件有效，只能作为独立复核，不能替被测 agent 补做 C03。无法取得实际执行证据时，不因 runner 复核通过就把这一项记 PASS。

读取只限定本次 ID。`board.read` RPC 仅供实体/事件/workpad，不返回 agentReceipts。回执来源为捕获的工具成功结果，或 **daemon 主机上数据目录 board.json 的只读存储字段**；只导出公共字段白名单，禁止直接写存储文件。回执有 expiresAt（7天），删卡备份 `removed/task-<id>-*.json` 含该卡回执，可作冻结失败后的归属已核实兜底，不能用它代替清理前采证。

历史用完整 `flow/<projectId>.jsonl`；flow 是精简投影，不保存所有 note、moves 文本、回执或事务 ID。board 的 events 会截断，flow 追加也可能延迟/失败；在回合结束后核对完整性、读存储回执和 flow 并冻结，再删除卡片，不能仅等固定秒数便声称完整。缺失项如实 UNKNOWN，不靠超时把“未观测”改成“没有”。

复用 audit v2 的安全提取/AST 经验，不直接照搬旧 capture.py 的 Codex 正则当评分器。只统计已执行且有结果关联的调用；不执行 transcript 代码，不把 AST 中的分支/函数体当成实际执行。原生 timeline 参数是否完整在实现时验证，不能在设计稿中声称已验证。

输入材料/marker 正确只能证明任务使用了材料，不能替代 C01 时序证据。T1 文件 output 与 T3 PR 登记分别留证；跨回合补登不修复“当回合登记”失败。

只保存受控消息、允许路径、必要公共字段、错误码与实体/产物事实。签名请求、token、context-file 内容、思考过程和其他项目不入报告；临时凭据私有保存并清理。稳定证据带 SHA-256，grader 重评不覆盖原始证据或旧判定。

## 7. 资源归属、Git 基线与清理

复用永久 Tinylink 和保留的私有仓库 `JasprW/flowly-delivery-fixture-20261022-036d`。固定本地 fixture 的**具体 commit 与内容**来创建测试 worktree，不能为固定基线 reset 永久 checkout/main。远端 main 会随测试 PR 前进，记录每次运行前后远端 SHA；只新增本次唯一文件，保留合入历史，不宣称远端基线不变。

Paseo worktree 共享 Tinylink Git common-dir，分支 refs/config/remotes 不会自动隔离。runner 在创建本轮唯一 scratch ref 前记录意图与预期 commit，验证创建及条件删除权限；删除只在 ref 仍指向自己的预期值时执行。scratch 清理也须核对；权限不足就结束预检，不能假设换个 worktree 就能删 ref。目标以显式 Git URL/gh --repo 指定，禁止 git remote add 或改共享配置。若 agent 自建独立临时 Git 管理区，先记录归属再清理，不能把它当默认前提。

开始前记录原有卡片/session/workspace、Git worktree/ref/remote 和必要配置、允许路径状态。配置比较只保存白名单或脱敏哈希，不能导出带 token 的完整 git config/URL。旧四个本地测试 refs 只属 baseline，当前 benchmark 不认领、不清理，也不要求它们为零。

每次副作用前先落盘 operation/idempotency key 或确定性的资源标识，成功即追加实际 ID。清理只按这些已核实 ID 和实际归属，不按标题/时间范围批删。无法确定创建是否成功时，只核对已有资源，不盲目再建。

用 try/finally：冻结证据 → 停止本次活动并确认无运行会话 → 归档自有普通测试 session → 通过受支持的 tasks.delete/archive 路径清理卡片/worktree → 条件删除本次分支 ref/临时目录 → 核对清理。不得用 summarizer hard-delete 特例删除普通 session。Paseo 移除 worktree 不保证删除保留的分支 ref，须在 Git common-dir 单独核对并清理自己的 ref；不得删除未知分支。

GitHub 仓库与已合入 PR 历史保留，新增测试文档可在此私有仓库保留；关闭自己未合入的失败测试 PR 并清理自有远端分支。永久 Tinylink 本地文件、原资源和原配置保持。只删除本次清单的路径/ref；并行用户操作导致变化时记录冲突，禁止用起始快照自动覆盖恢复。

在原生 registry、Flowly 实体、Git worktree/ref、目录与远端分别核对：自有资源已按产品语义删除或归档，原有资源未被本次修改。cleanup=FAIL 必须非零退出并保留归属/安全重试信息，不抹掉模型成绩。

**quick 不做崩溃后的自动续跑。** 崩溃/无法确定消息是否送达时，保留已知失败，把受影响且无法判定的后续部分记 INVALID/UNRUN，停止发送消息。只提供独立 `cleanup --run`，先核对资源再重试清理，不重新跑模型、不重发用户消息。完整自动恢复后置。

## 8. 最小实施顺序与验收

1. 先做 grade.mjs 纯函数和最小事实格式。优先使用本卡已保存的 initial-complete/final-capture、真实失败/成功回执做样本；旧证据不完整的规则应 UNKNOWN，不补造过去时序。
2. 补关键反例：成功/漏登/登记失败、同号不同仓库PR、跨回合补登、回执重放、缺日志 vs 完整可观测零调用、动态/并行未知顺序、预期拒绝 vs 可避免拒绝、workpad变化后再拒绝、检查造假、相同输入机械 stale、T1评分失败但T3仍可执行、T3缺失与已有FAIL的退出码优先级。
3. 参数化 live/capture/verify 的必要步骤，只跑一次 B01 quick；先核对采证能力再宣称某项能自动评分。不因收集不到就放宽现行 stage/声明要求。
4. 按项目要求以创建时 full-access 的 Luna 6 验证 runner、评分和清理；被测模型和独立验证器分开，不让 verifier 给 agent 提示。新代码审查沿用用户指定 Fable。实现审查按用户最新指定改由 GPT Astra；Fable 本次额度耗尽的未执行记录保留。

现有契约测试直接引用原命令及实际结果，不迁移 helper；实现后先聚焦相关工具检查，再按变更范围执行必要 typecheck/npm test。相同输入成功结果可复用；本次实现是开发工具，不改产品运行时；无需插件 reload。真实 quick 的 PR 仅在已授权 fixture 仓库创建。

实现 CLI：

```sh
node benchmarks/constraints/run.mjs run --profile quick --config ./local-benchmark.json
node benchmarks/constraints/run.mjs grade --run <runId>
node benchmarks/constraints/run.mjs cleanup --run <runId>
```

配置包含模型/模式、基线、明确目标和预算，不含 token。默认串行；默认每回合上限 10 分钟（本轮 PR 场景预先配置 15 分钟），整次上限 60 分钟，可预先配置。预算到期冻结证据，停止/清理自有资源；未启动项 UNRUN，不自动加预算或重试。PR 指令已授权测试目标的创建/合入，运行无需逐次再问；目标不明则预检不通过。

## 9. 后续场景与新增失效流程

以下只保留设计方向，**不计入当前 quick 分母、CLI 或实现验收**：

| ID | 后置场景与已确认修订 |
| --- | --- |
| B02 | 输入驱动返工：新会话读取独立材料并修改 marker；不能称为“已读会话新到 unread”，也不能仅凭 marker 判首次读取顺序。 |
| B03 | 已有会话 CLI 后续：用 tools.prepare-existing + 发送 prepared.instructions 完成接入 T0，不计分；等 idle 后经 tasks.update 改描述并新增 input，再发被测 T1。不通过不存在的人工 workpad 新增接口预置；type/tags 预置齐全，必要检查由被测 agent 建立。 |
| B04 | 检查失败与恢复：描述要求执行确定性退出 1 的检查、记录真实 workpad 并交付，检查项由被测 agent 自己建立；type/tags 预置齐全。预期 open 集为这项失败检查，少记/写pass分别按真实规则失败；允许 fingerprint 变化后的合法多次拒绝链。 |

真实 compaction/旧版本升级、ACP/OpenCode/Pi、GitLab MR 和 UI 仍未覆盖，不能从 quick 外推。standard/重复确认档位等有实际需要再定义；当前不预先构建全矩阵。

以后发现失效：先把真实证据脱敏为最小普通任务，优先复用 B01；覆盖不到才加 case，写前置事实、固定消息、适用项和反例。修复前后固定 case/fixture/grader/model/mode/transport/开关，只改变约束实现，保留全部样本。无法还原旧版环境就只称历史观测，不假称受控对比。

grader 修订时用同一新版对两边保存证据重评，保留旧判定；证据缺失保持 UNKNOWN。case/规则改变升版本并说明可比性；自动 compare 命令后置，目前人工读逐格报告即可。

## 10. 本次修订与来源

按 [Fable 原始审查及主会话复核](verification/constraint-benchmark-design-2026-10-22/fable-review.md) 修订：澄清主动/最终口径和预期拒绝、B01事实前置条件、完整服务端事实/动态未知、共享Git归属和预检、后置场景的合法预置；收敛为 grader+B01 quick。

保留现行 test 阶段要求；不把 marker 当顺序证明；保留 daemon 运行身份和相同检查输入的证据；Done/Cancelled 转为不变量/契约层而非正常模型得分。

Fable 对 r2 的结论与实施前两处说明见 [r2复审](verification/constraint-benchmark-design-2026-10-22/fable-rereview-r2.md)。本次先补这两处再实施，不把复审结论当运行成绩。Onboarding 无产品 UI/设置/入口变化，tour/tip/What's new 无需更新。

- [共享清单与统计口径](TURN-CHECKLIST-SPEC.md)、[交付与确认契约](DELIVERY-CONSTRAINTS-SPEC.md)、`shared/turn-checklist.ts` / `skills/flowly/SKILL.md`。
- [真实 Sonnet/GPT 复现](verification/delivery-constraints-2026-10-22.md)、[live](verification/delivery-constraints-2026-10-22/live.mjs)、[verify](verification/delivery-constraints-2026-10-22/verify.py)、[Audit v2 限制](verification/flow-constraints-audit-2026-10-22/README.md)。
- 服务端核对：`server/agent-service.ts` 的 receipt/recordMoves/交付门槛、`shared/insights.ts` 的 offered 投影、`server/flow-log.ts` 的事件精简与清理语义、`shared/rpc.ts` 的 tasks/artifacts/workpads 支持接口。


## 11. 实现验收记录

实现与限制见 [验证报告](verification/constraint-benchmark-2026-10-22/implementation-report.md)，CLI 见 [README](../benchmarks/constraints/README.md)。实际评分、模型覆盖与资源收尾分别报告，不能把代码检查通过写成双模型行为通过。

检查脚本身份、真实进程返回码、输入闭包和 PR 两份内容 hash 独立判定，明确不匹配优先于其他字段缺失。native 工具时间戳可能是回放更新时间，阶段顺序以实际 call/result 顺序及成功上下文/回执为依据，不据该时间戳猜测。

清理先持久化最小证据，冻结失败保留资源；关闭 PR 前须有明确冻结身份并再次核对，不按分支名批量关闭。只读恢复删除卡的历史时按明确卡片 ID 读取 removed 的 JSON 与 flow 备份，保留初始事实及旧判定。

## 12. 2026-10-23 最小修订：已有 fixture 历史同步

用户授权只修正范围与清理判定，以已保存证据离线回归，不重跑模型。case/提示/模型配置不变，grader 升至 1.0.1；原 run 的 facts、原始/最终成绩和清理记录全部只读，新证据与重评另存。

- 本地固定 base 仍用于创建 worktree，不 reset 永久 checkout。每个 case 在启动会话前，通过显式 fixture URL 冻结当时 `refs/heads/main` 的完整 SHA、来源、仓库和时间，随 ownership 落盘。不把执行结束时的 remote main 或 HEAD 的任意父提交自动认成已批准历史。
- 共用 `scope.mjs` 采证/判断：保留固定 base 的原始差异，同时单列 dirty/untracked 路径、扣除固定 base 和冻结历史祖先后的新提交及其实际差异、必要 tree entry（mode/type/object ID）和 ancestry 证明。同步的非目标路径必须来自该已冻结历史且树项完全一致；新普通提交对非目标路径的改动即使随后还原也不豁免。新 merge 的非目标差异只有在包含冻结历史且其结果树项与该历史一致时才可豁免，冲突解决、额外 dirty、删除/重命名/模式修改不能借同步放行。
- 评分与清理使用同一个判断：明确非目标改动 FAIL；必要 Git 对象、历史身份或完整差异证据缺失 UNKNOWN；两者均不得自动清理。仅证明所有实际新改动都在唯一允许路径时 PASS。没有导入历史时，不要求为纯单文件改动额外取得远端对象。
- 新事实保存 `scope` 审计，绑定固定 base、实际 HEAD 和允许路径；`changePaths` 继续保留原始固定-base差异，不能再单独证明额外编辑。旧事实缺审计时保持 UNKNOWN，不为它补造 PASS。已保存的真实 Git 对象可只读投影为离线 fixture，配合先前验证过的 PR/时间顺序确定历史来源；投影与新版重评分开存，不改旧 ownership 或结果。
- 清理前仍须停止会话、冻结最小证据、核对 card/workspace/ref/remote 归属与冻结 SHA，再检查共用 scope；此修订不放宽其他资源边界，也不因行为其他项 FAIL 就跳过安全收尾。

验收命令为 `node --test benchmarks/constraints/*.checks.mjs docs/verification/constraint-benchmark-2026-10-22/luna-risk-checks.mjs`。增加保存的 `20261023020035204-8b1863` GPT 提交图回归，以及真实额外提交、后来还原、dirty、缺失对象/证据、未批准父提交、merge resolution 和文件模式等反例。只运行本地纯函数/隔离 Git 测试，不创建会话/卡/PR，不调用 live run 或 cleanup；本轮模型验证（含新 Luna 会话）不运行，遵循用户“不重跑模型”。无需产品 reload/UI/onboarding 改动。
