# Idea 管理工具独立验证（Luna）— 2026-10-22

## Session 与工作树

- Paseo agent/session ID（`PASEO_AGENT_ID`）：`d34eee81-94d1-4d32-a918-bd07392ee19b`
- Codex session ID：`01a16413-1e56-7bd2-9a06-7f406393d14c`
- HEAD：`fab80456ead870e7b7e6a493bae276ee878e34fd`
- 工作树：`dirty=true`；开始验证时 `git status --porcelain` 共 69 项。共享工作区原有改动均保留。
- 目标卡：父会话分配的“扩展idea工具”；本 session 没有可用的 Flowly CLI context，因此无法通过 `flowly_get_task` 确认 task ID / status / revision。

## 命令验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | PASS（exit 0） | `tsc --noEmit` 完成，无错误；运行于上述 HEAD，`dirty=true`。 |
| `npm test` | PASS（exit 0） | Vitest：110 files passed，936 tests passed，duration 15.19s；运行于上述 HEAD，`dirty=true`。 |

## 真实插件 CLI 流程

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 本 session `flowly_get_task` / CLI `current --save-request` | UNRUN | MCP 工具列表没有 `flowly_get_task`。环境中的 `PASEO_CLI` 仅指向 Paseo 可执行文件；用本 session 的 `PASEO_AGENT_ID` 拼成 Flowly context 路径时返回 ENOENT。未搜索或读取其他 session 的 context/凭据。 |
| propose → 多字段 edit → dismiss → dismissed edit rejection → remove | UNRUN | 没有可用的本 session 签名 request/context，未写入任何 idea。测试 idea ID：无。 |
| exact replay 与不同参数复用 request 的 `REQUEST_REUSED` | UNRUN | 需要真实签名 request；未执行。 |
| 删除后 get 无 idea；卡片 status/revision 不变 | UNRUN | 未能读取 task 或运行真实 CLI。没有观察到任何写入。 |
| 不存在 ID 的错误路径 | UNRUN | 未执行，避免在无有效 context 下调用。 |
| 清理 | PASS（无测试 idea） | 未创建测试 idea、project、workspace 或 session；失败的 `current` 调用没有写出 request snapshot。测试临时日志目录 `.idea-tools-luna-tmp` 已删除。 |

真实 CLI 探测先使用当前 shell 的 `PASEO_AGENT_ID`，对应 context 文件不存在。随后误从生成内容中取到另一条 context 路径并尝试调用；该路径也返回 ENOENT，未读取任何 context 内容或凭据。没有再尝试其他路径。本报告不记录 bearer credential 或签名 request。

## 实现边界审读

静态审读文件：`server/cli-source.ts`、`server/tool-server.ts`、`server/agent-service.ts`、`server/store.ts`、`shared/rpc.ts`，并参考 `docs/IDEAS-SPEC.md` §3.1。

- CLI `idea-update` / `idea-remove` 要求 request snapshot 与 idea ID；更新仅序列化传入字段，`--dismiss` 映射到 `status=dismissed`，标签做逗号分隔解析。
- MCP/RPC 输入约束与两种 action 注册均存在；服务端从绑定身份派生 task，不接受用户指定另一张卡。
- 服务端校验 signed request、task/project revision、归档/完成状态及 Ideas 开关；提交事务先检查同 request 回执。相同 payload 返回原回执，不同 payload 返回 `REQUEST_REUSED`。
- `manageIdea` 限定当前 task；不存在返回 `IDEA_NOT_FOUND`，accepted 返回 `IDEA_CLOSED`，dismissed 不能改字段但可删除；编辑和 dismiss 同次提交按 `idea_edited` 再 `idea_dismissed` 顺序记录；无变化时不产生新 event；标题冲突检查当前卡的其他 open ideas。
- 本次未发现可由代码直接确认的缺陷。静态审读与单测不能代替指定的真实 CLI session 闭环。

## 汇总

- PASS：typecheck、全量单测、无测试资源遗留、静态边界审读未发现明确缺陷。
- FAIL：无。
- UNRUN：真实 CLI 生命周期、request replay/`REQUEST_REUSED`、删后读取，以及 task status/revision 不变性。阻塞原因是当前独立 session 没有可用的本 session Flowly context；不借用其他 session 凭据。

## 第二轮补测（context 正式准备后）

父会话通过插件现有 `tools.prepare-existing` 为本 session 正式准备 Flowly context 后，按要求仅补跑真实 CLI 项；没有重跑 `npm run typecheck` 或 `npm test`，复用首轮 **936 tests PASS**。首轮的 context 不可用记录保留如上；第二轮结果更新原先对应的 UNRUN 项。

- Session：`d34eee81-94d1-4d32-a918-bd07392ee19b`；卡片 `5fcd00c8-2869-456a-96c8-3e1f4fa8b637`。
- 起始 `current`：status=`test`，task revision `4`，project revision `7`，ideas 列表为空。
- 新建的唯一测试 idea：`e4b56783-5734-4d6a-9db1-7821a4bf12da`，标题 `验证临时-Luna-idea管理CLI`。
- propose：PASS；receipt action=`idea`，event=`ec662822-5bd6-4f7e-a7b2-72512b4d2612`，taskRevision=`4`。
- 精确重放同一 propose request 和相同参数：PASS；`replayed=true`，idea ID 与原回执/event 相同。
- 同一 propose request 改动 detail 后提交：PASS（预期拒绝）；返回 `REQUEST_REUSED`。
- 多字段 edit（title/detail/rationale/context/type/priority/scope/tags）：PASS；receipt action=`idea_update`，event=`8e58bc06-43fc-49e0-b7bf-9740538da3c1`，taskRevision=`4`。
- dismiss：PASS；receipt action=`idea_update`，event=`8d5fcf32-3292-4854-b53c-9ed9e5b91f44`，taskRevision=`4`。后续 current 显示 idea status=`dismissed`。
- dismissed 后尝试改 detail：PASS（预期拒绝）；返回 `IDEA_CLOSED`。
- remove：PASS；receipt action=`idea_remove`，event=`f23ddb24-3c89-4dbc-b811-2c81747a1322`，taskRevision=`4`。
- remove 后 `current`：PASS；idea ID 不在 `ideas` 中，task status 仍为 `test`、task revision 仍为 `4`、project revision 仍为 `7`。
- 清理：PASS；只创建并删除上述测试 idea；未创建 project/workspace/session。`docs/verification/.idea-tools-luna-tmp` 中所有 request snapshots 与输出日志均已删除；只保留本报告。
- 不存在 ID 的错误路径：UNRUN（可选项；本轮已覆盖规定主流程与 dismissed 编辑拒绝）。

第二轮 CLI 命令使用父会话提供的本 session context：`node /Users/bofan.wang/.paseo/plugin-data/flowly/flowly.mjs --context-file <本 session context> current|idea|idea-update|idea-remove`。所有新写前均通过 `current --save-request` 获取新快照；唯一精确重放沿用原 propose request。没有修改实现文件、卡片状态或 workpad，也没有改动全局设置或其他卡片/idea。
