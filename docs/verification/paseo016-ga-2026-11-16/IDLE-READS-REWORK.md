# 在线 chip 零周期读取返工

- 来源：自动验收 goal finding，PR #115 合入后的 `61511d7`。接受意见，不提争议；此前一分钟校对不符合本卡目标。§3.7 暂缓沿用，但不豁免 chip 的零周期读取要求。
- 修复：订阅首事件后取消定时 chip 轮次；变化推送/相关 agent 流事件/显式操作触发读取。连接中、失败和旧宿主继续原轮询；关闭立即补读，恢复后停止。设置变化经已有 sessions scope 推送；agent 流初始化与归档事件补齐原先依赖分钟轮次的刷新。无新 RPC 协议、依赖、UI、设置或 telemetry 字段，不需新增 tour/tip/What's new。
- RED：增强既有回归，静止180秒 chip看板读取由2→5，断言失败（1失败/24通过，exit1）；未弱化断言。
- PASS：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` exit0；`node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` exit0，5文件58通过。覆盖180秒无chip RPC/agent列表增长、推送更新、connecting/关闭回退/恢复、设置无board变更刷新、agent流初始化与归档后保留chip、停止后不再读取；保留拒绝时无重试循环的回归。
- PASS：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm test -- --reporter=dot` exit0，165文件通过/1跳过，1506项通过/6跳过。
- UNRUN：本轮手机UI/冷启动，AndroMeld socket不存在且adb无设备；无新0.15客户端UI样本。历史PHONE.md/OLD-HOST.md数据不充当新提交实测；历史冷启动按用户5%配对中位差标准的判断保留。
- 独立Luna的精确提交复核另由该会话拥有证据；实现者不编辑独立报告。

## 独立验收与清理

- 最终产品源码 `9fa5cc492c679c6a12756a7d5ae8acb2f52242f7`；独立 GPT 6 Luna（full-access，会话 `1dcd167e-52ee-408e-acd2-8c91c638e1a5`）typecheck exit0、5文件58聚焦 PASS。独立报告为 `LUNA-IDLE-READS.md`，报告提交 `40b0822`、会话ID更正 `a913f6b`；实现者未编辑独立证据。
- 最终源码冻结后再核对 typecheck exit0，全量 exit0（1506通过/6跳过，165文件通过/1跳过）。后续仅证据文档变化，不把未重跑的文档提交称为新源码测试。
- 测试session已hard-delete，`paseo agent inspect` 返回 AGENT_NOT_FOUND；本轮没有创建项目、卡片、workspace、fixture daemon或隔离缓存，未改性能设置。正常本地checkout的同范围patch在保留其他会话变更后通过typecheck，reload显示Flowly running；这只是载入smoke，不是UI验收。
- 返工 PR：https://github.com/JasprW/flowly/pull/117 。Node22/24与CI gate通过；首次CodeRabbit因额度跳过，自动合入保持关闭，按用户决定等约21:52恢复后再请求真实补审，不能把skipped当放行。最终合入状态见PR与卡片交付回执。

## CodeRabbit 补审与用户批准的最小修复

- 真实补审在额度恢复后完成（2026-11-16 22:00，本地时间），并非skipped：三条意见均由确定性回归复现。旧源码一次拒绝后不恢复（期望chip重建4次、实际2次）；旧设置响应保留fill而非copy；旧归档扫描只扫1轮而非补2轮。初始3失败/28通过；修好读取恢复后31通过/2并发失败，没有删掉失败回归。
- 用户随后明确批准两处最小并发保护并保留回归：settings generation和archive-removal counter只决定旧请求能否标记新鲜，以及是否补读，不新增定时轮询。归档旧响应成功/失败都有回归；没有新移除时失败不即时补查，stop后不再补查。
- 读取故障退避复用5/30/60 s，成功后停止，stop取消。另补初始stream完整列表失败的回归先红（完整读取期望3次、实际2次）；失败轮保留relist，不能把旧live集合当成恢复。
- 本轮 PASS：typecheck exit0；完整5文件聚焦65项通过，exit0；全量165文件通过/1跳过，1513项通过/6跳过，exit0。环境NODE_ENV=test/FLOWLY_TELEMETRY=0，命令同上。前面的9fa5cc4/Luna报告属于历史版本，不冒充本次最终源码验收；新候选的独立复核另记。
- 本轮没有新增真机/旧宿主客户端样本，既有UNRUN仍保留。

## 最终修复的独立复核

- 产品源码 SHA：`682fb4fe09dd800374ad72492f8c71dc83289c81`。GPT6Luna/full-access 独立会话 `a9101afd-26ed-4697-9eaa-84da40d58b8c` 对该SHA给出PASS：typecheck exit0，5文件65项通过。独立报告 `LUNA-IDLE-RECOVERY.md`（提交51928dd），由该会话拥有，父任务未编辑。
- 该测试会话随后hard-delete，inspect返回AGENT_NOT_FOUND；无新fixture、daemon或隔离缓存。根目录同范围patch已在保留其他会话改动后通过typecheck并reload running；未重启daemon、未改性能设置。
- 三条CodeRabbit线程均已按先红后绿证据回复并解决；新源码的真实补审在额度恢复后继续，不以neutral/skipped放行。新push一度未生成自动CI记录，最终报告推送后用同一分支的workflow_dispatch触发原CI，不改保护规则。实际CI/CodeRabbit与合入状态以PR#117和卡片交付回执为准。

## 后续失败路径补审与冷启动门槛

- 2026-11-16 23:00，真实CodeRabbit对682fb4f后的报告head完成补审：归档/设置/外部insights三个读取故障未实际恢复，另指出候选手机冷启动证据不足。三条读取路径均复现红灯（3失败/36通过），未删除失败断言。
- 最小修复：归档失败时实际安排15秒一次性补查（新扫描与stop取消）；设置失败保留失效并进入既有5/30/60退避，insights失败同样进入退避。恢复成功后不保留周期读取。完整5文件聚焦69项与typecheck通过，exit0；全量和最终独立报告随后记录。
- **本次候选手机冷启动门槛未满足。** 3043bd8的历史+3.7257%通过的是用户指定5%配对中位差标准，后续client/session-link.ts与server/session-metadata.ts已变；没有本次源码的手机样本。新AndroMeld连接仍失败，adb无设备。已向用户请求连接手机补测或明确授权本次补丁沿用，未获得决定前不合入。卡片对应验收项已撤勾。
- 实现者不修改独立验收报告；该门槛澄清由最终独立会话另记并追加到其指定证据。

## 用户对本次补丁的明确冷启动沿用授权

- 用户在被明确告知「本次客户端源码已修改、旧+3.73%来自较早源码、沿用不代表新源码真机验证」后，回复：**授权本次补丁沿用旧冷启动结论**。
- 该授权仅覆盖PR#117的当前chip零周期读取/故障恢复补丁（产品531adad），按原+3.7257%配对中位差/5%门槛接受沿用。候选本轮手机测量仍为UNRUN，没有将旧样本改成新样本；前一节授权前的门槛未满足状态保持历史。
- 本次全量exit0：165文件通过/1跳过，1517项通过/6跳过。最终独立复核与后续CodeRabbit结果另记。

## 531adad 最终检查与清理

- 独立GPT6Luna/full-access 会话 `87138694-ba59-497d-ace6-c9c4b09357ab` 对产品531adad给出代码/聚焦PASS：typecheck exit0，5文件69项通过；完整全量由父任务运行，1517通过/6skip。独立证据LUNA-ALL-READS.md与旧报告澄清提交39190d8，父任务未编辑独立文档。
- 会话已hard-delete，inspect返回AGENT_NOT_FOUND；没有新建fixture、daemon、workspace或隔离缓存。根目录同范围patch在保留其他工作后typecheck通过，按既有方式reload插件；手机、旧宿主UI与候选冷启动仍无新样本，按本次用户授权沿用冷启结论。
- 最新源码CI Node22/24与CI gate通过；最终报告提交后的状态及实际CodeRabbit补审/合入以PR#117为准，auto-merge在真实补审前保持关闭。

## 2026-11-17 原生agent流setup与名单合并

- 上轮真实CodeRabbit检查成功，但正文另有两条outside-diff意见；读取全文后继续处理，没有盲目合入。setup失败不重试、旧名单覆盖archive/create回归先红（3失败/40通过）；先修setup后41通过/2并发失败。
- 用户批准名单合并最小保护，并明确继续沿用本补丁旧冷启结论。名单新增/移除变化编号只使在途旧完整列表失效，保留流状态并补读；不增加周期轮询。setup失败清理监听，沿用5/30/60s重试，成功与stop结束故障重试。
- 修改后typecheck exit0、完整5文件聚焦73项通过。最终全量及Luna独立报告另记；本轮手机测量仍UNRUN，冷启按本次补丁明确授权沿用。

## 未知ID移除的独立阻断与修复

- Luna对3ab5ff8复现本地map尚无ID时的移除漏记，结论WITHHELD，报告LUNA-STREAM-RECONCILE.md（86e9198）保留；73聚焦/1521全量通过不充当该缺口的放行。没有推送此中间候选。
- 常规回归新增remove-unseen与archive-unseen，旧实现均复活旧session extras（2失败/43通过）。原始移除/归档事件现在不要求本地先有该ID；它使活跃完整列表与归档引用失效，旧响应不能覆盖它。新ID、已知ID的创建/归档回归一并保留。
- 修改后typecheck exit0、5文件75项通过；新的全量与同一Luna复验按新冻结SHA另记。用户对本补丁的最小修复与冷启继续沿用授权维持，本轮没有新手机测量。

## 最新最终验收 — deca6bd

- 最终产品源码 `deca6bd51c81ea0a01af8729820ebcb143a08515`。同一独立GPT6Luna/full-access会话 `d9ec9508-bc69-46e5-8961-44a09069807d` 复验PASS：typecheck exit0，5文件75项通过；报告 `LUNA-STREAM-FINAL.md`（0f8a473）。旧3ab5ff8的WITHHELD报告不改写、不当作放行。
- 父任务对本次新源码的全量exit0，165文件通过/1skip，1523项通过/6skip。磁盘16Gi下复用现有283MiB依赖/缓存，未运行构建或创建新缓存，测试仅少量临时写入。
- 测试会话已hard-delete，inspect返回AGENT_NOT_FOUND；无新fixture/daemon/workspace/隔离缓存。共享根目录两个对应client文件与deca6bd逐字节相同，在保留其他会话改动后typecheck通过；reload仅作本地载入smoke。
- 用户2026-11-17再次批准本次名单最小修复并继续沿用本补丁旧冷启结论；新手机测量仍UNRUN。真实0.15客户端UI/整机WiFi中断仍无新样本。无新UI、设置、遥测或版本变更，不需tour/tip/What's new。
- 最终提交推送后继续按CI gate/CodeRabbit真实审查与所有有效意见处理结果合入，不用neutral/skipped代替补审；最终实际状态见PR#117及卡片交付回执。

## 持续agent流setup失败期间的普通读取回退

- CodeRabbit对dd47856补审发现：重试仅openStream，持续拒绝时即使普通列表可用，新session仍无chip。回归先红（1失败/45通过，a2无Task chip）。
- 最小实现改动是一行既有回调：退避到期触发refreshNow；刷新轮次内部openStream并在streamReady=false时走普通完整列表。没有新增timer。回归覆盖5/30秒两次持续失败仍更新a2/a3，60秒恢复成功后180秒零继续读取。
- 完整5文件76项与typecheck通过，exit0。新全量/独立证据随后记录；磁盘18Gi下继续复用依赖/缓存，不构建或新增缓存，测试少量临时写入。手机仍无新样本，保持用户明确授权的本补丁冷启沿用。

## 持续失败回退的最终验收 — 6be6f31

- 最终产品 `6be6f315e993e7aa4a40096cc2f519af41ebc6d3`。独立GPT6Luna/full-access会话 `1bfba11f-1a47-472c-b66b-b8357dfad94f` 给出PASS：typecheck exit0，完整5文件76项通过；独立报告 `LUNA-PERSISTENT-STREAM.md`（aa195da）。父任务全量exit0：165文件通过/1skip，1524测试通过/6skip。
- 测试会话已hard-delete，inspect返回AGENT_NOT_FOUND；未创建fixture、daemon、workspace或隔离缓存。根目录两个对应client文件与该产品源码相同，typecheck通过；仅reload本地插件，不重启daemon。
- 冷启动按用户两次明确授权在本PR补丁内沿用旧+3.7257%/5%结果，新测量UNRUN。无UI、设置、遥测或版本变化。最终推送后继续等CI与真实CodeRabbit补审，不用neutral/skipped代替审查。
