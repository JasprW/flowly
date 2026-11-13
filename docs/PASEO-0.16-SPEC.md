# Paseo 0.16 插件能力：调研与接入设计

2026-11-11，卡片「paseo 0.16 plugin」。状态：已设计；§3.1、§3.2 已实现（卡片「Paseo 0.16 接入：后台任务」，基于 0.16.0-beta.1，2026-11-12 升到 beta.2 并在用户本机 0.16.0-beta.2 daemon 上实测）。用户决定（2026-11-11）：重点做后台任务（§3.1、§3.2）和 composer（§3.3、§3.4）；侧栏视图、New workspace 项、按设备的设置和其余低优先级能力暂缓（on hold，§3.8），设计保留。每一项接入都要另开卡片，先在本文件补齐该项的契约再动代码。

## 1. 出处与前提

- 出处：npm `@getpaseo/plugin@0.16.0-beta.1`、`@getpaseo/client@0.16.0-beta.1`、`@getpaseo/protocol@0.16.0-beta.1` 的 `.d.ts`（`dist/client/*.d.ts`、`dist/client/composer.d.ts`、`dist/shared/*.d.ts`、`dist/server/*.d.ts`、client 包 `dist/index.d.ts`），对照 Flowly 当前锁定的 0.15.0；changelog <https://paseo.sh/changelog#release-0.16.0-beta.1>（2026-11-10）。
- Flowly 当前：`@getpaseo/plugin`、`@getpaseo/protocol`、`@getpaseo/client` 锁在 0.15.0，`paseo-plugin.json` 的 `requirements.paseo` 为 `>=0.15.0`。npm `latest` 为 0.15.4，`beta` 为 0.16.0-beta.1。
- 本机 daemon 0.15.4 的 `server_info.features` 只报 `backgroundWorkspaces`、`agentConfigApply`，不报本文用到的任何新标志。所以下面每一项都要求 0.16 宿主。
- 范围：只列 Flowly 能用上的能力。平板/键盘适配、diff 提速、移动端 timeline 重做是宿主内部改进，Flowly 不用改动，不列。

## 2. 能力探测

插件拿不到 `server_info.features`：`PaseoApi` 和客户端 `PluginClientContext` 都没有暴露它。探测只用下面三种方式，按优先级：

| 方式 | 适用 | 做法 |
|---|---|---|
| A. 贡献函数存在 | 客户端新贡献点 | `typeof client.addComposerItem === "function"` 之类。0.15 宿主没有这些函数，判断为假就不注册，界面保持 0.15 的样子。 |
| B. 调用并识别拒绝 | daemon 侧新方法 | 0.16 `DaemonClient` 在宿主不支持时抛出固定文案的错误（如 `Update the host to use background agents.`、`Update the host to use metadata.`）。第一次调用遇到这类拒绝时，按 daemon 启动缓存“不支持”，本次启动内不再尝试，回到 0.15 路径。拒绝不进 `$exception`，只记日志（与本地 daemon 未就绪的处理相同）。 |
| C. 宿主版本号 | 只能整体判断时 | 复用 `server/paseo-version.ts` 读到的版本，`>=0.16.0` 视为支持。只作 B 不可行时的兜底，因为它不能区分功能被关掉的宿主。 |

导入新接口：`@getpaseo/plugin/server`、`@getpaseo/plugin/client` 等模块在运行时由宿主提供（服务端 bundle 把它们当外部模块），0.15 宿主上 0.16 才有的导出（如 `defineSubscription`、`useComposers`、`Combobox`、`useAgents`）是 `undefined`。所以不得在模块加载时调用或渲染它们：先判断 `typeof … === "function"`（或组件存在），不存在就走 0.15 路径。SDK 升级的验收包括：0.16 SDK 构建的插件装在 0.15 宿主上能正常加载，看板、session 页和 pill 行为与升级前一致。

协议里的服务端标志名（`server_info.features.*`）与 0.16 客户端的守卫，作为对照记录在每项能力里；插件不直接读它们。

不一致记录：协议的 COMPAT 注释写着 `backgroundAgents`、`pluginSubscriptions` 在 v0.15.0 加入，`workspaceArchiveUndo` 在 v0.15.3 加入，但本机 0.15.4 daemon 不报这三个标志。以 daemon 实际行为为准：一律按 0.16 才有处理，并且只用 A/B 探测，不按注释里的版本号判断。

## 3. 能力清单

重点四项排在最前（§3.1–§3.4），配套能力其次（§3.5–§3.7），暂缓的列在 §3.8。每项写：0.16 API、探测、Flowly 用法、旧宿主行为、验收。

### 3.1 后台 agent（background agents）【重点】

- **API**：`@getpaseo/client` 的 `agents.create({ background: true, metadata })`。后台 agent 不出现在默认列表、标签页、子 agent 轨道和通知里；它新建的工作区也是后台工作区。
- **对照标志**：`features.backgroundAgents`；客户端守卫 `requireBackgroundCreation`（未给 `workspaceId` / `callerAgentId` 时改查 `backgroundWorkspaces`）。
- **探测**：B。
- **用法**：卡片总结、窗外 insight、项目记忆复盘、Insights 摘要、workflow insights、自动验收的评审 session 改为后台 agent，用户的 session 列表和通知里不再出现这些临时 session。
- **实测结论**（2026-11-11，隔离的 0.16.0-beta.1 daemon，Claude haiku）：
  - 后台 agent 运行中和结束后都不在默认 `agents.list` 里；归档后也不在默认的归档列表（`filter.includeArchived`）里，只有带 `includeBackground` 才列得出。Paseo 应用的历史视图不请求后台 agent，所以**归档后的后台 agent 不会堆在用户的归档里**。
  - `deleteAgent` 对后台 agent 照样有效。
  - 不给 `workspaceId` 时，每次创建都会新建一个后台工作区；给定已存在的工作区则不新建。
  - 旧宿主的拒绝文案：0.16 client 对旧 daemon 为 `Update the host to use background agents.`；0.15.0–0.15.3 client 为 `Update the host to use background workspaces.`；0.15.4 daemon 拒绝 `background` 与 `workspaceId` 同时出现（`background is workspace creation intent; ...`）。三者都按 §2 B 识别为“不支持”。
- **契约**：
  - 创建（`server/background-agent.ts` 的 `createHidden`）：先带 `background: true` 创建；遇到上面的拒绝文案时记日志（不进 `$exception`），本次插件启动内不再尝试，并立即按 0.15 方式重建这一次。其它创建失败照旧按各功能的失败处理。
  - 卡片级运行（卡片总结、窗外 insight、自动验收）仍在卡片自己的工作区里创建，只是加上 `background: true`。
  - 项目级运行（记忆复盘、Insights 摘要、workflow insights）在已知支持后台 agent 时，改用每个项目一个**后台工作区**（`workspaces.create({ background: true })`，标题仍为 `Flowly background`，id 记在 `background-workspaces.json` 的 `hidden`）。它本身不出现在侧栏，所以不归档、不恢复，一直复用；被删或已归档时新建一个。支持情况未知（插件启动后的第一次运行）时，只要任一项目记有隐藏工作区（支持与否是宿主的属性）就按隐藏路径走，宿主拒绝后台创建再回到可见流程；一条记录都没有（本机第一次运行）或已知不支持时走原来的可见工作区流程（`docs/BACKGROUND-WORKSPACE-SPEC.md`）。
  - 结束清理（`server/summarizer-remove.ts`）：后台 agent 用 SDK 的 `archive()`，不再走本地连接硬删除；归档失败时退回硬删除。非后台 agent（旧宿主）仍硬删除。代价：后台 agent 的记录留在宿主磁盘上，只是不显示；用户界面里看不到，也不占归档列表。
- **旧宿主**：现有临时 session、`Flowly background` 工作区与硬删除流程不变。
- **验收**：0.16 宿主上上述运行期间，Paseo 的 agent 列表、标签页和通知中看不到它们；运行结果与 0.15 一致；运行结束后 Paseo 归档列表里不新增条目；0.15 宿主行为不变。

### 3.2 Agent 后台任务（background work）【重点】

- **API**：agent handle 的 `backgroundWork.list()`、`backgroundWork.stop()`、`backgroundWork.subscribe()`。provider 侧支持 Claude、Codex、OpenCode v2；宿主把它们显示在 composer 上方。
- **对照标志**：`features.agentBackgroundWork`；守卫 `assertAgentBackgroundWorkSupported`。
- **探测**：B。
- **用法**：
  - 自动验收：交付时该 session 仍有后台任务在跑（例如测试进程），把它们写进评审输入，不等待（`docs/AUTO-REVIEW-SPEC.md` §4.4）。不等待的原因：后台任务可能是永不结束的 dev server 或 watcher，等待会让评审无限期挂起。
  - Wrap up 预检：有后台任务在跑的 session 与“运行中”同样阻止 Wrap up（`docs/MULTITASK-SPEC.md`）。自动 Wrap up 与删除卡片时的归档沿用同一预检，所以也被阻止。
  - 卡片 session 状态：“空闲但有后台任务”单独显示为 `Background tasks running`，不显示成已完成。
- **读取方式**：Wrap up 预检与 session 状态读 agent 快照里的 `backgroundWork.count`（宿主随 agent 更新推送，不另外轮询）；自动验收在交付时调一次 `backgroundWork.list()`（5 秒超时，最多 20 条）取描述。旧宿主的快照没有这个字段，按 0 处理；`list` 不存在或失败时当作没有后台任务。
- **旧宿主**：不查询，行为同今天。
- **验收**：0.16 宿主上，有后台任务的 session 阻止 Wrap up 并显示原因；自动验收在有后台任务时按 AUTO-REVIEW-SPEC 新增的规则处理；查询失败按 B 降级，不阻塞交付。

### 3.3 Composer 填入与聚焦【重点】

- **API**：`useComposers({agentId} | {focused: true})`（任何插件组件）、`client.composers(selector)`，返回 `PluginComposer`：`context`（`agent` / `draft` / `new-workspace`）、`prompt`、本插件的 `attachments`、`agent{provider, model, mode, thinking, options, metadata}`；方法 `setPrompt`、`insertText`（光标处插入）、`focus({selection})`、`addAttachment`、`removeAttachment`、`setProvider`、`setModel`、`setMode`、`setThinking`、`setOptions`、`setMetadata`。标签页关着也能拿到运行中 agent 的 composer。
- **`focus()` 行为**（宿主负责，#9207）：在屏幕上只放光标；被 sheet/菜单/弹层挡住先关掉；在别的标签、工作区或手机面板后面先导航过去再聚焦；草稿或 New workspace 不在屏幕上时拒绝，不把用户拉过去；agent 已归档或 15 秒内没出现时拒绝。
- **探测**：A（`typeof client.composers === "function"`）。
- **用法**：Next moves 的“填入”（原生 session 页的 Next moves 卡片与 Flowly 内的建议行）改用 `setPrompt` 加 `focus()`，替换 `client/web-composer.ts` 的 DOM 查找；手机上也能填入（现在手机只能复制）。需要用户补写的建议可用 `focus({selection})` 选中待补的那段。图片附件可以改走 `addAttachment`，但 `client/web-images.ts` 的粘贴/拖放监听仍需要，见 §5。
- **约束**：只往输入框里放用户看得见的文字，由用户自己发送；不在发送时追加任何隐藏内容（AGENTS.md：普通跟进只发用户的原文）。
- **旧宿主**：保留 `client/web-composer.ts` 现有路径（web 填入，其余复制）。
- **验收**：0.16 宿主上 web 和手机点 Next move 都把文字填进对应 session 的输入框并聚焦，不发送；输入框已有文字时在其后空一行追加，与 `docs/NATIVE-SESSION-SPEC.md` §6.4 现行规则相同；`focus()` 被拒绝时退回复制并提示；0.15 宿主行为不变。

### 3.4 Composer 控件【重点】

- **API**：`client.addComposerItem({ id, Component })`，组件里 `useComposer()` 拿到所在的 composer（§3.3 的同一个对象）；`client/ui` 的 `Toggle`、`Select`、`Action`、`Combobox`（带防抖 `search`）。宿主按实际渲染宽度决定行内显示还是收进溢出面板（#9209）；组件返回空时不占位置。`addComposerPill` 仍在且未废弃。
- **探测**：A。
- **用法**：
  - 卡片 session 的 composer 上放“卡片阶段”`Select`（切换泳道）和 “Next moves”（`Action` 或 `Combobox`，选中即按 §3.3 填入）。
  - 非卡片 session、草稿和 New workspace 的 composer 返回空。判断“是不是卡片 session”用 §3.6 的元数据，元数据不可用时走现有的插件 RPC 查询。
  - 逐步替换 `client/session-link.ts` 里的 composer pill；0.15 宿主上继续用 pill。
- **候选（接入卡片里再定）**：
  - 引用卡片：`Combobox` 搜本项目的卡片、想法、记忆，选中后把摘要作为可见文字插入或作为附件加入。
  - 草稿接入：在卡片工作区的新 session 草稿上 `setMetadata({ "flowly.taskId": … })`，创建时由 hook 注入 Flowly MCP，省去手动 “Send Kanban work instructions”。需先实测草稿 metadata 是否随创建请求带上。
- **约束**：
  - 宿主为量宽度会多渲染一份控件，effect 可能执行两次：控件挂载时不发请求、不写数据，读数据走 `client/queries.ts` 的共享查询，写只在用户操作时发生。
  - 一张卡的 composer 最多放两个控件，避免手机上全被挤进溢出面板。
  - 不加说明性文字（AGENTS.md：UI 保持简洁）；所有文字走 `t()`。
- **旧宿主**：保留 pill。
- **验收**：0.16 宿主上卡片 session 的 composer 显示阶段选择和 Next moves；非卡片 session 不显示；切换阶段与看板上拖动结果一致（同样校验、同样拒绝过期修改）；窄屏时控件进入溢出面板仍可用；0.15 宿主仍显示 pill。

### 3.5 插件订阅（push）

- **API**：shared `defineSubscription({ name, input, event })`；server `handle(contract, (input, { push, signal }) => …)`；client `subscribe(contract, input, onEvent, options)` 与 `useSubscription(contract, input, onEvent)`，状态为 `connecting` / `live` / `closed` / `error`。
- **对照标志**：`features.pluginSubscriptions`；守卫 `requirePluginSubscriptions`。
- **探测**：A 判断客户端有 `subscribe`，再按订阅状态：进入 `error` 或长时间停在 `connecting` 时回到轮询。
- **用法**：看板、卡片详情、overview 的变化由 daemon 推送“已变更”事件，客户端收到后再走现有的 etag 读取；替换 `client/queries.ts` 里 5 秒的 overview 轮询和 3–30 秒的若干轮询。事件只带变更标记，不带整份数据（手机 JS 线程解密成本，`docs/PERFORMANCE-SPEC.md`）。§3.2 的后台任务变化也可经此推到卡片。
- **旧宿主**：现有轮询不变。
- **验收**：0.16 宿主上屏幕静止时不再有周期性读取；变更在 1 秒内反映到界面；订阅断开后自动回到轮询并在恢复后再切回；手机冷启动时间不变差（按 PERFORMANCE-SPEC 测）。

### 3.6 实体元数据（metadata）

- **API**：workspace handle `setMetadata`，agent handle `setMetadata` 与 `metadata`；`agents.create({ metadata })`；lifecycle hook 里 workspace 和 agent 带 `metadata`，`agent.open.before` 可返回 `metadata`；composer 也有 `setMetadata`。
- **对照标志**：`features.entityMetadata`；守卫 `requireEntityMetadata`（`Update the host to use metadata.`）。
- **探测**：B。
- **用法**：在卡片的工作区、Flowly 创建的 session 和 §3.1 的后台 agent 上写入 `flowly.taskId`（只写 ID，不写标题等内容）。它是 Flowly 自己记录的镜像，不是事实来源：卡片与工作区的绑定仍以插件数据为准；镜像让 §3.4 的控件和 hook 不经 RPC 就知道一个 session 属于哪张卡。
- **旧宿主**：不写，所有判断走插件数据。
- **验收**：0.16 宿主上新建卡片工作区和 session 后元数据可读到对应 `taskId`；绑定变化（删除卡片、unwrap）时同步更新或清除；元数据与插件数据不一致时以插件数据为准并修正元数据。

### 3.7 客户端状态 hook（含 workspace indicator）

- **API**：`useWorkspaces`、`useAgents`、`useProjects`、`useTerminals`（Query，支持 `groupBy`）、`useAgent`、`useWorkspace`、`getSnapshot()`。`PluginWorkspaceSnapshot` 新增 `indicator`（`needs_input` / `failed` / `running` / `attention` / `done`）、`indicatorLabel`、`branch`、`lastPromptAt`、`parentAgent` 等；`PluginAgentSnapshot` 新增 `ref`、`workspace`、`parentAgent`、`metadata`。
- **探测**：A（hook 导出存在）。
- **用法**：卡片上的 session 状态、“Needs you”和运行中标记直接读宿主状态，替换 `client/session-link.ts` 每 5 秒的轮询和 `client/queries.ts` 的实时 agent 列表（20 秒流式 / 5 秒兜底）。
- **旧宿主**：现有查询不变。
- **验收**：0.16 宿主上 session 状态变化与宿主侧栏同步出现；不再产生上述轮询请求；0.15 宿主不变。

### 3.8 暂缓（on hold，用户决定 2026-11-11）

以下能力保留设计，但不在这一轮做；重点四项（§3.1–§3.4）完成后由用户决定是否恢复。

#### 3.8.1 侧栏视图（sidebar view）

- **API**：`client.addSidebarView({ id, title, description?, Component })`；组件 props 含 `active{ workspace, agent }`、`navigation{ openWorkspace, openAgent, openTerminal, openProject }`、`dismiss()`；可用 `SidebarRow`、`SidebarSeparator` 与 §3.7 的 hook。视图替换宿主侧栏的整个内容区（宿主保留顶部和底部），用户在 Settings → Sidebar 里按设备选一个视图；插件停用时退回默认视图，视图崩溃时宿主提供恢复入口（#8906）。
- **探测**：A。
- **用法**：提供一个“按卡片分组”的侧栏视图：当前项目的卡片，每张卡下列出其 session，点击用 `navigation.openAgent` / `openWorkspace` 打开。只做导航，不在侧栏里编辑卡片。因为它替换整个默认列表，还必须列出未绑卡的工作区、其他项目和终端，否则用户会找不到它们。
- **依赖**：卡片归属用 §3.6 的元数据；数据只用 §3.7 的 hook 或 §3.5 的推送，不新增轮询。
- **旧宿主**：不注册，现有 `addSidebarHeaderItem` 入口不变。
- **验收**：0.16 宿主上 Settings → Sidebar 能选到 Flowly 视图；选中后显示卡片与 session 分组和其余工作区，点击能打开对应 session；不新增轮询。

#### 3.8.2 New workspace 项

- **API**：`client.addNewWorkspaceItem({ id, Component })`；`useNewWorkspace()` 提供 `host`、`project`、`isolation`、`baseRef`、`branch`、`metadata` 与对应 setter。
- **探测**：A。
- **用法（待决策，见 §7 D1）**：在宿主的 New workspace 界面选一张没有工作区的卡片，新建的工作区绑定到它。
- **旧宿主**：不注册。
- **验收**：决策后补写。

#### 3.8.3 按设备的设置（device scope）

- **API**：设置项 `scope: "host" | "device"`。
- **探测**：A（接入前实测 0.15 宿主对未知 scope 的处理，若报错则只在 0.16 宿主声明 `device`）。
- **用法**：看板视图偏好（列宽、折叠、紧凑模式）等只关乎当前设备的设置改为 `device`；语言、功能开关、模型等仍为 `host`。现在 `shared/settings.ts` 全部是 `host`。
- **验收**：0.16 宿主上手机和桌面各自保存看板视图偏好，互不覆盖；从 `host` 改 `device` 时把已有值作为各设备的初始值，不丢失。

#### 3.8.4 低优先级

- **工作区 handle**：`setPinned`、`setLabel(name, { assigned })`、`setBaseBranch`。可选用途：进行中卡片的工作区打上泳道标签。
- **Provider 控件**：`providers.listControls`、agent `setOptions` / `options` / `controls`，`ProviderOptionControl`（toggle/select），标志 `providerOptionControls`。可选用途：New task 的模型设置显示 provider 自己的选项。
- **Diff、项目建议**：`DaemonClient` 的 `observeDiff`、`readDiff`、`listProjectSuggestions` 不在 `PaseoApi` 里，只能经本地连接用，不为它们新增例外。
- **`PASEO_WORKSPACE_ID` 环境变量**（#8939）：session 内可知自己的工作区。Flowly 的 MCP 已按连接识别卡片，目前不需要。

## 4. 顺序与依赖

1. 原定先等 0.16.0 正式版。用户决定（2026-11-11，后台任务卡片）：先用 0.16.0-beta.1 实现，SDK 依赖暂锁 beta（2026-11-12 跟随宿主升到 0.16.0-beta.2；beta.2 的 hook agent 多了 `background`，`agent.open.before` 请求的 `background` 为必填），正式版发布后改锁 0.16.0。`requirements.paseo` 不改。
2. SDK 升到 0.16.0 后，`requirements.paseo` 仍保持 `>=0.15.0`，所有能力按 §2 探测、0.15 回退。心跳加 `paseo_version`（用户决定 2026-11-11，和 SDK 升级一起做，复用 `server/paseo-version.ts`，同步改 `docs/TELEMETRY-SPEC.md` §4、`heartbeatProperties`、key-set 测试和隐私说明），用来看 0.16 的普及率。只有当用户看过普及率、决定放弃 0.15 宿主时才把 `requirements.paseo` 提到 `>=0.16.0`，并在同一改动里删掉 §5 标为“可删除”的回退代码与例外。
3. 实施分三个任务（用户决定 2026-11-11，不再按小节拆分）：
   - **Composer**：SDK 升级与 §2 探测（先做，后两个任务复用）、§3.3、§3.4。§3.4 判断卡片 session 时元数据还没有就走插件 RPC。
   - **后台任务**：§3.1、§3.2。§3.2 的自动验收部分和 §3.1 把评审 session 改成后台 agent 一起调整。
   - **其余**：§3.6、§3.5、§3.7，优先级低于前两个。§3.6 做完后，§3.4 和 §3.1 改为优先读元数据。
   §3.8 暂缓。

## 5. 对 AGENTS.md 例外的影响

只记录影响，不在调研卡修改 AGENTS.md；每项在接入它的卡片里改写对应例外，最低宿主提到 0.16 时再删除。

| 例外 | 0.16 后 | 依据 |
|---|---|---|
| web-composer（`client/web-composer.ts`，DOM 填入 Next move） | **可删除**（最低宿主为 0.16 时）；之前仅作 0.15 回退 | §3.3 composer `setPrompt` / `focus` 覆盖其全部用途 |
| Flowly background 工作区（`server/background-workspace.ts`，归档后经本地连接恢复） | **已收窄**：0.16 宿主改用不显示的后台工作区，不归档也不恢复，不用本地连接；归档/恢复只留给 0.15 宿主。最低宿主为 0.16 时**可删除**该例外 | §3.1 实测与契约 |
| 临时 session 硬删除（`server/summarizer-remove.ts`） | **已收窄**：后台 agent 用 SDK `archive()`（实测不进用户的归档），只有非后台 agent 和归档失败时才硬删除。最低宿主为 0.16 时**可删除**该例外 | §3.1 实测；SDK 仍无删除 agent（`deleteAgent` 只在 `DaemonClient`） |
| Unwrap 恢复工作区与 session（`server/workspace-restore.ts`） | **保留** | `PaseoApi` 仍无 restore / unarchive；`DaemonClient.undoWorkspaceArchive` 是新官方方法，但仍要本地连接，可在保留例外的前提下改用它 |
| 已读清除原生 attention（`server/session-reads.ts`） | **保留** | `clearAgentAttention` / `clearWorkspaceAttention` 只在 `DaemonClient` |
| 错误报告带 Paseo 版本（`server/paseo-version.ts`） | **保留** | `PaseoApi` 仍不暴露版本 |
| web 图片粘贴/拖放（`client/web-images.ts`） | **保留**；文件进入 composer 可改用 `addAttachment`，但粘贴/拖放监听和文件选择器仍需 DOM | composer API 无粘贴事件，也无文件选择器 |
| 手机 lane 横滑（`client/host-horizontal-scroll.ts`） | 不受影响 | 0.16 无相关 API |
| Android 返回键（`client/android-back.ts`） | 不受影响 | 0.16 无相关 API |
| 自动验收（Auto review） | 不改例外本身；评审 session 可改用后台 agent（§3.1），需考虑后台任务（§3.2） | `docs/AUTO-REVIEW-SPEC.md` 需补规则 |
| Wrap up | 不改例外本身；预检增加后台任务阻止项（§3.2） | `docs/MULTITASK-SPEC.md` 需补规则 |

## 6. SDK 仍缺的能力

以下在 0.16 的 `PaseoApi` / `PluginClientContext` 里仍没有，相关做法维持现状：打开文件、删除 agent、恢复工作区与取消归档 session、清除 attention、读取宿主版本与 `server_info.features`、渲染其他插件的 timeline 条目。

## 7. 待决策

- **D1 New workspace 绑定卡片（§3.8.2，暂缓）**：一张卡对应一个工作区、一个工作区不能绑两张卡。从宿主界面新建工作区再绑卡，等于给“卡片创建工作区”多开一个入口。恢复 §3.8.2 时需要用户决定：做（只列出还没有工作区的卡片），或不做（工作区仍只由 Flowly 新建卡片时创建）。
- **D2 最低宿主何时提到 0.16**：决定何时删除 §5 中“可删除”的回退代码与例外。用户决定 2026-11-11：先同时支持 0.15 和 0.16，等 0.16 普及后再提。普及率看心跳里的 `paseo_version`（§4 第 2 条）；提多少时由用户看数据决定。