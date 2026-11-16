# Paseo 0.16.0 正式版回归

- 日期：2026-11-16；源码提交 `73ce52d2e2669cb4fbc285837ae379ec3e0a4e47`（PR #100 合并当日 main 并锁正式版 SDK）。此次后续提交仅补文档与证据。
- 宿主：用户本机 daemon/CLI 均已确认 0.16.0；真实行为回归在同一已安装正式版 CLI 启动的隔离 daemon 上执行（127.0.0.1:6796，home `.worktrees/pr100-stable/.runtime/home`，FLOWLY_TELEMETRY=0、DO_NOT_TRACK=1），安装该提交的 Flowly。没有切换用户 6767 daemon 的插件或重启它。
- 输入：PR #100、PASEO-0.16-SPEC §3.1/§3.2、AUTO-REVIEW-SPEC §4.4、MULTITASK-SPEC、原 beta.2 实测报告。详细 fixture ID 与结果见 `results.json`。

## API 对比

逐个对比 npm beta.2 与 0.16.0 的全部 `.d.ts`。后台创建、background 字段、归档过滤及 backgroundWork.list/stop/subscribe 没有签名变更。

正式版删除 agent.turn.after.timeline（beta 已恒为空）；新增 timeline wholeTurns。现有 Flowly 已主动读取 timeline，不依赖被删字段，正式版 typecheck 无需为此修改实现，继续兼容 0.15。其余新增包括 workspace row badge、主题可选色、registry 读取与 review all 模式，本卡未接入。依赖 client/plugin/protocol 全部固定 0.16.0，插件自身版本和最低宿主 >=0.15.0 未变。

## PASS

- 实现者：`NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` exit 0；同环境 `npm test` exit 0，161 文件通过/1 跳过，1465 测试通过/6 跳过。包含旧宿主拒绝与查询失败降级、全部翻译目录检查。
- 独立复验：用户同意由 Codex GPT-6 Luna 替代额度耗尽的指定 Haiku。Paseo session `03e8f5af-37f8-4855-b161-81d7d67b3124`，精确同一提交的 typecheck/full test 均 exit 0，数量相同；review reasoning 与后台创建共存。独立报告 `independent.md` 原样保留（其 CODEX_SESSION_ID 与 Paseo ID 不同）。
- 真实 Codex GPT-6 Luna：启动 sleep 600 后交付；回合结束 idle、backgroundWork.count=1，list 返回 shell/sleep 600。自动评审输入含未完成任务及不应当作已验证结果的规则，评审通过。卡片总结正常持久化。
- Done 时 Wrap up 预检含后台任务阻止项，显式 Wrap up 拒绝，自动 Wrap up 跳过；backgroundWork.stop 后 count/list 清零，预检 blockers 清空。
- 卡片总结、窗外 insight、记忆复盘、Insights 摘要、workflow insights、自动验收六类 helper 均 background=true 并完成归档。默认 agent 列表（含 includeArchived）轮询无 helper；项目级任务无可见 Flowly background 工作区。项目级任务与窗外 insight 观察期间没有 helper attention 通知。
- 隔离插件重载后，workflow 与窗外 insight 仍使用隐藏工作区/agent。Codex workflow 结果 status=ok；digest 内容、窗外 summary 存储及 native timeline 行正常。
- 真实 idle/count=1 快照符合状态判断；加载精确源码 sessionState 确认文案 Background tasks running。桌面/紧凑 UI 的实际渲染沿用 beta.2 证据，本轮未重拍。
- 清理：通过 projects.remove(alsoPaseo=true) 删除 fixture 后重新查询，插件项目/卡片与 native 项目/工作区/agent 均为 0；隔离 daemon 已停止。两个独立测试 session（含启动失败者）已永久清理。临时 fixture、daemon home、下载的语音模型及 API 包对比目录均删除，证据保留。

## 失败与修正

- 指定 Haiku 独立会话启动即账户额度失败，没有执行检查。workflow 首轮默认 Claude Sonnet 同样额度失败；隐藏/清理正常，但不计为结果成功。仅修改隔离环境的 workflow model 后以 Codex 重跑成功。
- 回归脚本最初错误地用 sessions.insights 查 summary；该 RPC 只返回建议/想法，无建议时空列表正常。改为核对实际 summary 存储及 native timeline 行后通过，没有改产品代码或放松业务断言。清理脚本最初误将 projects.list 返回值当数组，改用 projects 字段复查全零。
- 探测脚本曾误用 providers.list、尝试未安装的 esbuild；分别使用实际 API 与 Vite 加载器修正，均非产品缺陷。

## UNRUN 与维护决定

- 本轮没有真实 0.15 daemon 或桌面/手机 UI 操作；0.15 回退由聚焦/全量测试覆盖，beta.2 的 UI 截图保留，不冒充本轮证据。初始 summary/review 创建期间未单独订阅通知事件，不能将项目级通知观察推广为全部类型的通知实测。
- 无新的 UI 字符串、headline 能力、开关或计数动作；不新增 onboarding/tip、遥测字段或 What's new。
- 修正文档与代码不符：PASEO-0.16-SPEC 的“当前 SDK=0.15.0”和旧 npm latest；AUTO-REVIEW-SPEC 合并时保留 main 的“未指定 Review model 使用摘要模型列表，不继承项目模型”和 reasoning 规则。旧 beta 验证记录作为历史保留。
