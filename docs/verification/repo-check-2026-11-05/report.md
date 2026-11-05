# 建卡/挂接仓库归属校验 · 桌面 UI 走查（2026-11-05）

树 `dbcb59c`（PR JasprW/flowly#83）。验证方式：已验证的本地交换安装（备份 `~/.paseo/plugin-data/flowly` + `plugin-settings/flowly` 到 `/tmp/flowly-backup-2026-11-05.tar.gz` 后 `paseo plugin remove flowly && paseo plugin install <本卡 worktree> --id flowly`，插件数据与卡片会话全程存活），Playwright + `docs/promo/shot-lib.mjs`（系统 Chrome）驱动 app.paseo.sh。

环境事实：GitHub 连接（账户 HybridRbt）；flowly 项目 remote = `HybridRbt/flowly`（origin）+ `JasprW/flowly`（upstream），projectRepos = 两仓库；另一项目 "paseo sync" 的项目仓库含 `HybridRbt/paseo-sync`。

| # | 用例 | 结果 | 证据 |
|---|------|------|------|
| A1 | flowly 看板 New task 表单直查 `HybridRbt/paseo-sync#4`（绕过项目搜索范围的 key 查询）选中 | PASS：警告「HybridRbt/paseo-sync#4 does not belong to flowly's repositories. The card's workspace will not contain this repository. It belongs to paseo sync's repositories.」+ Cancel / Add anyway | A1-foreign-warning.png |
| A2 | 警告点 Cancel | PASS：警告消失、无条目条 | results.json |
| A3 | 重选并点 Add anyway | PASS：条目条出现、警告消失（未点 Create，无卡片残留） | A3-added.png |
| B/等价 | 项目自有仓库条目沉默：paseo sync 看板选 `HybridRbt/paseo-sync#4`（其项目仓库）；daemon 日志 `[repo-check] state member`；flowly 看板选 `JasprW/flowly#83`（upstream remote ∈ projectRepos） | PASS：两种均直接加入、无警告 | member-silent-paseo-sync.png/txt、probe-console.txt（客户端 RPC 返回 `{"state":"member","projectTitle":"paseo sync"}`）；flowly 侧 B1 自动化断言被板面卡片标题里的 "does not belong" 字样误染（卡片标题本身含该短语），按等价路径（同一 RPC、同一判定）记通过 |
| C1 | 卡片抽屉 Artifacts + → GitHub issue or pull request… 选 `HybridRbt/paseo-sync#4`（挂在 flowly 项目的卡片上） | PASS：同一警告 + Cancel / Link anyway | C1-attach-warning.png |
| C2 | 点 Link anyway | PASS：条目挂接成功（rpc.createArtifact 路径） | C2-linked.png |
| C3 | 清理 | PASS：测试 artifact 已移除，卡片无残留 | results-c.json |
| D2 | paseo sync 看板上选 flowly PR 出警告（项目名应显示 paseo sync） | 未跑（自动化切换项目不稳）；等价路径已覆盖：projectTitle 由同一 RPC 返回（daemon/客户端日志均见 "paseo sync"），A1 已证警告用 projectTitle 渲染 | probe-console.txt |

自动化备注（非产品问题）：
- 首轮误开在 "paseo sync" 看板（上次活跃项目），paseo-sync 条目在那儿是 member、正确沉默——反向印证了判定。
- 点击抖动来自抽屉渲染本卡会话的实时转写（布局持续漂移）与宿主工作区卡片同名；改用安静卡片 + "Open Kanban task" 入口后稳定。

未运行：非 git 族（Jira 等）沉默——该 daemon 只有 GitHub 连接，无条目可选；属结构性保证（客户端在族上先短路，不发 RPC）。手机端走查未做。

无副作用：未创建卡片（A 组从未点 Create）；C 组测试 artifact 已删除。
