# M2.5：多任务人工管理

状态：用户于 2026-10-14 授权（选定 A、B、D；C、E 暂不做；要求先把看板基础功能做好）。上游：[ROADMAP-V2 §0/§8](ROADMAP-V2.md)。
本阶段只用人工操作和 Paseo 已有的 session 信号，不新增 agent 工具，不改变 agent 的状态权限。存储结构不变（board v3），也不引入新的持久化文件。

## A. “需要关注”总览

- 看板工具栏新增 Attention 按钮（铃铛图标）。有待处理项时显示数量角标。
- 弹窗按卡片列出所有需要关注的 session：
  - 范围：未归档项目中未归档的卡片。不受当前项目、搜索、优先级、Finished 筛选的影响。
  - 判定沿用现有 `sessionAttention`：等待授权、出错、回合结束未读。running 不算。
  - 读状态不可用时不判定未读，只列授权和错误，并在弹窗顶部说明。
- 每行显示：卡片标题、项目名、卡片状态、各项原因（如 “1 approval · 2 unread”）、最近 session 更新时间。排序规则：
  1. 有授权或错误的卡片排前；
  2. 同一档内，最近更新的排前。
- 点击一行：切到该项目，打开卡片侧栏。
  - 若该卡只有一个需要关注的 session，直接打开它的预览。复用 session chip 的一次性入口机制，“Back” 回到卡片详情。
  - 有多个需要关注的 session 时停在卡片详情，由用户选择。
- 打开 session 不会自动标为已读；已读仍由现有 “Mark as read” 操作完成。
- 空状态显示 “Nothing needs your attention.”。数据随看板现有轮询（≤5s）刷新。

## B. 一键开 session

- 入口有三个：
  - 侧栏 Sessions 区标题旁的 “Start session”（原 “New session”）；
  - 卡片无 session 时，空状态里的主按钮；
  - 卡片操作菜单中的 “Start session”：打开侧栏并直接弹出创建框。
- 创建框预填以下内容，均可修改：
  - **Provider / model / mode**：沿用最近一次创建的 session，即所有卡片 workspace 中 `createdAt` 最新、未归档的 session。若它的 provider 不可用或 model 不可选，回退到 provider 默认 model；若 mode 不在可选列表，回退到 provider 默认权限。没有历史时保持现状（codex + 默认 model）。
  - **初始指令**：卡片标题加描述（空描述时只有标题）。
  - **标题**：留空，即使用卡片标题。
- 创建逻辑、Kanban 工具注入、幂等与恢复行为不变。

## D. 手动收尾（Wrap up）

- 卡片状态为 Done 或 Cancelled 且未归档时，侧栏 “Needs” 位置显示 “Wrap up” 区块和按钮。其他状态不显示。
- 点击后先做检查（RPC `tasks.wrapup-check`），再弹窗展示结果：

| 检查 | 级别 | 说明 |
| --- | --- | --- |
| session 运行中/启动中 | 阻止 | 先停止或等待结束 |
| session 空闲但有后台任务在跑（Paseo 0.16，agent 快照 `backgroundWork.count > 0`） | 阻止 | “N session(s) has/have background tasks still running. Stop them or wait for them to finish first.” 归档会结束这些任务（测试、dev server 等）。旧宿主快照没有该字段，按 0 处理，行为不变。自动 Wrap up 和删除卡片时的归档用同一预检，所以同样被阻止 |
| workspace 正在归档或不可用 | 阻止（不可用时只允许归档看板记录） | — |
| 未提交改动（仅 worktree） | 警告 | 归档后 Paseo 可能删除 worktree 目录，改动会丢失 |
| 未推送提交 `git rev-list --count HEAD --not --remotes`（仅 worktree） | 警告 | 分支保留，但提交只在本地 |
| Git 状态无法读取（仅 worktree） | 警告 | — |

- 收尾动作按 workspace 类型区分：
  - **worktree**：归档该 workspace。Paseo 会同时归档其 session 和终端；当它是该 worktree 的最后一个活动引用时，Paseo 会移除 worktree 目录，分支保留。
  - **directory / checkout / local_checkout**：不归档 workspace（它可能是项目根或用户的常用目录），只逐个归档该 workspace 内未归档的 session。
  - 两种情况最后都把卡片标为已归档，记录活动 `wrapped_up`（含已归档的 session 数、是否归档了 workspace、被确认的警告）。
- 确认：
  - 有阻止项时，“Wrap up” 不可点。
  - 有警告时，按钮为危险样式，文案为 “Wrap up anyway”；请求带 `acknowledgeWarnings=true`。
  - 服务端执行前重新检查。若出现新的阻止项，或警告变化且未被确认，则拒绝并返回最新检查结果。
- 请求带卡片 `revision`，卡片已被他人修改时返回冲突。
- 执行顺序：资源归档在前，卡片归档在后。
  - 任一 session 或 workspace 归档失败：卡片不归档，返回已完成与失败的明细，可再次重试（已归档的资源会被跳过）。
- 卡片原有的 Archive（只归档看板记录）保持不变。收尾成功用原生 toast 提示。
- 这是用户显式操作，符合“归档看板记录不隐式归档 Paseo 资源”的约束；AGENTS.md 增补一行说明此显式例外。

## 补充：worktree 分支名可选（2026-10-15）

创建卡片时选择 New isolated worktree，可以不填 New branch，由服务端生成 `kanban/<标题英文 slug>-<6 位 hash>`：
- slug 取标题中的英文和数字，转小写，非字母数字统一换成 `-`，最长 40 字符；标题没有可用的英文时用 `task`。
- hash 取自本次创建的 operationId，同一次创建重试时分支名与幂等键保持不变，不会多建一个 worktree。
- 用户填写了分支名时按原值使用。

## 补充：新建任务时可同时启动第一个 agent（2026-10-15）

- New task 表单增加开关 “Start an agent now”，记住上次选择（host 设置 `board-view.startAgentOnCreate`，首次默认开启）：
  - **开启**：显示与 New session 相同的 Agent 选择（Provider / Model / Permissions，预填最近一次 session 的设置）和 “First instruction”。First instruction 跟随标题与描述生成，用户编辑后不再覆盖。按钮为 “Create and start”：先创建卡片与 workspace，再以与侧栏 Start session 相同的配置（MCP + skill + 卡片上下文）启动 session，然后打开卡片侧栏。
  - **关闭**：只创建任务，之后从卡片手动启动。
- 失败处理：卡片已创建但 agent 启动失败时保留卡片，弹出错误提示，可在侧栏重新启动。启动使用基于本次创建 operationId 的固定 launch ID，重试时复用已准备的 agent，不会重复创建。
- Agent 选择逻辑抽为 `useAgentChoice` / `AgentPicker`，供 New session 与 New task 共用；启动逻辑为 `launchKanbanSession`。
- 设置读取统一经 `boardViewValues` 补全默认值，因为宿主不会对旧存储值套用新字段的默认值。
- 实测：新建并启动 haiku session、侧栏自动打开并显示运行中、A1 自动转 In progress；随后 Wrap up 清理（[截图](verification/create-and-start.png)）。

## 补充：移到 Done/Cancelled 时收尾（2026-10-15）

用户要求：卡片移到 Done 或 Cancelled 时默认询问是否 wrap up，同意则归档 workspace；设置中可改为自动归档。

- 设置：host 设置 `wrap-up.autoWrapup`（Settings → Workflow → Finishing cards → Auto wrap up）。未设置等于关：Paseo 只把用户改过的值写进 `~/.paseo/plugin-settings/flowly/wrap-up.json`（如 `{"version":1,"values":{"autoWrapup":true}}`），交给插件的值会先补上 schema 默认值，daemon 也写不了设置，所以默认值改成开会让所有没碰过它的老用户一起变成开。schema 里该字段是 `optional()`（不是 `default(false)`），这样“从没设置”在交给插件的值里仍是 `undefined`，能和“设成关”区分；所有读取都经过 `wrapupSettingsValues`，未设置按关处理。
- 新安装默认开启（2026-11-10，用户决定：有了就地 Unwrap，误收尾只需点一下即可撤回）：首次导览（自动弹出的那次，只有新用户会看到）以任何方式关闭时，若 `wrap-up` 里还没有 `autoWrapup`，写入 `autoWrapup=true`（ONBOARDING-SETUP-SPEC §4，与外部 session 开关同一时机）。已有用户、手动打开的导览、已存过选择的用户都不写，未设置仍等于关；老用户在设置里自己开启（发版时由 What's new 告知）。
- 触发：人在看板（菜单 Move to、拖拽放置）、侧栏状态、编辑表单中把卡片从非 Done/Cancelled 改为 Done 或 Cancelled。Done ↔ Cancelled 之间互相移动不触发。
- **关闭（默认）**：该客户端在状态写入成功后弹出 “Wrap up this card?”：
  - 先跑 Wrap up 检查，展示阻止项/警告，规则与手动 Wrap up 相同（有警告时按钮为 “Wrap up anyway”）。
  - 确认后归档 session/workspace，卡片**保留**在看板上（RPC `tasks.wrapup` 带 `keepCard=true`，记录活动 `wrapped_up`，备注含 “card kept”，不改卡片 revision）。
  - “Not now” 关闭，不动任何资源；之后仍可用侧栏 Wrap up。
  - 卡片已没有可归档内容（workspace 不可用，或 workspace 不归本卡且无 session）时不弹出。
- **开启**：daemon 在状态写入后后台执行，不阻塞写入；同一卡片同时只跑一次。只有在没有阻止项、没有警告、workspace 归本卡所有时才归档 workspace（Paseo 同时归档其 session 和终端），卡片保留，记录 `workspace_auto_archived`；否则不动资源，记录 `workspace_auto_archive_skipped`（附原因），之后可手动 Wrap up。执行前再确认卡片仍为 Done/Cancelled 且 revision 未变。
- 摘要会话：回合结束后插件会在卡片 workspace 中创建短时的 “Kanban summary” 子会话（标签 `ultra-kanban=summarizer`），结束后自动归档。它不算 “仍在运行” 的 session，也不计入归档数量；自动与手动 Wrap up 都先等待本卡进行中的摘要跑完（`SummaryService.settled`，受摘要自身超时限制）再做检查和归档，避免回合刚结束就移到 Done 时被误判跳过或截断摘要（2026-10-18 修复）。
- 归属：新卡记录 `ownsWorkspace`（新建 directory/worktree 为 true，关联已有 workspace 为 false）。旧卡没有该字段时，Paseo workspace 标题与卡片标题一致才视为本卡创建（插件创建时用卡片标题命名）。归本卡所有的 workspace（含 directory 类）整体归档，directory 目录留在磁盘；worktree 目录可能被 Paseo 移除，分支保留。不归本卡的 directory workspace（如项目 main）从不归档，只归档其中的 session。
- 已收尾状态：卡片最近一次 `wrapped_up` / `workspace_auto_archived` 之后没有 `workspace_restored`，也没有移回非 Done/Cancelled 状态时，视为已收尾（`shared/wrapup-state.ts`）。此时侧栏 “Finished” 区块改为 “Wrapped up”（显示归档了什么、何时归档），不再显示 Wrap up 按钮和菜单项，也不再提示 “Workspace is unavailable or archived.”，改为显示 **Unwrap** 按钮：就地恢复收尾归档的 workspace 和 session，卡片留在 Done/Cancelled，成功后区块变回 “Finished”（2026-11-10，见 [WORKSPACE-RESTORE-SPEC](WORKSPACE-RESTORE-SPEC.md) “Unwrap in place”）。自动收尾只在卡片从其它列进入 Done/Cancelled 时触发，Unwrap 后留在 Done 的卡片不会被再次收尾。
- 侧栏手动 Wrap up 不变（仍会归档卡片），只是同样整体归档归本卡所有的 directory workspace。

## 补充：移出 Done/Cancelled 时恢复 workspace（2026-10-15）

把已收尾的卡片移出 Done/Cancelled 时，后台恢复收尾时归档的 workspace；在侧栏点 Unwrap 则就地恢复，卡片不动：沿用同一 workspace ID，worktree 被删除的会在原分支上重建。同时恢复该次收尾归档的 session（用户自己归档的不动）。详见 [WORKSPACE-RESTORE-SPEC](WORKSPACE-RESTORE-SPEC.md)。

## 不做

agent 自动推进、阶段、提问、自动启动（见 ROADMAP-V2 远期）、卡片排序/筛选增强（C）、卡片备注（E）、延迟收尾、自动归档卡片本身。

## 验收

- 先 typecheck，再跑聚焦测试和全量 `npm test`，然后只 reload 本插件。
- 聚焦测试：
  - 关注列表的计算：范围、排序、读状态不可用；
  - 默认 session 设置的推导；
  - 收尾检查与执行（git 临时仓库 + fake SDK）：阻止、警告确认、worktree/directory 分支、部分失败不归档卡片、revision 冲突、重复执行。
- 真实渲染检查：桌面和手机宽度的 Attention 弹窗、侧栏 Start/Wrap up。不对用户的真实卡片执行收尾。
- 按用户此前决定，Luna 验收暂不运行，记为 UNRUN。
