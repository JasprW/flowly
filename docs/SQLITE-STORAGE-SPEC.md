# 看板数据迁入 SQLite（最小方案）

状态：**2026-10-26 用户确认最小方案，实施中**。卡片“数据存储和加载优化”。本文替代 2026-10-25 的完整设计、减法稿（D1–D4）和迁移测试方案；旧文、18 个 fixture 增量和全部证据原样保存在本地分支 `archive/sqlite-r1-v1`（不推送）。

## 1. 决定

用户 2026-10-26 的指示：先完成 SQLite 迁移，再做加载优化；在可回滚、不丢数据的前提下尽量简化，避免过度设计。据此：

| 旧决定 | 现在 |
|---|---|
| D1 首次迁移前要用户确认 | 启动时自动迁移。迁移前把原文件整份存入快照；失败就继续用 JSON，不影响使用。 |
| D2 恢复后的发送队列持久暂停、人工核对 | 不再需要：发送队列（composer）留在 JSON，恢复备份不碰它，不会重发。 |
| D3 异常原文逐条保留、可浏览 | 收窄为源快照整份保留：迁移只接受现有 reader 能读的看板；读不了就不迁移。 |
| D4 只能回滚到一个带请求代际校验的指定 JSON 包 | 改为“导出成 v5 board.json + 所有 revision 加偏移”，之后可直接装回上一个公开版本。签名请求和 RPC 形状都不改，所以旧版本能直接读、旧请求会因 revision 不符被拒。 |

不做（已从旧方案删除）：指定回滚包、storageEpoch/generation、`storage.mutate-v1`、11 阶段 control/journal 状态机、reimport 流程、严格 JSON 解析器、原文表、附属文件入库、两阶段发送票据、文件系统白名单与平台矩阵、10 个维护 RPC。

## 2. 范围

- 迁入 SQLite 的只有 `board.json`：projects、tasks、events、ideas、links、artifacts、workpads、plans、attentionDismissals、agentReceipts 和 revision。
- 不变：summaries、memory、digests、workflow insights、outside sessions、composer（草稿/队列/图片）、各类已读水位、flow/commands 日志、project 文件夹里的 `.flowly/project.json`。它们仍是各自的原子 JSON 文件。
- 读取行为不变：所有 RPC 仍拿到同样的 Board。加载优化（按需读取、局部刷新）是下一步，在本方案稳定后另做，复用同一个数据库。

## 3. 文件

都在 `dataDirectory()` 下：

| 文件 | 作用 |
|---|---|
| `flowly.sqlite`（及 `-wal`/`-shm`） | 看板数据。唯一的业务来源。 |
| `storage-owner.sqlite` | 进程锁：持有它的 Flowly 进程才能打开业务库。不存数据，不参与备份。 |
| `board.json` | 迁移后换成**退休标记**：`{"version":0,"storage":"sqlite",...}`。旧版本读到它会报“数据无效”并拒绝写入，而不会当成空看板。 |
| `migrations/<时间>/` | 迁移前的源快照：原 `board.json`、`board.json.bak` 和 `manifest.json`（sha256、大小）。永久保留，不轮换。 |
| `backups/flowly-<时间>.sqlite` | 自动和手动备份，只保留本插件生成的最新 7 份。 |
| `flowly.sqlite.before-restore-<时间>` | 从备份恢复前的当前库，保留不删。同一秒内重名时加序号，不覆盖已有文件（下同）。 |
| `flowly.sqlite.retired-<时间>` | 导出回 JSON 后退役的库，保留不删。 |
| `storage-mode.json` | 只在导出回 JSON 后存在：`{"backend":"json"}`，表示不要自动再迁移。 |

## 4. 表结构

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
-- schema = 1, board 的标量字段（version、revision）各一行，值为 JSON
CREATE TABLE items (
  collection TEXT NOT NULL,   -- Board 的数组字段名，例如 tasks、events
  key TEXT NOT NULL,          -- id / key / taskId；同一集合里重复时加 #序号
  ord INTEGER NOT NULL,       -- 在数组里的顺序
  task_id TEXT,               -- 便于以后按卡读取
  project_id TEXT,
  body TEXT NOT NULL,         -- 该元素的 JSON
  PRIMARY KEY (collection, key)
) STRICT;
CREATE INDEX items_task ON items (collection, task_id);
CREATE INDEX items_project ON items (collection, project_id);
```

集合按 Board 自身的数组字段自动处理，以后 Board 新增数组字段不需要改表。顺序原样保留：只追加/删除时已有行的 `ord` 不动，否则整组重新编号。

连接设置并读回确认：`journal_mode=WAL`、`synchronous=FULL`、`busy_timeout`。目录 0700；数据库、迁移快照和备份文件 0600。

## 5. 读写

`BoardStore` 的业务逻辑一行不改，只把“读出整板 / 写回整板”换成持久层接口：

- **读**：启动时从库里读出整板，用 `storageSchema` 和现有不变量校验后缓存在内存。`read()`/`view()` 返回缓存的副本。只有本进程写库（owner 锁保证），所以缓存不会过期。
- **写**：在副本上执行原来的操作 → `revision+1` → 现有不变量检查 → `storageSchema.parse` → 和缓存逐元素比较 → 在一个 `BEGIN IMMEDIATE` 事务里只写变化的行和 revision → 提交成功后才更新缓存。任何一步失败都回滚，缓存不变，和今天一样报错。回执（agentReceipts）与业务数据在同一事务里。
- 不再整份重写 `board.json`，也不再复制 `.bak`。flow 日志、`onCommit`（project 文件夹导出）照旧在提交后执行。

## 6. 启动与首次迁移

插件启动时，所有看板读写先等存储就绪（`BoardStore` 内部队列），无需额外 gate。规则按顺序判断：

1. `storage-mode.json` 为 json：若 `board.json` 已是真实看板 → 用 JSON（导出之后；库若还在就补做改名，改名失败只记日志，库留着不用）；若 `board.json` 还是退休标记 → 导出没完成，删除 `storage-mode.json`，按下面的规则继续用 SQLite。
2. 当前 Paseo 没有 `node:sqlite`，或 SQLite 版本低于 3.51.3（3.50.x 需 ≥3.50.7，3.44.x 需 ≥3.44.6；更早的版本有 WAL 损坏缺陷）→ 用 JSON。如果数据其实已经在 SQLite 里（board.json 是退休标记），则报错并说明要升级 Paseo，绝不当成空看板。
3. 取 owner 锁。被占用（多半是 reload 时旧进程还没退出）就短暂重试；仍失败则报 `STORAGE_BUSY`，下次读写时再试。不会退回 JSON。
4. 删除残留的 `flowly.sqlite.tmp`（未提交的迁移半成品）。
5. `flowly.sqlite` 存在：
   - `board.json` 是退休标记或不存在 → 正常使用（不存在就补写标记）。
   - `board.json` 是真实看板且 sha256 等于最近一次迁移快照里的原文件 → 上次迁移在“改名后、写标记前”中断，补写标记后正常使用。
   - 否则 → `STORAGE_DIVERGED`：两份数据都保留，不自动选择，错误信息写明两个文件的位置。
6. `flowly.sqlite` 不存在：
   - `board.json` 是真实看板 → **迁移**（下文）。
   - `board.json` 是退休标记，或存在 `backups/`、`migrations/` → `STORAGE_MISSING`：不建空库；存储页仍可从备份恢复。
   - 什么都没有 → 新安装：建空库并写退休标记。

**迁移**（任一步失败：删除 tmp，`board.json` 不动，本次继续用 JSON，并在存储页显示原因；下次启动重试）：

1. 用现有 reader 读 `board.json`（含 v1–v4 升级）。读不了就和今天一样报“数据无效”，不迁移。
2. 把 `board.json`、`board.json.bak` 复制到 `migrations/<时间>/`，写 `manifest.json`，读回核对 sha256。
3. 在 `flowly.sqlite.tmp` 建表，一个事务写入全部行，`PRAGMA integrity_check`。
4. 从 tmp 库重新读出整板，与第 1 步的结果做逐值比较（同样经过 `storageSchema`），不一致就失败。
5. checkpoint、关闭、fsync，`rename` 成 `flowly.sqlite`（唯一提交点），fsync 目录。
6. 用 tmp + rename 把 `board.json` 换成退休标记。
7. 打开正式库，随即做第一份备份。

## 7. 备份与恢复

- **自动备份**：迁移后立即一份；之后每次提交时若上一份已超过 24 小时，就在写队列里再做一份。用 `VACUUM INTO` 写到 `.tmp`，`quick_check` 通过后改名。超过 7 份时删除最旧的（只删 `flowly-*.sqlite` 这种本插件生成的文件）。失败只记日志，不影响业务写入。
- **立即备份**：存储页按钮，同上。
- **恢复**：选一份备份 → 先校验（`quick_check`、能读出并通过 schema 和不变量）→ 在写队列里关闭当前库，改名为 `flowly.sqlite.before-restore-<时间>` → 复制备份为 tmp → 把 board、所有 project、task、workpad 的 revision 都加上偏移（当前库里最大的 revision + 1）→ 改名为 `flowly.sqlite` → 重新打开。加偏移是为了让恢复前发出的旧编辑和旧 agent 请求都因 revision 不符被拒，客户端也会把恢复后的看板当成更新的数据。库缺失（`STORAGE_MISSING`）时也能恢复。
- 恢复不改发送队列和其他 JSON 文件；flow 日志里可能留有备份点之后的历史事件，只影响统计，不影响看板。

## 8. 回滚到 JSON

存储页“导出为 JSON”：

1. 在写队列里读出当前看板，所有 revision 加偏移（同上）。
2. 先写 `storage-mode.json`，再把看板写成 v5 格式的 `board.json`（tmp + rename，替换退休标记）。两步之间中断时，下次启动看到退休标记，就当导出没发生（§6 规则 1）；写完 board.json 后中断，下次启动完成导出。
3. 把 `flowly.sqlite` 改名为 `flowly.sqlite.retired-<时间>`。改名失败不影响导出：board.json 已是看板，库留着不用。
4. 本进程立刻改用 JSON 继续工作。用户此后可以装回上一个公开版本（它能直接读这个 board.json），也可以留在新版本里用 JSON。

存储页“切换回 SQLite”：先把残留的库改名，再删除 `storage-mode.json` 并立即按 §6 迁移（等同首次迁移，源是当前的 board.json）。

导出后若有极少数靠 operationId 去重、不带 revision 的建卡请求在 15 分钟有效期内被旧 context 重放，最多会多出一张卡，不会覆盖数据。

## 9. 存储设置页

Settings → Storage，看板读不出来时也能打开：

- 状态：当前后端（SQLite / JSON）、数据目录、库大小、迁移时间、最近备份时间；JSON 时写明原因（未迁移、不支持、迁移失败的原因、已导出）。出错状态（BUSY / DIVERGED / MISSING）显示原因和文件位置。
- 按钮：立即备份；从备份恢复（列出备份，确认后执行）；导出为 JSON（确认后执行）；切换回 SQLite（仅 JSON 模式）。

RPC：`storage.status`、`storage.backup`、`storage.restore`、`storage.export-json`、`storage.use-sqlite`。都是普通请求-响应，不轮询进度。

## 10. 错误

| 码 | 何时 | 用户看到 |
|---|---|---|
| `STORE_INVALID` | 同今天：board.json 读不了 | 原有错误 |
| `STORAGE_BUSY` | owner 锁被另一个 Flowly 进程占用 | 稍后重试或 reload 插件 |
| `STORAGE_DIVERGED` | 库和真实 board.json 同时存在且不是同一份 | 两个文件位置，需要人工选择 |
| `STORAGE_MISSING` | 有 SQLite 痕迹但库不在 | 从备份恢复 |
| `STORAGE_UNSUPPORTED` | 数据在 SQLite 里但当前 Paseo 打不开 | 升级 Paseo |

日志只写文件名、大小、行数和耗时，不写看板内容。

## 11. 验收

**实现者自测**（交付前，在提交的临时 worktree 里）：`npm run typecheck`、`npm test`，以及下列聚焦测试：

1. v1–v5 样本迁移后与旧 reader 读出的结果逐值相同；空 `tags: []` 和缺省 `tags` 保持区别；重复事件 id 保留每一条及顺序。
2. 同一串业务操作（建项目、建卡、编辑、事件、回执、ideas、artifact、workpad、删卡、移除项目）分别在 JSON 和 SQLite 持久层上执行，每步之后两边整板相同；重开数据库后仍相同。
3. 写入中途失败：数据库和缓存都不变，下一次写入正常。
4. 迁移每一步失败都留下原 board.json 不变并继续用 JSON；下次启动能重新迁移。
5. 启动规则：残留 tmp 被删；改名后写标记前中断能补完；DIVERGED、MISSING 不建空库；新安装建空库并写标记；没有 `node:sqlite` 或版本过低时用 JSON。
6. 第二个进程拿不到 owner 锁时报 BUSY，不退回 JSON。
7. 备份 → 修改 → 恢复：看板回到备份内容、revision 全部变大、旧 revision 的编辑被拒、恢复前的库被保留；超过 7 份时只删最旧的自有备份。
8. 导出为 JSON：用旧 reader（`BoardStore` 的 JSON 持久层）读出的看板与导出前相同（revision 除外），旧 revision 的编辑被拒；库被改名保留；切换回 SQLite 后数据一致。导出在两次写文件之间中断、或库无法改名时，重启后状态一致。
9. 在迁移的“改名前”和“改名后、写标记前”两处强杀子进程，重启后都能收敛到完整的旧状态或完整的新状态。

**里程碑独立验收**（合并前，由未写代码的 `claude/claude-haiku-5-5` 会话执行，按 AGENTS.md）：在实现提交上复跑以上检查；用用户本机 Flowly 数据目录的**本地副本**（隔离临时目录，跑完删除，不上传）演练一次迁移、备份、恢复、导出回 JSON，确认与原 board.json 逐值一致；在实际 Paseo Helper 运行时里打开 `node:sqlite` 并完成一次迁移。报告写入 `docs/verification/sqlite-min-2026-10-26/`。

**用户切换**：独立验收通过并合并后，由用户决定何时安装新版本；安装后首次启动自动迁移，原数据留在 `migrations/` 里。
