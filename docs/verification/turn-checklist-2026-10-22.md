# 回合清单与审计统计校准（2026-10-22）

卡片 `08a37039`，主会话 `036d5d2b`。先写 [spec](../TURN-CHECKLIST-SPEC.md)，按用户要求先校准统计，再实施最小版建议 1+3；未增加 hooks。

## 实现

- 六项动作清单只有一个来源：`shared/turn-checklist.ts`。生成 skill 的开头与实时 `get_task.turnChecklist` 使用同一数组；旧会话无需重建，读卡即可取得当前版本。清单总长 1,031 字符，覆盖提交/合入等短回合、实际检查、PR/MR 输出与回合收尾。
- 新服务始终返回清单，输出 schema 允许旧服务缺省该字段，保留 toolVersion=1；返回数组副本，不改变 board、revision 或写入权限/闸门。MCP、HTTP 和 CLI current 共用原 AgentService.get。
- 两份审计脚本共用 v2 core。按回合时间窗口筛选、保留旧会话的真实首次/后续属性；完整 PR/MR URL 必须与成功回执的实际 output 对应。显式区分真实/测试/未分类样本、新旧会话、提前确认/拒绝后重试，以及失败和未知。
- 纯图片消息也建立回合；CLI 静态 argv 保守分词；动态参数和批调用次序保留未知；未返回的 CLI/MCP 登记不是已确认缺失；证据函数不保留 URL 查询参数或 userinfo。

用法与统计边界见 [Audit v2 README](flow-constraints-audit-2026-10-22/README.md)。旧报告和原输出 txt 保留，不能直接用旧口径数字和 v2 作前后因果比较。

## 验证

| 检查 | 结果 | 证明范围 |
|---|---|---|
| Node 审计回归 | PASS，25 tests | 两个 provider/入口、窗口、项目/样本隔离、成功/失败/未知、PR URL 匹配、重放、ack 重试、图片回合、CLI 引号及 URL 脱敏；含 Fable 五项与 R1 回归 |
| 聚焦服务测试 | PASS，3 files / 57 tests | `server/agent-service.test.ts`、`server/tool-server.test.ts`、`server/skill-source.test.ts`；含旧结果 schema、数组副本、MCP/CLI 与 skill 一致性 |
| `npm run typecheck` | PASS | 重载前通过 |
| `npm test` | PASS，110 files / 933 tests | Fable 五项修复后最终产品代码再次通过；[日志](turn-checklist-2026-10-22/final-npm-test.log)。随后只修离线审计 R1，并单独跑 Node 回归 |
| reload + 旧会话 CLI current | PASS | 本卡创建早于 reload；实际收到的六项规则与共享源码逐项相同，读前后 board hash 相同，见 [live-current.json](turn-checklist-2026-10-22/live-current.json) |
| 真实历史只读扫描 | PASS（解析验证） | 固定 `[11:52Z,12:23Z)` 窗口，Claude 2 个后续回合、Codex 1 个后续回合都来自窗口前创建的会话；诊断 0。不是新功能上线后的效果验证，不声称遵守率提升 |
| Luna 独立审查 | PASS，初轮 4 项问题修复后复核通过 | `codex/gpt-6-luna`，创建时 full-access/high；session `6698b422-7a2f-4b1e-b58e-5739bf2a485d`，独立重跑 21 tests；见 [审查报告](turn-checklist-2026-10-22/luna-review.md) |
| 用户指定 Fable 代码审查 | PASS，五项初轮发现与追加 R1 均修复并复核通过 | `claude/claude-fable-5-1`，创建时 bypassPermissions/high；session `058cab0b-0961-4b40-962c-258555c435f9`。最终以 [Fable 报告](turn-checklist-2026-10-22/fable-review.md) 为准；Luna 测试记录保留 |

初轮审查保留 FAIL，不覆盖为从未失败。主会话额外补充了空 eventId 的无操作 artifact 回执去重用例；重复回执不重复计，不同产物不互相覆盖。

Fable 发现并验证了 2 项 Medium（后台通知污染回合分母、空应答误判 missing）和 3 项 Low（旧 Codex shell 工具、skill 编号引用、默认时间窗口）。全部修复后复核通过；追加 R1（动态命令退化为零调用）也已修复，Fable 独立运行 25/25 并确认当前审查范围无未解决 finding。无法解析的命令归 unknown，不进入 `laterObservable` 的零调用比例；静态调用或成功回执仍使回合可观察。信息级限制见审查报告，不把 AST 源码观察当实际执行证明。

其他已解决的验证失败：第一轮 Node 测试有一条错误预期（当前成功回执不应被较旧的 board 回执覆盖），修正预期后通过；首次 skill 生成尝试依赖未安装的 esbuild，因此生成文件尚未同步时两条一致性测试失败，改用仓库现有 TypeScript 同步后 57 个聚焦测试通过。没有为此安装新依赖。

## 边界与资源

- 未验证/不在本轮：真实使用长期遵守率、ACP 指令送达、hooks、任何 UI/手机行为。这次没有新 UI、设置或用户操作，onboarding/tip/What's new 无需调整。
- 完全不调用 Flowly 的回合仍不会收到 get_task 清单；Codex 调用表达式和 shell 命令属于源码观察，不能证明任意动态分支实际执行。无法确认的数据保留 unknown；未标记样本不冒称真实使用。
- 工作区共享且已脏；开始时基线 `05de1691ff16`，另一会话在 20:23:41 更新 main 到 `7f98f021867e`（reflog），早于本轮检查执行时间；本轮测试在后者的 dirty tree 上运行。主会话未提交、推送或改分支。改动归属见 [ownership.md](turn-checklist-2026-10-22/ownership.md)。
- 本轮创建 Luna 测试及用户指定 Fable 审查子会话，均复用当前卡 workspace；无新增项目、卡片、worktree 或 GitHub 资源。二者完成后均已归档并核对原生元数据。Node fixture temp home 自行 finally 清理，见 [cleanup.json](turn-checklist-2026-10-22/cleanup.json)。
- 前轮权限受限的四个 Tinylink 本地测试 refs 仍留存，本轮未重试；用户要求保留的私有测试仓库及永久 Tinylink 未动。

输入：原调查报告及两份脚本、前轮必要性复评与双模型验证记录。本次没有拿受控测试样本替代真实用户效果观察。

Workpad 当前验证表使用本阶段检查；上一阶段已完成的 11 项检查和原 SHA 转存 [previous-phase-checks.json](turn-checklist-2026-10-22/previous-phase-checks.json)。原因：本阶段新检查覆盖类型/单测/重载，原调查与建议 2 的模型 PR 场景已完成且 fixture 已清理，无需为历史 HEAD 变化重复创建 PR。原验收文本保留；尚未完成的旧 refs 清理仍保留为当前待办，没有隐藏或标为通过。
