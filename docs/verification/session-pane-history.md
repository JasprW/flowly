# Session pane 历史、键盘与滚动（SESSION-PANE-SPEC）验收

- 日期：2026-10-20 至 2026-10-21（Asia/Singapore）
- 测试执行 session：`0870a92e-73af-4dea-add5-69b9c12a1150`（`codex/gpt-6-luna`，`full-access`）
- 目标只读 session：`e8c1f67b-671c-4241-9943-00ba9756bb15`（卡片与 session 均为既有资源）
- Checkout：`/Users/bofan.wang/Developer/personal/paseo-utlra-kanban`
- Commit：测试开始时 `00ad943`，收尾时 `ccb9a88`；checkout 起止均 dirty。测试中 HEAD 前进且插件于 2026-10-20 15:44 UTC 重载；`00ad943..ccb9a88` 在本次 session pane 涉及文件上无提交差异。实现文件由并行工作会话维护，本测试未修改。

## 方法

使用 Playwright Core 1.63.0 启动 headless Chromium 1243，在 `https://app.paseo.sh` 新建隔离 context 并授予 `local-network-access`，连接本机 daemon。桌面视口为 1700×1000；紧凑视口为 430×900，启用 `isMobile` 与 `hasTouch`。移动视口仍走 react-native-web 的 ScrollView 路径；原生手机 inverted FlatList、键盘上移与真机滚动帧率不在本轮浏览器证据范围内。

## 验收项

| # | 结果 | 证据 |
|---|---|---|
| 1. Desktop 当前 turn | **PASS** | 打开 Flowly → `sidebar session 优化` → 目标 session，滚到 transcript 顶部后，第一条消息是当前 turn 的用户回复“1 2 按推荐，3 直接上 FlatList 吧，性能问题一步到位”；其上方有 `Load earlier`。DOM 中 `Recent output` 计数为 0。见 [桌面当前 turn](session-pane/desktop-current-turn.png)。 |
| 2. Load earlier 与位置保持 | **PASS** | 按一次后，上一轮用户请求“有没有办法在 session 区展示更多历史消息…”出现；当前 turn 用户消息 y 坐标由 255 px 变为 255.55 px（Δ≈0.55 px）。430×900 下对应 Δ≈0.66 px，上一轮用户消息也出现。`Loading earlier output…` 由 Playwright waitForFunction 与 MutationObserver 观察到；状态短暂，未留到稳定的 loading 截图。见 [桌面加载后](session-pane/desktop-load-earlier-1.png)、[紧凑当前 turn](session-pane/mobile-current-turn.png)、[紧凑加载后](session-pane/mobile-load-earlier.png)。 |
| 3. 跟随尾部 / Latest | **PASS** | 在自己的 Luna session 中打开实时 transcript。桌面尾部 `scrollTop=max=3038`、Latest 不显示；上滚后 `top=2638`、Latest 显示。工具事件从 running 更新为 completed 后，视口仍在 `top=2638` 且 Latest 仍显示。点击 Latest 回到 `top=max=3038`，按钮消失。见 [桌面尾部](session-pane/desktop-own-session-tail.png)、[桌面上滚](session-pane/desktop-own-session-scrolled.png)。 |
| 4. Compact 430×900 | **PASS（浏览器 web 路径）** | 重复当前 turn、Load earlier、自己的 session 尾随与 Latest：尾部 `top=max=3822` 且按钮隐藏；上滚至 `top=3642` 后按钮出现；点击后回到 `top=max=3822` 且按钮隐藏。见 [紧凑尾部](session-pane/mobile-own-session-tail.png)、[紧凑上滚](session-pane/mobile-own-session-scrolled.png)。原生 iOS/Android 键盘与 inverted FlatList：**UNRUN**。 |
| 5. 错误检查 | **PASS** | 本轮 session 页面的 Playwright console error 与 page error 均为 0；`paseo plugin logs flowly` 的 Flowly runtime 日志没有新增 error/exception。日志中有既有启动提示（`crypto.fips` 弃用及 `responseMode: 'json'` 通知说明）；Paseo CLI 自身启动时的 Electron `node_main` 行不属于插件日志。 |
| 6. 一次性 tip | **UNRUN（未出现）** | 打开卡片及 session 后均未找到 tip 文案（检查英文、简中、繁中、日文文案）；`Got it`/“知道了”等关闭按钮也未出现，因此无法验证关闭。见 [tip 检查](session-pane/desktop-tip-check.png)。 |

## 清理

- 未创建项目、卡片、工作区或 session；未向目标 session 输入/发送消息，也未执行归档、停止或显式已读/未读操作。
- 每个 Playwright 浏览器 context 均已关闭；复查时没有遗留的测试 Chromium 或脚本进程。
- 临时脚本已从 `/tmp` 删除；本轮只保留本报告和 `docs/verification/session-pane/` 内验收截图。未改实现文件或其他并行会话文件。
