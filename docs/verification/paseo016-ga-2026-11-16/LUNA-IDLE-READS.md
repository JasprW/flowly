# Paseo 0.16 独立验收：chip 静止时不周期读取

- 验收会话 ID：`1dcd167e-52ee-408e-acd2-8c91c638e1a5`。
- 候选：`9fa5cc492c679c6a12756a7d5ae8acb2f52242f7`；comparison base：`61511d7`。只读审阅指定 worktree `.worktrees/paseo016-companion-candidate`；验收前工作树干净。
- 规格：审阅 `docs/PASEO-0.16-SPEC.md` §3.5，包括其余配套契约；§3.7 暂缓不作为豁免。

## 结果

- **PASS — 实现审阅**：首个 `board.changes` 事件将 chip 轮次切为事件触发；静止期间没有周期 timer。`sessions` scope 事件会让 `chipInfoAt` 失效，即使 board etag 未变也重读设置。agent stream 建立后触发完整列表协调；离开 live 集合的事件使归档引用立即过期并触发扫描。订阅 `connecting` 时维持轮询；ready 失败或 closed 会立即补读、恢复轮询并只由退避 timer 重订阅；恢复首事件后再次停轮询。无 `subscribe` 的旧宿主保留轮询。未发现规格冲突或需要拦截的缺陷。
- **PASS — `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck`**：exit 0。
- **PASS — `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot`**：exit 0；5 个文件通过，58 tests passed。
- **PASS — `git diff --check 61511d7...9fa5cc4`**：exit 0。
- **UNRUN — 真机/桌面宿主运行验收与冷启动配对**：本轮未启动 daemon 或设备；手机数据沿用任务提供的限制说明（无 adb 设备，AndroMeld socket 不可用），不声称本轮有新真机结果。
- **UNRUN — 独立旧宿主实机样本**：没有新增 0.15 宿主实测；本报告的旧宿主结论来自实现审阅与既有测试，不代表实机验收。
