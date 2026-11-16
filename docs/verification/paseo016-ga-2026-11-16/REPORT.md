# Paseo 0.16.0 正式版：配套项复验

2026-11-16，卡片 `2b09705c-3c41-4750-81a5-ba63a0c9b9b8`。最新结论：**候选 ba4aa41 的自动化、独立 GPT 6 Luna 与真实 0.15.4 回退通过；手机收益与生命周期通过。冷启动三对有效提交中位数约慢3.7%；用户已明确接受5%内波动，Luna复核通过。PR #115 等待CI与CodeRabbit后合入。**

## 删除清理修订（当前最终源码）

`d38c8ab39e643fd412727d35d84651a4fa6ab556` 在补轮读取前重新标记完整同步，避免旧绑定读取先消耗dirty后，空绑定补轮跳过删除清理。冷/热缓存两例先在363红灯，再在新码绿灯，其他metadata仍保留；普通失败不自旋回归保留。

实现者：typecheck exit0，全量exit0，165文件通过/1跳过，1503测试通过/6跳过/0失败，18.08s。新的独立Luna会话c404283c-f6db-4c45-89d3-546773405cd3对精确d38c8ab typecheck及5文件55聚焦后给出PASS，见 [当前独立报告](LUNA-CLEANUP-FINAL.md)。旧4d8临时通过与最终WITHHELD时序已由该独立会话注释，失败证据均保留。

客户端产品源码仍未变化，先前手机/旧宿主证据保持原取样边界。PR #115仍须最终CI和CodeRabbit补审；用户明确选择继续等待额度，不使用管理员绕过。

## CodeRabbit 修订与最终独立复核（最新）

产品源码 `363073cc8686af4ab180279ca8fa0c73be029e68`。归档工作区缺失扫描已加有界复查；用户另行批准的忙时补轮保护覆盖绑定读取及资源同步两阶段，普通失败不自旋。旧bdf的3回归失败和旧4d8绑定读取窗口的1失败均确定复现，未削弱原断言。详见 [修复记录](CODERABBIT.md)。

- 实现者该修订：typecheck exit0，全量exit0，165文件通过/1跳过，1501测试通过/6跳过/0失败（19.57s）。
- [最终独立GPT6Luna](LUNA-FINAL.md)：精确363073c typecheck exit0，5文件53项聚焦全部通过，最终PASS。此前4d8未放行记录仍保留在LUNA-CANDIDATE.md。
- 客户端产品源码没有变化；先前真实手机与0.15运行时记录保留各自源代码边界，不写成本次重新真机或旧宿主取样。用户明确同意的冷启动5%配对中位差标准继续适用，实测+3.7257%，单对+8.95%及INVALID/未配对样本完整保留。
- PR #115 的CI、CodeRabbit和所有线程仍须完成后才能合入；自动合并保持关闭直到实际审查完成。回调ref意见因唯一调用方传入稳定函数未改客户端，依据已回复并解决线程。

## 首个候选提交检查

候选 `ba4aa41d39c291de197d8836d58b66d5aaa5580a`，父提交 `7f66c31`。从最新主分支隔离选取本卡改动，保留图片、仓库检查和composer已合入行为，未将共享根目录的其他删除或改动带入候选。

- 实现者：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` exit0；`npm test -- --reporter=dot` exit0，165文件通过/1跳过，1496测试通过/6跳过/0失败。
- [独立GPT6Luna](LUNA-CANDIDATE.md)：精确候选typecheck exit0，5文件48项聚焦测试exit0；真实0.15.4隔离daemon启动、metadata缺方法回退和后续board读通过，fixture清理。真实0.15客户端UI未跑。
- [手机补测](PHONE.md)：静止目标读取51→1（约98%减少）、约0.3秒变更、订阅关闭/拒绝后的轮询回退与自动恢复、绑定全生命周期通过；完整冷启动已用直达链接补测，三有效配对首次提交中位4294.5→4454.5ms（+3.7%），原零退化门槛未通过；用户查看数据后明确接受5%内波动，Luna已复核通过。粗采样、INVALID、未配对和后续反向样本全部保留，未挑样宣称通过。
- 宽屏/紧凑web卡片展示和返回通过，截图由规定shot-lib生成。临时打点已移除、设置恢复。用户已在问题工具明确接受5%内波动，Luna独立复核通过；PR https://github.com/JasprW/flowly/pull/115 已创建，须CI和CodeRabbit通过后才合入。

## 正式版运行时补验（最新）

- [手机结果](PHONE.md)、[汇总数据](phone-measurements.json)：Pixel 9 Pro / Paseo 0.16.0，两组稳定窗口目标读取 51→1（约98%减少），变更约306±40ms提交；实际关闭/拒绝订阅后回退轮询，无重载恢复，恢复后约280±61ms提交。完整冷启动因宿主恢复 `Workspace unavailable` 路由无效，未写成通过。
- 元数据真实创建、改绑、删除、Wrap up/unwrap、后台 agent、镜像错误纠正通过；创建后2分钟缓存跳过和完整轮错误跳过均有常规回归。整理候选时保留了主分支普通读写失败重试修复及原有两项回归，未削弱失败断言。
- [Luna 旧宿主报告](OLD-HOST.md)：真实0.15.4 daemon通过方法缺失回退、项目/卡片RPC与metadata未写入检查；真实旧客户端UI未运行。
- 所有临时打点已移除，设置恢复，fixture已清理。用户指定GPT6Luna替代额度用尽的Haiku；精确候选验收另记。§3.7仍按用户决定暂缓。
- 本轮没有新界面、设置或heartbeat字段，不新增引导、tip或What's new；默认本机镜像与推送行为补到README和OVERVIEW。

下文保留早期轮次的结果与当时未跑项，不能把其中的历史状态当作最新结论。

## 修复复验

- 用户本轮要求修复首轮报告中的改绑回归、跟随前置任务锁定正式版并保留回归测试。
- `server/session-metadata.ts`：清理阶段按当前受管 agent ID 集合判断，只清除已不受管的 session；改绑 session 已在写入阶段更新，不再因列表旧快照的 taskId 不同而被再次清空。
- 原诊断已迁入常规 `server/session-metadata.test.ts`，覆盖启动首轮和已有缓存后改绑两种情况；同时断言真正解绑后清除两个 Flowly 键并保留其他元数据。移除本目录重复用例和专用配置，避免回归只存在于常规测试排除的证据目录中。
- 根目录 SDK 跟随前置 PR #100（`refactor/paseo16-background-agents`，检查时 HEAD `524cc67`）同样锁定 `@getpaseo/client`、`plugin`、`protocol` 为 `0.16.0`；传递依赖 `relay` 为 `0.16.0`。本轮相对原 lockfile 只变更根依赖声明及这四个包；`npm ls ... --depth=1` 无依赖冲突。Flowly 自身版本仍为 `1.8.0`，最低宿主仍为 `>=0.15.0`。
- 同步 §3.6 的清理契约和 §4 的 SDK 锁定；将 §1 的 0.15/npm 信息标明为调研时快照。
- 验证对象仍为同一共享根目录的未提交工作树（HEAD `9d3b75f33b66c233301fb690575aa207ce8cc3f7`），不是隔离候选提交或独立验收。已保留其他会话的改动；本轮不重载插件、不改真实卡片绑定。

| 命令（均 `NODE_ENV=test FLOWLY_TELEMETRY=0`） | 退出码 | 结果 |
|---|---:|---|
| `npx vitest run server/session-metadata.test.ts server/host-support.test.ts --reporter=dot` | 0 | 2 文件 / 14 测试通过，含新增的 2 个改绑回归。 |
| `npm run typecheck` | 0 | 正式版 SDK 下通过。 |
| `npm test -- --reporter=dot` | 0 | 162 文件通过 / 1 跳过；1465 测试通过 / 6 跳过 / 0 失败。 |

本轮没有用户界面、开关或遥测字段变化，不新增引导、tip、What's new 或 heartbeat 字段。没有新增 fixture 资源、临时构建目录或隔离缓存。手机、真实 daemon 绑定生命周期、UI 断线恢复、真实 0.15 及候选提交独立验收仍为 UNRUN；下文保留修复前的首轮证据。

## 首轮范围与输入（修复前）

- 工作目录：项目根目录；HEAD `9d3b75f33b66c233301fb690575aa207ce8cc3f7`，**包含多个会话的未提交改动**，不是该提交的独立验收。此卡实现仍在根目录，未发现对应 PR。
- 使用 `docs/PASEO-0.16-SPEC.md` §2、§3.5–§3.7、§4，`docs/PROGRESS.md` 的 2026-11-12/13 记录，以及 `docs/SINGLE-ROOT-SPEC.md`、`docs/PERFORMANCE-SPEC.md`、`docs/PHONE-TESTING.md`。
- §3.7 按 2026-11-13 用户决定继续暂缓，不把缺少 hook 替换判为本次回归。
- 本机 CLI / daemon 均为 `0.16.0`；Flowly 运行目录为本项目根目录。未安装、重载插件或重启 daemon。
- 仓库三个 SDK 依赖仍为 `0.16.0-beta.2`。为正式版验证，在本任务自己的临时目录隔离安装 `@getpaseo/{plugin,client,protocol}@0.16.0`，未改根目录 manifest、lockfile 或 node_modules。临时 SDK 和测试文件已清理；共享 npm 缓存保留。

## 首轮 PASS

| 检查 | 结果与边界 |
|---|---|
| 正式版 daemon 能力 | 使用正式版 client SDK 直接连接；`server_info.version=0.16.0`，`entityMetadata=true`、`pluginSubscriptions=true`。 |
| 已有卡片元数据 | 本卡 session 的 `flowly.taskId`、`flowly.agentId` 均正确；本卡工作区的 `flowly.taskId` 正确。只是读取已有绑定，不等于新建/删除/改绑端到端验收。 |
| 真实插件订阅 | `board.changes` 建立成功，收到 `{seq:5, scope:"all"}` 首事件，约 3 ms。已释放订阅并关闭测试连接；此时间不是变更到界面的延迟。 |
| 正式版 SDK 类型兼容 | `tsc --noEmit -p <临时 tsconfig>`，对根目录代码将 SDK imports 映射到隔离安装的正式版声明，exit 0。没有发现正式版 API 导致的类型错误。 |
| 正式版 SDK 聚焦测试 | 临时 Vitest 配置映射到正式版 SDK，选择 session-metadata/change-feed/host-support/session-chips/query-activity：exit 0，11 文件、120 测试通过。该配置同时匹配了 3 个已有 worktree 中的 query-activity/session-chips 副本，因此不能把 120 全算作根目录新增覆盖。 |
| 末次根目录类型检查 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck`：exit 0。 |

## 首轮 FAIL：改绑时把刚写入的新 taskId 清掉（现已修复）

位置：`server/session-metadata.ts:130–143`。

步骤：session `a` 原来绑定 `old`，镜像也是 `old`；插件绑定改为 `new` 后调用 `changed()`，下一轮 `sync()` 执行完整同步。

实际写入顺序：

```json
[
  {"flowly.taskId":"new","flowly.agentId":"a"},
  {"flowly.taskId":null,"flowly.agentId":null}
]
```

原因：前半轮根据新绑定写入 `new`；清理逻辑仍使用本轮开始时取到的旧 agent 快照，发现旧 `taskId` 与新绑定不同，又把该 session 当作失去绑定的对象清除。最终元数据为空，违背 §3.6「绑定变化时同步更新」；后续轮次即使补回，也不能把本轮结果视为正确。

这是确定的顺序执行复现，不依赖并发、计时或真实用户资源。已有单测“session moved to another card”没有在第二轮前调用 `changed()`，没有覆盖完整同步的清理路径。

修复后的常规回归命令（当前 exit 0）：

```sh
NODE_ENV=test FLOWLY_TELEMETRY=0 npx vitest run server/session-metadata.test.ts
```

首轮的独立诊断曾保存在本目录并排除在常规测试之外；修复时已迁入上述常规测试，首轮失败输出仍保留在本报告中。

## 首轮自动化执行记录（修复前）

- 首轮根目录 `npm run typecheck`：exit 2，composer-fill 测试的 mock 不接受 `PluginComposerSelector` 的全部类型。
- 首轮根目录 `npm test -- --reporter=dot`：exit 1，161 文件通过 / 1 失败 / 1 跳过；1454 测试通过 / 9 失败 / 6 跳过。9 个失败均为翻译目录残留 `Stage`。
- 检查期间共享目录中的 composer mock 和上述翻译残留被其他改动修正，因此针对变更后的输入复验；本会话没有修改它们。
- 末次根目录 `npm test -- --reporter=dot`：exit 1，162 文件通过 / 1 失败 / 1 跳过；1463 测试通过 / 1 失败 / 6 跳过。**唯一失败是本轮放在临时目录的上述改绑诊断用例**；常规测试未再失败。随后已将复现用例移入本报告目录并清理临时目录。不能把此非零退出报告成全量通过。
- 正式版 SDK 下单独执行改绑诊断：exit 1，0 通过 / 1 失败，`expected undefined to be 'new'`。它验证的是 Flowly 的同步逻辑；不是正式版 SDK 删除了元数据。

## 未运行及放行条件

- 手机收益与冷启动：UNRUN。`adb devices` 无设备；AndroMeld 返回 control socket 不存在；用户本轮明确「暂时无法连接」。没有创建 performance 设置文件，没有驱动手机。按 PERFORMANCE/PHONE-TESTING 的要求，桌面结果不能代替真机收益。
- 新卡片/session 创建、真实 daemon 删除清除、Wrap up/unwrap、断线后轮询回退及恢复、界面 1 s 内刷新、静止界面读取计数：本轮 UNRUN。11 月 12 日的 beta 证据不冒充正式版新证据。
- 真实 0.15 宿主回归：UNRUN；现有缺少方法/拒绝/重试的单测通过，不等于真实旧宿主验收。
- 精确候选提交上的独立 Haiku 验证：UNRUN；尚无可放行候选提交，不进入 PR/合入阶段。

首轮发现的两项文档/代码差异（§3.6 改绑后误清空、§4 SDK 仍锁 beta.2）均已在本轮修复。下一步完成手机及剩余运行时验收，再对隔离候选提交检查并走 PR。

本轮没有用户可见行为、开关或遥测变化，不需要新增引导、tip、What's new 或 heartbeat 字段。没有创建项目、工作区或 session fixture，没有删除既有资源。

## 验收资源清理

- 独立会话：f41e3a19-ea2a-4090-8a9c-dc3100657f50（旧宿主与前两轮候选）、e72bfcbe-949a-4f77-bd55-32e04d293957（363073c最终验收）。均在本卡原workspace创建，codex/gpt-6-luna、full-access、background；两者已hard-delete并以原生状态API/DaemonClient.fetchAgent确认不存在。额度用尽的Haiku测试会话0547ebba-6ee0-4b0c-8ef9-85109c4fe61d亦已清理。
- 手机/元数据fixture的project/card/workspace/agent清理见PHONE.md；旧宿主两次fixture清理见OLD-HOST与LUNA-CANDIDATE。17767、17768端口已无隔离daemon监听。
- 本任务旧SDK目录约555MiB、原始手机临时目录约4.7MiB、cold-control worktree均已移除；脱敏聚合与规定截图保留在docs/verification。没有删除共享npm缓存或其他任务资源。
- 清理脚本曾误用SDK ref.refresh校验raw delete：ref仍保留旧snapshot，导致“仍存在”的脚本断言。原生get_agent_status与raw fetchAgent确认已删除；这是验证脚本缓存判断错误，不是删除失败，未盲目重删。
- 所有P16临时打点和故障开关已移除，performance.json恢复原log:false；当前开发目录typecheck后仅reload插件并确认running，没有重启用户daemon。候选worktree及依赖暂为PR/卡片检查保留。
