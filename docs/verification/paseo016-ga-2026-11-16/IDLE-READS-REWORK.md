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
