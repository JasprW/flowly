# Audit v2

只读。默认项目仍为 Flowly；两个入口使用同一套解析与统计实现：

```sh
node docs/verification/flow-constraints-audit-2026-10-22/audit.mjs --since 2026-10-22T12:36:43Z --until 2026-10-23T12:36:43Z --json
node docs/verification/flow-constraints-audit-2026-10-22/audit-codex.mjs --since 2026-10-22T12:36:43Z --until 2026-10-23T12:36:43Z --json
node --test docs/verification/flow-constraints-audit-2026-10-22/audit.test.mjs
```

上述日期仅演示参数，不表示已经观察完该时间段。`--since`/`--until` 作用于用户回合开始时间，区间左闭右开；成功回执也必须发生在该回合、且不越过 until。先读完整会话再切窗口，因此旧会话的后续回合不会被丢弃或误称首次回合。

默认从本机 home 的 Paseo 元数据、Claude/Codex transcript、当前 board 和完整项目 flow JSONL 读取。`--project <id>` 选项目，`--home <dir>` 和 `--data <flowly-data-dir>` 可用于隔离 fixture。子 agent 默认排除。不会运行 transcript 中的代码，不调用 GitHub，也不补登或改卡。

两入口的默认 since 同为 `2026-10-21T06:00:00Z`；比较改进前后仍应显式给同一窗口。系统来源的后台任务通知、IDE/命令包装消息不算真实用户回合，后续工具仍归属通知前的真实回合。Codex 的 `exec_command`、`shell_command` 与 `shell`（bash/sh/zsh `-c`/`-lc` 数组）均可识别；其他无法解析的 argv 保留为 unknown shell。

样本属性不猜测：用 `--test-session <完整 session ID>`（可重复）或 `--test-sessions <JSON ID 数组文件>` 标记测试，用 `--real-session <完整 session ID>` 标记已核实真实任务。其余保持 `unclassified`。每个模型再按 real/test/unclassified 与 old/new 分组；顶层 summary 包含全部分组，不能直接称作真实用户遵守率。

JSON 输出为对象（v1 是回合数组），包含 summary、groups、diagnostics、turns。v2 聚焦此次改进的三项指标：后续回合是否观察到 Flowly 调用、确认链接的 PR/MR 是否当回合成功登记、提前 acknowledge 与拒绝后重试的区分。旧报告及 `audit-output.txt` / `audit-codex-output.txt` 保留为历史调查证据，其他旧调查指标不能从 v2 这三项结果推导。`--repo` 兼容接收但不再混入仓库级 PR 总数；`--turns` 输出逐回合安全字段，不输出用户正文或原始工具结果。

- `prAttempts`：命令源码启发式识别。Codex 从 AST 的调用表达式提取，不把注释或字符串里的工具名算成调用；条件分支/函数体是否执行仍不作保证。
- `openedPrUrls`：创建命令的返回中观察到的完整 PR/MR 链接；没有链接或命令明确失败时为 `unknown-creation`，不能把创建命令次数当成功创建次数。
- `registeredPrUrls`：成功 receipt 的 artifactId(s) 对应到实际 role=output 的完整 target。支持 outputs、独立 add_artifact 和 CLI；仅调用/说明中出现链接不算成功，重放去重。优先使用回执当时的产物角色；无法还原历史产物时 `unknown-registration`。
- `prRegistration=pass`：该回合确认的所有新 PR/MR 链接都有成功登记证据。一个回合开两个只登一个不算全部成功；不同仓库相同 PR 编号不会混淆。
- `acknowledgements`：upfront / after-refusal / repaired / after-refusal-no-ack / none / unknown。只描述观测顺序；同轮出现过拒绝不证明后一次确认符合服务端 fingerprint。动态参数和批调用次序无法确认时保留 unknown。
- `laterNoFlowly` 是可观察回合中未观察到调用的数量，分母为 `laterObservable`；无法解析 shell 且无其他调用证据的回合单列 `laterUnknownFlowly`，不混入零调用。CLI 包装脚本无法静态识别、但有该回合成功回执时也算观察到调用；未展示的动态执行不能据此断言一定没有调用。

board 的 agentReceipts 只保留 7 天。登记调用即使有应答，若没有打印可提取的成功回执或错误，也保持 unknown-registration；不能把空 stdout 当作未登记。超过七天、删除过卡片或存在被截断结果的审计，应依赖 transcript 中保留的回执与产物，缺失时保留 unknown。

不要把新口径数字直接和旧脚本口径相比。应固定同一时间窗口和显式样本名单，用 v2 重算两侧；缺失/截断日志查看 diagnostics，并保留 unknown 分母。短期受控测试通过不代表真实使用遵守率改善。
