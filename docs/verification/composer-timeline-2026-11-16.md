# Composer：保留 timeline，手机直接填入

2026-11-16；实现者验证；session `d47e19e7-6a58-42c8-a608-7ee2db283acf`。
基线 HEAD `9d3b75f`，共享工作区未提交树，包含本轮开始前其他任务的改动；未创建 commit/PR。没有独立会话的 exact-commit 验收。

## 行为

- Progress 与 Next moves 继续使用 `index.client.tsx` 的 timeline renderer。删除新增的 Stage / Next moves composer item 注册与 `client/composer-controls.tsx`。Task pill、Ideas chip 不变。
- timeline Next move 继续调用 `applyMessageMove`，0.16 使用按 agentId 选择的 composer，保留旧文字、空一行追加并聚焦；不发送。Copy 设置或无法聚焦时复制。0.15 的 web DOM 回退保留。
- 提示由 `composer-controls` 换为 `session-composer-fill`，用 composer API 是否存在作能力判断；九份翻译同步，移除无用途的 Stage 文案。导览已有 timeline 建议演示，不新增页面；README、OVERVIEW、规格已对齐。没有新增遥测字段或 What's new。

## PASS

| 检查 | exit | 结果 |
| --- | --- | --- |
| `npm run typecheck` | 0 | 通过 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npx vitest run client/composer-fill.test.ts client/onboarding-logic.test.ts client/native-chips.test.ts server/next-move-rows.test.ts shared/i18n.test.ts` | 0 | 4 文件、107 项通过 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 0 | 162 文件通过、1 文件跳过；1463 项通过、6 项跳过 |
| `paseo plugin reload flowly --json` | 0 | 本目录安装，返回 running；不作为 UI 成功证明 |

命令中的 `client/native-chips.test.ts` 没有对应文件；Vitest 实际匹配并执行其余四份测试文件。

聚焦测试覆盖选择正确 session、追加和末尾光标、focus 拒绝后恢复并复制、旧宿主 DOM 路径、Copy 设置，以及提示优先级、能力关闭、不受旧提示已读状态影响、全部翻译目录。
磁盘预检可用 29 GiB；复用共享依赖与缓存，无新增构建缓存或 fixture 资源。

## 已修复的首轮失败

- typecheck exit 2：新增测试的 mock 只接收 agentId，未涵盖 SDK 的 focused selector 分支；改用 PluginComposerSelector。
- 聚焦测试 exit 1：98 通过、9 失败，均为移除控件后 Stage 翻译过期；九份目录移除该 key 后，整套聚焦测试重跑通过。

## UNRUN

- Android 实机：AndroMeld 连接失败（control socket 不存在），`adb devices -l` 为空；没有操作手机。
- 本轮 desktop/compact UI、真实 focus 拒绝及 0.15 daemon 加载未运行；此前 2026-11-12 web 报告包含已移除控件，不作为本轮 UI 证据。
- 独立会话验收未运行，当前树未提交。原验收中的真实 Android 与 0.15 加载项保持未勾选。

## 文档与代码差异处理

- 原 §3.4 / §6.5 要求输入框控件；依用户本轮决定改为保留 timeline，不注册控件。
- NATIVE-SESSION-SPEC §3 仍写 Next moves 是 composer chip，§6.4 主段仍写手机只能复制；已改为 timeline 与按 0.16/0.15 区分。
- PASEO-0.16-SPEC §3.3 曾把 Flowly 自身建议行列为 SDK 替换目标、要求选中待补片段；按现有实现明确仅原生 timeline，建议没有片段契约时光标在末尾。
