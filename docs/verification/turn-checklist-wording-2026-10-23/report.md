# 共享回合清单第 2、5 项实施

2026-10-23；按用户最新授权，仅做必要离线规则/一致性检查。

## 改动

先更新 [TURN-CHECKLIST-SPEC §2/§2.1](../../TURN-CHECKLIST-SPEC.md)，再按 [Fable 整体方案与主会话复核定稿](../constraint-benchmark-advisor-2026-10-23/review-summary.md) 修改 `shared/turn-checklist.ts` 第 2、5 项，使用现有 `server/skill-source.ts` 生成仓库 `skills/flowly/SKILL.md`。

- Design 用于本卡调研、规划、写规格；实现（含纯文档实现）编辑前 Development；任务验证执行前确保 Test，普通定位读取不切 Test。
- 工作回合结束前更新 workpad 并取得成功回执；整卡整体交付/用户要求 handoff 用 In review，未提交成果同样适用；阶段贡献/纯验证可用 result。新产物本身不表示整卡完成。
- 纯对话或暂停不新增交付；question/blocked 不额外补 result，保留原有 nextMoves 义务，明确 stop/wait 优先。

另外四项逐字保留；生成 skill 的详细规则逐字不变，六项含换行 **1583 字符**。生成器、服务端行为、工具接口、grader、自动阶段规则均未改。只追加本卡 PROGRESS 段，其原有内容保持。

首次生成命令发现本仓库未安装 esbuild，未写出 skill；改为使用已安装 TypeScript 对现有两个源码模块离线转译并求值，完成同一生成器的输出，没有安装依赖或留下临时构建文件。

## 验证

```sh
npx vitest run server/skill-source.test.ts server/agent-service.test.ts server/tool-server.test.ts
python3 docs/verification/turn-checklist-wording-2026-10-23/check-preservation.py
```

- **PASS：3 files / 62 tests**。现有检查覆盖清单六项/长度、skill 与生成源码逐字一致，以及 get_task/MCP 同源返回和兼容路径。没有新增仅复刻字符串的测试。
- **PASS：**只有第 2/5 项与旧清单不同，全部六项与评审定稿相同；skill 详细规则、生成器不变。
- **PASS：87 个旧证据文件哈希不变**，包括原始 B01 成绩、scope 独立重评及此前分析/审查证据。[保留核验](preservation.json)、[归属清单](ownership.json)。
- 共享工作区其他会话在本轮更新了移动性能验证文件；保留核验如实列出观测到的并发变化，本次没有写这些路径，也没有把它们当作本卡改动。未 stash/reset/切分支或触碰共享索引。

[完整测试输出](focused-checks.txt) 与 `checks-metadata.json` 记录实际执行版本/哈希。

## 范围与限制

未运行 B01/其他被测模型、Luna/审查会话、fixture、grader/cleanup、全量测试或类型检查；未加 hooks，未改原始/重评结果，未提交/推送、安装或 reload。按本轮“只做必要离线规则/一致性检查”的授权，不重复历史完整验收。

仓库 skill 已生成，**运行中服务是否采纳新规则未验证**。不因离线一致性通过就声称 Sonnet/GPT 行为已改善；旧整体 FAIL/exit 1 继续保留。没有 UI、设置或新用户操作变化，无需 onboarding/tip/What's new。
