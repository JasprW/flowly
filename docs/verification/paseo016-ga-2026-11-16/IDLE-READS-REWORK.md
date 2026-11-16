# 在线 chip 零周期读取返工

- 来源：自动验收 goal finding，PR #115 合入后的 `61511d7`。接受意见，不提争议；此前一分钟校对不符合本卡目标。§3.7 暂缓沿用，但不豁免 chip 的零周期读取要求。
- 修复：订阅首事件后取消定时 chip 轮次；变化推送/相关 agent 流事件/显式操作触发读取。连接中、失败和旧宿主继续原轮询；关闭立即补读，恢复后停止。设置变化经已有 sessions scope 推送；agent 流初始化与归档事件补齐原先依赖分钟轮次的刷新。无新 RPC 协议、依赖、UI、设置或 telemetry 字段，不需新增 tour/tip/What's new。
- RED：增强既有回归，静止180秒 chip看板读取由2→5，断言失败（1失败/24通过，exit1）；未弱化断言。
- PASS：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` exit0；`node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` exit0，5文件58通过。覆盖180秒无chip RPC/agent列表增长、推送更新、connecting/关闭回退/恢复、设置无board变更刷新、agent流初始化与归档后保留chip、停止后不再读取；保留拒绝时无重试循环的回归。
- PASS：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm test -- --reporter=dot` exit0，165文件通过/1跳过，1506项通过/6跳过。
- UNRUN：本轮手机UI/冷启动，AndroMeld socket不存在且adb无设备；无新0.15客户端UI样本。历史PHONE.md/OLD-HOST.md数据不充当新提交实测；历史冷启动按用户5%配对中位差标准的判断保留。
- 独立Luna的精确提交复核另由该会话拥有证据；实现者不编辑独立报告。
