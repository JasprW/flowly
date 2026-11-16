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
