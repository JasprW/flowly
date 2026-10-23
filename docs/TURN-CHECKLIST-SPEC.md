# 回合清单与遵守率统计校准

2026-10-22，用户授权：先校准统计口径，再实施最小版建议 1+3，先写 spec，暂不加 hooks。本规范增补 PHASE-02-SPEC、CARD-SETUP-SPEC 与 DELIVERY-CONSTRAINTS-SPEC；不改变单根目录、权限、状态、写入或回执规则。

## 1. 目标与范围

交付后的“提交、开 PR、合入、返工、验证”短回合也属于工作回合。将已有动作义务突出为一个简短清单，使新会话的 skill 与旧会话读卡时看到的最新要求一致。清单仅提示已有规则，不新增审批、不强制经过所有阶段、不强制 idea，不推断回合做过什么。

不增加 Claude hooks、MCP initialize instructions、自动代登记、回合后补登消息、仓库 AGENTS.md 要求或规则版本平台。完全不调用工具的回合仍无法靠 get_task 提醒；ACP 指令实际送达不在本次验收范围。

## 2. 单一清单与接口

由运行环境无关的 `shared/turn-checklist.ts` 导出英文 `turnChecklist: string[]`。六项覆盖：

1. 每回合（包括提交/合入/返工/验证短回合）先读 get_task、处理 unread inputs、补 setup.missing。
2. 按工作目的选择阶段：调研、规划、写规格保持 design；实现变更（含纯文档实现）在编辑前设 development 并定义 workpad 验收/检查；执行任务验证（包括 workpad 或用户要求的检查）前确保 test，普通定位读取不要求 test。阶段随工作变化，不强制阶段流水线。
3. 跑检查后在 workpad 记录实际结果、准确命令与 commit，未提交修改标 dirty。
4. 本回合开的每个 PR/MR 都在本回合登记 output，即使上一回合已经交付。
5. 工作回合（包括本卡调研、任务检查、提交/合入跟进）结束前更新 workpad，并取得成功的交付/结果回执：整卡整体交付或用户要求的 handoff 用 in_review，未提交成果也适用；部分工作或纯验证跟进可用 result。新产物本身不代表整卡完成。两者带 outputs 与 nextMoves，没有则显式 []。纯对话或暂停不新增交付；question/blocked 后不额外补 result，仍遵守各自现有 nextMoves 规则；用户明确 stop/wait 的指令优先。
6. 首次 WORKPAD_OPEN/SETUP_INCOMPLETE 后查看并尽量解决；解释每个遗留项后才能 acknowledgeOpen 重试。会话结束不代表卡片完成。

`server/skill-source.ts` 在 skill 开头按编号渲染此数组；后续保留原详细规则，去掉“before starting a work phase”容易被误读成每回合规则例外的措辞。仓库 `skills/flowly/SKILL.md` 与生成字符串逐字一致。

`flowly_get_task`、HTTP/CLI `current` 及写入返回的 current 都由 AgentService.get 构造，增加 `turnChecklist` 数组。总计 6 项，目标不超过 1800 字符，无任务历史、凭据或用户文本；每次读均取运行中插件版本，不依赖 session 创建时的 system prompt。输出 schema 为兼容旧结果允许字段缺省，新服务始终返回；toolVersion 仍为 1，不新增错误码，不写 board、不改变 revision/已读语义。只读权限与原有校验一致。

### 2.1 两项措辞收紧（2026-10-23）

用户授权按 [Fable 整体方案评审及主会话复核](verification/constraint-benchmark-advisor-2026-10-23/review-summary.md) 仅收紧第 2、5 项，再生成 skill；第 1、3、4、6 项逐字保留。候选六项以换行连接共 1583 字符。该增量澄清既有义务，不改变阶段、自动恢复、整体交付/阶段汇报或工具门槛。

| 场景 | 既有边界，修订后继续保持 |
| --- | --- |
| 调研、规划、编写规格/研究报告 | Design；不能因为编辑了文件就一律改到 Development。 |
| 实现代码或纯文档变更 | 编辑前 Development；执行任务验证前 Test，不能跑完后仅为登记结果才切 Test。普通定位读取不触发 Test；已在 Test 时无需重复切换。 |
| 整体交付/用户要求 handoff，先不要提交 | 可交 In review；不增加 Git 提交要求。文件、报告、PR 的出现本身不强制把阶段贡献升级为整体交付。 |
| 纯验证或阶段贡献 | 允许 result；纯验证停在 Test 是现行合法结果。 |
| 纯对话、暂停、提问或阻塞 | 不为了“最终聊天回复”另造 delivery/result；question/blocked 按现有路径处理 nextMoves，明确 stop/wait 优先。不修改 A1/A1r。 |

成功回执义务针对工作回合的收尾，不要求整个回合恰好一次回执，也不禁止合法检查点或拒绝后的重试。规则送达、成功写入提醒与独立 benchmark 仍分层：文字一致不能证明模型遵守；Sonnet 整轮零成功业务写入仍无工具写入提醒入口，新措辞效果未验证。

本轮只更新规范、共享数组第 2/5 项及仓库生成 skill，并记录必要进展/证据。保留原始 benchmark 成绩与独立重评；不运行 B01、模型/审查会话、grader/fixture，不加 hooks，不改接口/服务端行为，不安装或 reload。

本轮增量检查：`npx vitest run server/skill-source.test.ts server/agent-service.test.ts server/tool-server.test.ts`，核对六项/长度、生成 skill 逐字相等及 get_task/MCP 的同源返回；另核对仅第 2/5 项变化、skill 详细规则不变、旧成绩文件哈希保留。§4 的历史实施验收保留，不冒称本轮重跑了全套测试、Luna 或真实模型。

## 3. 统计校准

保留原 `audit.mjs` / `audit-codex.mjs` 命令入口，使用共享只读解析与汇总逻辑。原报告及旧输出留存，不覆盖成新结果。

- `--since` 按真实用户回合起始时间筛选，增加可选 `--until` 上界（半开区间）。先解析会话完整历史确定首次/后续回合，再筛选；旧会话上线后的回合必须保留。按会话创建时间相对 since 标识 old/new，不把窗口内首个回合当成会话首次回合。
- 两种 provider 使用同一个 `--project` 范围；无当前卡片的旧会话只在完整 flow 历史可确认项目归属时纳入。子 agent 默认排除，测试卡片不因标题猜测为真实或测试；用显式 `--test-session <完整 ID>`（可重复）或 `--test-sessions <JSON ID 数组文件>` 标记，输出按 model、real/test、old/new 分组。未标记样本只称 unclassified，只有显式 `--real-session` 标记才称 real。
- PR/MR 创建命令与编辑命令仍是 transcript 启发式观察，不冒充业务真相。分开记录创建尝试、结果中确认的完整 PR/MR URL、登记尝试、成功登记与无法确认的数据。仅匹配 PR 编号不够；必须比对完整规范 URL，不把同轮其他 PR 登记算成功。
- `outputs`、独立 add_artifact、CLI 均只有在成功回执（event ID / artifact ID(s)）与实际 role=output 的产物 target 对应后才计入成功。失败返回不计；重放不重复计。产物可来自工具结果 current.artifacts 或当前 board；历史产物已删除且无法还原时保持 unknown，不用 artifact_added 事件数、说明中的链接或调用源码代替成功。
- Codex code mode 不执行 transcript 中的代码。只提取实际 AST 调用表达式及可静态读取的参数；动态参数无法还原时标记 unknown。工具返回、CLI stdout、MCP content/structuredContent 中只提取统计所需的 receipt/error/artifact 字段，不导出原始消息、签名请求或凭据。
- `acknowledgeOpen` 分为未见先前拒绝的提前确认尝试、同一回合收到 WORKPAD_OPEN/SETUP_INCOMPLETE 后的确认重试、拒绝后修复再交付；回合重置。仅记录观测顺序，不能仅据此前拒绝断言服务端接受或 fingerprint 一致。无法静态还原的参数/混合批调用保持 unknown。
- JSON 输出保留每回合分母、证据、未知、失败与分组；文本摘要明确“命令启发式”和“观测到的回执成功”，无 PR 样本时显示 0/0，不声称 100%。不输出用户消息正文或整个工具结果。对缺失日志给诊断，不静默当作零次调用。
- 参数错误（缺少值、无效日期/区间等）非零退出。文件读取只读；无网络副作用、不自动补登。通过可指定 home/data 的隔离 fixture 验证，真实样本只读校验；不以不同窗口/样本构成直接声称前后因果。

Fable 审查补充（实现前明确）：两入口默认 since 一致；Claude 的系统来源/后台 task notification、IDE 与命令提示不建立用户回合。登记尝试收到空白或无法提取 receipt/error 的应答也属于无法确认，不能据此声称 missing（board 回执仅保留 7 天）。Codex `shell_command` 字符串和 `shell` 的 bash/sh/zsh `-c`/`-lc` 数组脚本纳入识别，其他无法解析的 argv 标 unknown。skill 不使用易失效的清单步骤编号交叉引用。

## 4. 验收与验证

- 统计：两个 provider 的受控 JSONL 覆盖旧会话跨窗口、真实首次/后续、项目隔离、测试分组、outputs 与 add_artifact/CLI、失败/未知、多个 PR 完整 URL 匹配、重放去重、先拒后确认/修复与新回合重置；命令为 `node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs`。
- 清单：服务读卡不改 board；重复读与旧身份均返回最新清单；MCP schema、CLI current、skill 生成一致，旧 schema 结果可解析。命令为 `npx vitest run server/agent-service.test.ts server/tool-server.test.ts server/skill-source.test.ts`。
- `npm run typecheck` 在 reload 前通过；最终树运行一次 `npm test`，只在新失败或输入变化时追加必要检查。
- 重载 running 插件（不重启 daemon），在当前卡片 CLI current 只读实测；Luna 6 full-access 独立审查与验证，测试 session ID 和证据留 docs/verification。没有 UI 改动，不把截图或 running 状态算作行为证明。清理本轮新建测试资源，保留旧资源和用户要求留存的 GitHub 仓库。
- Onboarding：没有新按钮、设置或用户操作流程，更新 tour/tip/What's new 不适用；交付说明此判断。
