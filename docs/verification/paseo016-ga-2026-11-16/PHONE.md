# Paseo 0.16 配套：手机与绑定生命周期

2026-11-16；对象是共享根目录的未提交实现，起始 HEAD `fb9e744`。正式 SDK 和宿主均为 0.16.0。原始汇总见 `phone-measurements.json`；候选提交的独立验收另记，不把本轮 dirty-tree 证据当作候选 SHA 验收。

## 冷启动补测与当前结论（最新）

**用户在查看数据后明确接受5%内波动，Luna已按配对中位差门槛复核通过。** 发现宿主的 `/h/[serverId]/plugin/flowly/board` 路由可经 `paseo://` 直接冷启到 Flowly，补测无需侧栏操作。没有改宿主路由、网络或安装配置；同一客户端代码在服务端拒绝订阅与订阅正常之间交错。

四对截图 OCR 确认的实际看板可见区间，回退分别为 3.716–5.441、3.870–5.331、5.249–6.464、4.312–5.789 秒；正常分别为 4.067–5.376、5.439–6.868、4.101–5.215、5.369–6.844 秒。中点中位差约 +589ms，但取样区间宽 1.1–1.7s，不能据此证明不退化。

再加临时首个 overview React 提交时间戳、ADB 时钟校准，并保留画面确认。三对有效配对如下；最后一对反序（正常→回退），没有丢弃慢样本。

| 配对 | 回退首次数据提交 ms | 正常首次数据提交 ms |
|---|---:|---:|
| precise 2 | 4294.5±47.5 | 4454.5±25.5 |
| precise 3 | 4200±43 | 4576±46 |
| precise 4（反序） | 4339±32 | 4392.5±29.5 |

中位数 4294.5→4454.5ms，约 +160ms / +3.7%。这是 React 提交时间，不等同于 native paint。首个 precise 回退样本没有检测到 Flowly 画面，也没有新启动 perf，记为 **INVALID（原因未建立）**；其后正常样本 5767±31ms 为未配对样本，仍保留，不塞进配对中位数。

为归因增加一对 RPC/首 push 分段样本：回退提交 4966±51ms，正常 4319.5±29.5ms，方向反转。其中首次 RPC 发起前为 3636→3193.5ms，RPC 为 1237→1053ms，RPC 后到 React 提交为 93→73ms；正常首 push 在首次 RPC 返回前约 408ms 到达。此样本说明前段存在波动，不能把前三对差异归因于某段代码，也不能拿它冲销前三对来宣布通过。独立Luna按原先零退化表述未放行；用户查看+3.7%结果后明确接受5%内波动，并要求Luna复核再合入。这个标准是在看到数据后确认的，不伪装成事先约定的统计边界。

共保留本次补测 18 个样本的脱敏聚合（含 INVALID 和未配对）在 `phone-measurements.json`。Paseo 0.15.4 隔离编译器以同一选项编译主分支 `7f66c31` 与候选 `ba4aa41`，客户端包增加 2733B（1028989→1031722B）；没有新增依赖。设备此阶段电量100%，温度34.4–36.7°C。

桌面 0.16 web build 在独立 headless 浏览器以共享 `shot-lib.mjs` 打开 Tinylink，宽屏和900px紧凑布局卡片均展示，无 pageerror；截图 `web-wide.png`、`web-compact.png` 已排除宿主侧栏和其他项目。第一次紧凑测试错误地找另一个泳道的卡片，关闭 helper 又使用了桌面 Close；改为当前可见卡片和真实 Back to board 后通过。这是测试定位错误，未改产品。没有更改 Tinylink 的数据。

所有临时 `P16_COLD_PROBE` 打点、故障开关已移除，performance.json 恢复本轮前的 `log:false`。尝试通过安装 API 临时切换目录被宿主 `already configured` 拒绝，没有移除或重建用户的插件配置。

## 手机收益

- 设备：Pixel 9 Pro，1280×2856，Paseo Android 0.16.0。电量 100%，温度 33.9–34.9°C。不是旧文档中的 Samsung/1080×2340。AndroMeld control socket 不存在，按项目约定使用 adb；没有发送 session 消息、操作其他人的 host、系统设置或其他 app。
- 同一客户端代码、同一 Flowly 看板，对比订阅失败回退与订阅正常两种状态。故障开关仅在临时服务端打点中拒绝 `board.changes`；每次测试约 60 s，排除首 10 s，并剔除包含 `plugin.load` 的报告。perf 按 10 s 聚合，边界不是逐请求时间窗，不将往返时间当作纯 JS CPU 时间。
- 正常模式的首个重载样本包含启动和一次看板变化，作为过渡样本保留，不计入静止收益。

| 约 50 s 的稳定窗口 | 回退 1 | 回退 2 | 正常 1 | 正常 2 |
|---|---:|---:|---:|---:|
| `overview.read.same` | 16 | 15 | 0 | 0 |
| chip 的 `board.read.same` | 10 | 10 | 1 | 0 |
| `chips.round` | 10 | 10 | 1 | 0 |

两个回退窗口共 51 次目标读取，两个正常窗口共 1 次，减少约 98%；正常窗口中该 1 次是既有的一分钟校对。`gfxinfo` 稳定窗口 p50/p90/p99 均约 6/8/11 ms，Slow UI thread 均为 2：可测收益是减少读取，没有声称帧率改善。§3.5 明确保留的一分钟 chip 校对、attention、summary、read-state、resources 和 agent 流校对不属于“停止轮询”的目标；§3.7 仍按用户决定暂缓。

## 冷启动

用 `am force-stop` 后 `am start -W`，各模式重复两次，客户端代码相同。记录的宿主首帧不是 Flowly 可见时间；`plugin.load` 是真机上插件求值到贡献注册完成的时间。

| 模式 | 宿主首帧 ms | `plugin.load` ms |
|---|---|---|
| 订阅失败回退 | 1428、1257 | 102.7、56.6 |
| 订阅正常 | 1294、694 | 67.0、60.0 |

这两项未观察到退化，样本量有限，不据此宣称启动加速。宿主两种模式都会恢复到旧的 `Workspace unavailable` 页面，因此从进程启动到 Flowly 可见的总耗时不作为有效 A/B 数字；均从侧栏重新进入 Flowly。额外记录的点击入口到 overview React 提交为回退 965.5±59.5 ms、正常 1386±59 ms / 933±54 ms，含网络/宿主页面装载波动，未用单点差异归因于订阅代码。

## 推送、失败与恢复

- 在手机上打开独立 fixture 看板，修改 fixture 标题；通过临时 overview revision 提交时间戳和 adb 设备时钟校准，记录真实手机 React 提交约 **306±40 ms**。截图确认了 fixture 看板，不把外部订阅首事件的 3 ms 当作界面延迟。
- 重载插件导致真实订阅关闭，随后服务端拒绝新订阅：手机恢复约 3 s overview、5 s chip 轮询；两次回退稳定窗口如上。回退期间的另一变更也通过轮询提交（该次约 404.5±55.5 ms，不代表最坏轮询延迟）。
- 删除故障开关后**没有重载插件或重启 app**。70 s 的恢复观察中先有旧轮询，随后自动重订阅；之后的稳定窗口目标读取为 0。恢复后又一次变更的手机提交约 **280±61 ms**。
- 这是插件订阅关闭/拒绝和恢复的实测，不是关闭整台手机 Wi-Fi 的测试；没有改手机网络设置。初始 connecting/未收到首事件时保留原轮询的路径由现有单测和回退路径覆盖。

## 元数据与真实生命周期

- 创建独立项目 `4b27ed98-42f6-4325-a726-d09f8b5a57af`，首卡 `b512880e-f1d3-464a-8db0-d86fd04a64ea`，工作区 `wks_6e569247a1372cfa`。没有使用或修改 Tinylink、用户原有卡片、工作区或 session。
- 新工作区约 115 ms 读到 taskId。首个新 session 曾在 10 s 内没有元数据：prepare 时尚未创建的 agent 被缓存为未上线。已修复为受管 `agent.create.after` 触发重查，新 session 创建完成后约 1021 ms 读到 taskId；没有新增周期轮询。
- 缓存已正确后故意改错 fixture session/工作区镜像，曾 8 s 未纠正。已修复完整轮核对实际元数据，复验两轮均恢复正确（约 1284 ms / 107 ms；不将其解释成 API 总耗时）。两个问题都进入常规回归测试；聚焦 metadata/host-support 为 16 项通过。
- 使用实际 `createHidden`、`taskMetadata` 代码创建无 prompt 的后台 agent：taskId 正确、默认列表隐藏、SDK 归档后 taskId 保留，随后已 hard-delete 该测试 agent。
- 自有 workspace 自动 Wrap up：2 个 session 被归档，元数据保留；unwrap 恢复同一 workspace/session ID，元数据正确。删除首卡后，返回后的首次读取已经确认 session 的两个 Flowly 键和工作区 taskId 均清除。
- 将同一 workspace 和 session 绑定到新 fixture 卡，约 429 ms 读到新 taskId；手动 Wrap up 关联工作区时仅归档 2 个 session、保留工作区，随后 unwrap 保持原生 ID 与新元数据。
- 文档差异：当前 `WrapupService.check` 用 `worktree || owned` 决定是否整体归档，自有 directory 也可归档；AGENTS.md 和 MULTITASK-SPEC 的旧手动 Wrap up 描述只写 worktree。按现有代码测量，未改归档策略。

## 清理

项目移除回执确认删除 2 张剩余 fixture 卡及 2 个原生 workspace。插件 board、原生 project/workspace/agent registry 复查均无本轮 fixture。清理核对脚本最初误用了项目列表的 `.entries`，随后按真实 `.projects` 修正并完成复查，不把该脚本错误算作产品错误。仅移除 API 返回的两个本轮 fixture 备份；fixture 目录已删除。

订阅故障开关和所有 `P16_PHONE_PROBE` 打点已从产品代码移除；performance 设置恢复到原先的 `log:false`，保留原文件。开发安装原有 telemetry 为 disabled，整个过程中未开启。未启动或重启用户 daemon。旧宿主独立验证见 `OLD-HOST.md`。
