# 看板数据迁入 SQLite（最小方案）独立验收

- 验收提交：`2334d58`（实现 `89f0333`；`2334d58` 只改 AGENTS.md）
- 规范：`docs/SQLITE-STORAGE-SPEC.md` §11
- 验收会话：PASEO_AGENT_ID `f6f13e35-b0c5-4492-b143-e081510d1d1b`，模型 claude-haiku-5-5（未写实现代码）
- 日期：2026-10-26
- 检查环境：临时 detached worktree（检查后已删除）；演练运行在 Paseo Helper（node v24.20.0，sqlite 3.53.4）

## 1. 检查命令

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit` 无错误 |
| `npm test` | 0 | 1045 passed, 1 skipped（1046），20.70 s。跳过的一项未逐条核对，推定为 `sqlite-crash.test.ts` 子进程用例 |
| `npx vitest run server/sqlite-store.test.ts server/sqlite-crash.test.ts` | 0 | 24 passed, 1 skipped（25）。跳过的是 crash 子进程用例（`describe.skipIf(crashAt)`，设计如此） |

## 2. §11 逐项结论

| # | 要求 | 结论 | 依据 |
|---|---|---|---|
| 1 | v1–v5 迁移后与旧 reader 逐值相同；`tags: []` 与缺省区分；重复事件 id 保留每条与顺序 | **PASS** | `sqlite-store.test.ts:85`（v5 + tags + 重复 e1）、`:108`（v1–v4 `test.each`）。演练 (b) 真实 106 卡数据：迁移结果与 JSON reader 逐字节相同 |
| 2 | 同一串业务操作在 JSON 与 SQLite 上执行，每步后两边整板相同，重开后相同 | **FAIL（覆盖不足）** | `:242` 只比较 SQLite 缓存与 SQLite 磁盘，**没有 JSON 持久层对照**；清单中的“建项目、移除项目”未出现在任何测试中。重开相同由 `:286` 覆盖 |
| 3 | 写入中途失败：库与缓存都不变，下次写入正常 | **PASS** | `:311`（`save:written` 事务内注入失败） |
| 4 | 迁移每一步失败都保留原 board.json、继续用 JSON、下次启动重试 | **PARTIAL** | 只测了 `migrate:before-rename`（`:117`）和读不出的文件（`:138`）。快照、临时库建表/integrity_check、回读比较、rename 这几步没有单独测试。另见 F3（rename 在 try 之外） |
| 5 | 启动规则：残留 tmp 删除；改名后写标记前中断可补完；DIVERGED/MISSING 不建空库；新安装；无 node:sqlite 或版本过低用 JSON | **PARTIAL** | tmp `:165`、中断补完 `:149`、DIVERGED `:173`、MISSING `:188`、新安装 `:203`、无 node:sqlite `:210` 均有。版本过低只测了 `sqliteVersionOk` 函数（`:222`），启动路径（`store`/`sqlite-storage.ts:331`）没有用错误版本跑过 |
| 6 | 第二个进程拿不到 owner 锁报 BUSY，不退回 JSON | **PASS** | 单测 `:227` 为同进程两个 store（SQLite 文件锁同进程也生效）。**真实第二进程**（演练 P4，系统 node v26.9.0 子进程）返回 `STORAGE_BUSY` |
| 7 | 备份 → 修改 → 恢复：内容回到备份、revision 变大、旧 revision 被拒、恢复前库保留；超过 7 份只删自有最旧 | **PASS** | `:332`、`:355`；演练 (d) 全部 true。保留份数：见 F4（同秒备份顺序问题） |
| 8 | 导出 JSON：旧 reader 读出与导出前相同（revision 除外）；旧 revision 被拒；库改名保留；切回 SQLite 一致 | **PASS** | `:378`；演练 (e)(f) 全部 true。旧 reader 用的是 `upgradeBoard`，与 89f0333^ 相比 `server/migrate.ts` 无改动 |
| 9 | 迁移“改名前”和“改名后、写标记前”两处强杀，重启收敛到完整旧态或完整新态 | **PASS** | `sqlite-crash.test.ts:84`（两处 `test.each`，真实 SIGKILL 子进程）。额外覆盖 `save:written`。**未在 Helper 运行时内做 kill 演练**（UNRUN） |

里程碑验收要求的“实际 Paseo Helper 运行时打开 node:sqlite 并完成一次迁移”：**PASS**（演练 (b)）。

## 3. 演练（`drill.mjs`，结果 `drill-result.json`）

方法：`~/.paseo/plugin-data/flowly/board.json`（及 `.bak`）只做 `copyFile`，全部操作在 mkdtemp 副本上进行。编译使用 Paseo 真实 `compilePlugin`（入口临时放在验收 worktree 根目录，编译后删除）。输出只含计数、大小、哈希、耗时和结果码。

- 检查项 23 个，全部 true：迁移与 JSON reader 相同、marker、快照 sha256 = 原文件、快照 board.json 字节与原文件相同、备份 1 份、编辑重开保留、恢复内容 = 原始、所有 revision 高于编辑前、旧 revision 编辑被拒、被替换库保留并含编辑、导出版本 5、旧 reader 读出一致、JSON 模式读出一致、库改名为 retired、storage-mode.json 写入、切回 SQLite 内容一致。
- 数量：6 项目、106 卡、4515 事件、77 想法、64 workpad、2730 回执。
- 大小：原 board.json 4 933 403 B；迁移后 flowly.sqlite 7 000 064 B。
- 耗时：迁移+首次读 376 ms；之后读 7 ms；编辑 22 ms；恢复 193 ms；导出 58 ms；切回 SQLite 227 ms。
- 原文件：演练前后 mtime 与大小不变（drill 只 copy/stat）。`~/.paseo/plugin-data/flowly` 下没有出现 `flowly.sqlite` 或 `storage-owner.sqlite`。
- 注：验收会话为确定 version，曾直接只读访问一次原 board.json（只输出 version 与 revision，未输出内容）。

探针结果（超出 §11 的故障注入）：

| 探针 | 结果 | 对应发现 |
|---|---|---|
| P1 导出时 board.json 已替换、storage-mode.json 未写（注入异常） | 重开 → `STORAGE_DIVERGED` | F1 |
| P2 导出后 retire 改名失败（目标为目录，EISDIR） | 导出抛错；之后读写 `STORAGE_BUSY`，状态 `Starting.`；真实时钟重启后恢复，内容一致 | F2 |
| P3 同一秒内连续 8 次备份（含迁移备份） | 列表第一项是最早的基础名文件；保留 7 份时删除的是 `-1` | F4 |
| P4 真实第二进程持有期间打开 | `STORAGE_BUSY` | 通过 |

## 4. 审查发现（按严重程度）

**F1 — Medium（已复现：P1）**
`server/sqlite-storage.ts:638–640`：`exportJson` 先原子替换 board.json（真实看板，revision 已加偏移），再写 storage-mode.json。两步之间中断（崩溃、写 mode 失败）后，下次启动 `open()` 看到 flowly.sqlite 存在且 board.json 是真实看板，sha256 与快照不符（`:343–346`），进入 `STORAGE_DIVERGED`，需要人工选择。数据两份都在，没有丢失；但启动被阻断，且规范 §8/§11 未覆盖这一窗口。建议：先写 storage-mode.json，或在导出中断时把 board.json 还原为退休标记。

**F2 — Medium（已复现：P2）**
`sqlite-storage.ts:642–643`：`closeDatabase()` 把状态设为 `starting`（`:405`），随后 `retireDatabase` 若失败，异常直接上抛，状态永远停在 `starting`。之后所有读写都返回 `STORAGE_BUSY / Starting.`，直到插件 reload。重启后可以恢复（P2 第二段）。建议：在 `exportJson` 中对 retire 失败做 try/catch，并把状态切到 `json`（导出已经完成）。

**F3 — Medium-Low（待确认，未复现）**
`sqlite-storage.ts:463–464`：`rename(tmp, DB)` 和 `syncDirectory` 在 `migrate` 的 try 之外。失败时异常经 `open()` 到 `start()` 的 catch（`:258–261`），进入 `STORAGE_INVALID` 错误态，而不是规范 §6 要求的“继续用 JSON”；临时库也不会被删除（下次启动会删）。重启可以收敛。触发条件（rename 失败且 DB 不存在）难以在本机构造，所以未复现。

**F4 — Low（已复现：P3）**
`sqlite-storage.ts:499`（`.sort().reverse()`）和 `:536`（超过 7 份时的删除）：同一秒的备份名 `…-N.sqlite` 与基础名 `….sqlite` 的字典序与创建顺序不一致（`-` < `.`）。列表第一项是最早的基础名文件，保留 7 份时删掉的是 `-1`。只在一秒内连续备份多次时出现。建议按时间戳加序号数值排序。

**F5 — Low（读代码，未复现）**
`sqlite-storage.ts:604–606`：`restore` 在 `openDatabase` 失败时（它会把状态置为 error）仍然正常返回 `{ aside }`，界面会显示“恢复成功”。

**F6 — Low（已验证：权限探针）**
规范 §4 写“文件 0600”。实际：备份文件与迁移快照内的 board.json 为 0644（它们位于 0700 目录内，外部访问受目录限制）。导出的 board.json 与 storage-mode.json 为 0600。建议备份文件创建后 chmod 0600。

**F7 — Low（读代码，未复现）**
规范 §11.7 的“旧版本拒绝退休标记”测试（`sqlite-store.test.ts:99`）调用的是当前的 `upgradeBoard`，不是上一版 `store.ts` 的 `load()`。上一版 `load()` 在 `version !== 5` 时会先执行 `keepPreUpgradeCopy`，因此会把退休标记复制成 `board.pre-v4.json`（COPYFILE_EXCL，无害）。这是旧版本的副作用，不影响数据。

**测试覆盖（非实现缺陷）**：§11.2（JSON 与 SQLite 对照、项目增删）、§11.4（每一步失败）、§11.5（版本过低的启动路径）见第 2 节。

## 5. 未运行 / 未覆盖

- UNRUN：Helper 运行时内的强杀演练（§11.9 只在 vitest 子进程中验证）。
- UNRUN：Settings > Storage 界面与 RPC 端到端（不在 §11 清单内，未检查）。
- 实现的 `writeBoard` 每次写入都对全部元素做 `JSON.stringify`，每次写还做全板 zod 解析。这不是本次的验收项，留给加载优化阶段。

## 6. 清理

- 演练临时目录：7 个，已全部删除（`cleanup.tempDirsRemoved = true`）。
- 验收 worktree 与其临时父目录：检查结束后删除（见下方最终状态）。
- 临时文件（`/tmp/fv-*`）：已删除。
- 未向 `~/.paseo/plugin-data/flowly` 写入任何内容；未安装或 reload 插件；未创建 Paseo 会话、项目或卡片；未调用 Flowly 写入工具。
- 未修改任何实现文件，未 commit。本目录下只新增了 `README.md`、`drill.mjs`、`drill-result.json`。
