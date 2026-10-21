# Connectors 验收记录

- 日期：2026-10-20
- 测试执行 session：`01a158d9-4112-71b0-8c48-da3649e78702`（`codex/gpt-6-luna`，`full-access`）
- 卡片读取 session：`01a158e3-5b03-75a1-a7c0-df333a4cfbb9`（`codex/gpt-6-luna`，`full-access`；已归档）
- Checkout：`/Users/bofan.wang/Developer/personal/paseo-utlra-kanban`
- Commit：`06c72aa`；测试前 checkout 已 dirty（连接器实现及其它并行工作未提交），测试只写了本报告和 `docs/verification/connectors/` 证据。

## Mock 与运行环境

- 浏览器：headless Chrome，`https://app.paseo.sh`，独立浏览器上下文；桌面视口 1700×1000，紧凑触控视口 430×900（`isMobile`、`hasTouch`）。使用 `local-network-access` 权限连接本地 daemon。
- 假服务脚本：`/tmp/flowly-connectors-mocks.mjs`；所有服务仅监听 loopback，结束时停止。
  - GitLab：`http://127.0.0.1:19381`，`/api/v4`；包括 `group/app#7` 与 `group/app!8`。MR 带源/目标分支、head sha、2 个 diff 文件、1 条人类 diff note 和 1 条 system note。
  - GitHub Enterprise：`http://127.0.0.1:19382`，`/api/v3`；包括 issue `acme/web#3` 与 PR `acme/web#12`。PR 页面链接使用 `/issues/12`。
  - Confluence 自建：`http://127.0.0.1:19383`；页面 `123456` 的 storage body 包含标题、列表、code 宏和 info 宏。
- 假 token 只用于本地服务；日志只保留 method、path、query、`authPresent` / `authAccepted` 布尔值，不记录凭据。证据日志：[`requests-initial.jsonl`](connectors/requests-initial.jsonl)、[`requests-note-change.jsonl`](connectors/requests-note-change.jsonl)、[`requests-label-only.jsonl`](connectors/requests-label-only.jsonl)。合计 61 条：60 条接受、1 条为专门的错误 token 测试；全为带鉴权 GET，均命中 adapter 白名单路径。

## 验收项

| # | 结果 | 证据 |
|---|---|---|
| 1 | **PASS** | Connections 显示 Jira、Confluence、GitHub、GitLab 四组。三条 mock 连接均经 UI 测试成功并保存；错误 GitLab token 返回拒绝且未保存；编辑页 token 输入为空并显示 `Unchanged`。见 [错误 token](connectors/04-invalid-credential.png)、[GitHub](connectors/05-github-connected.png)、[Confluence](connectors/06-confluence-connected.png)、[四组设置](connectors/21-connections-four-groups.png)、[编辑连接](connectors/22-edit-connection-unchanged.png)。 |
| 2 | **PASS** | 抽屉 Artifacts 只有一个 `+`；菜单有 File or link 与每个已连接服务，没有 `Connect another service…`。见 [Add 菜单](connectors/10-add-menu.png)。 |
| 3 | **PASS** | Recent list 选择 `group/app!8` 后显示 Linked toast；行显示 `GitLab merge request · Open`。预览包含 branches、head sha、2 个文件、人类 diff note、Open in GitLab、Refresh；system note 未显示。`!8` 和 `7` 在项目无匹配 remote 时都显示 `No match in this project's repositories. Try owner/repo#12 or a link.`；文字 `login` 搜索返回 mock issue 和 MR。见 [picker](connectors/11-gitlab-picker-recent.png)、[row/toast](connectors/12-gitlab-linked.png)、[预览](connectors/13-gitlab-preview.png)、[!8](connectors/14-gitlab-search-bang8.png)、[7](connectors/15-gitlab-search-7.png)、[文字搜索](connectors/16-gitlab-search-text.png)。 |
| 4 | **PASS** | File or link 粘贴 `http://127.0.0.1:19382/acme/web/issues/12` 后，保存结果识别为 `acme/web#12`、`GitHub pull request · Open`，标题为 `acme/web#12 Add secure login flow`，artifact 为 input。board.json 中 `itemType: pull`、`role: input`。见 [识别输入](connectors/19-github-url-recognized.png)、[保存后](connectors/20-github-added.png)。 |
| 5 | **PASS** | 用标题词 `Connector` 搜索并添加 Confluence 页；预览 Markdown 显示 heading、列表、代码块和 `Info: Important context.`。见 [标题搜索](connectors/23-confluence-title-search.png)、[预览](connectors/17-confluence-preview.png)。 |
| 6 | **PASS** | 卡片面显示 `app!8 +1`；Confluence 页面不生成卡片 key。见 [卡片与抽屉](connectors/20-github-added.png)。 |
| 7 | **PASS** | New task 表单显示 From Jira / Confluence / GitHub / GitLab 四个按钮。选择 Confluence 页后空标题预填 `Connector Test Page`，chip 出现并随卡片提交；抽屉确认其为 input。随后对该临时卡执行 Delete permanently，并归档其 1 个 session 与 workspace。见 [表单](connectors/07-new-task-form.png)、[选择后](connectors/07-new-task-picked.png)、[删除确认](connectors/34-delete-temp-card-confirm.png)、[删除后](connectors/35-temp-card-deleted.png)。 |
| 8 | **UNRUN（仅 Jira 专属字段分支）** | 卡片 session 逐一调用 `flowly_get_task` 与 `flowly_read_external`，三项返回与 mock 一致：GitHub pull、GitLab merge request、Confluence page；`get_task` 带 `external`，非 Jira 条目没有 `ticket`。新增 GitLab human note 并推进更新时间后，`group/app!8 external.unread=true`；重新读取后只改 label/updated_at，`unread=false`。由于约束禁止向卡片添加真实 Jira 工单，本轮未能运行时验证“`ticket` 仅在 Jira 条目上出现”的 Jira 正向分支。 |
| 9 | **FAIL（缓存清理）** | 删除 GitLab 前确认框正确显示 1 张受影响卡；卡片行显示 Connection removed；同地址重新添加后行恢复 Open，无需编辑卡片。**缺陷：**完成卡片/连接清理后，`~/.paseo/plugin-data/flowly/connectors/cache.json` 仍留有 5 条指向本次 loopback mock 的摘要（GitLab issue/MR、GitHub issue/pull、Confluence page）。复现：添加 mock 连接、搜索/读取条目、删除连接；读 cache.json 可见条目仍存在。实现位置：[server/connectors/service.ts](../../server/connectors/service.ts#L263) 的 `remove()` 删除 Map 条目后未调用 `persist()`，落盘 cache 没有同步清除。未直接编辑插件数据或实现文件。UI 证据：[确认计数](connectors/25-remove-gitlab-confirm.png)、[已移除](connectors/26-gitlab-connection-removed.png)、[恢复](connectors/27-gitlab-connection-restored.png)。 |
| 10 | **PASS** | 430×900 触控布局下 Artifacts `+` 打开底部菜单，GitLab picker 可显示 recent items，搜索框位于可视区域（x=33, y≈548, w=364, h=36）。见 [触控抽屉](connectors/31-mobile-drawer.png)、[底部菜单](connectors/32-mobile-add-menu.png)、[picker](connectors/33-mobile-picker.png)。 |
| 11 | **PASS（可观察输出）** | plugin logs `paseo plugin logs flowly`（11,601 字节）及卡片 agent activity/output 均未命中三个 mock token 或错误 token；设置编辑显示 `Unchanged`，连接列表响应不含凭据。读取响应仅检查了可观察的 UI/agent 输出与 plugin logs，没有捕获 daemon 内部原始 RPC frame。 |

## 清理验证

- `connectors/connections.json` 仅含原 Jira `jira-dc / https://jira.shopee.io`；三条 mock 连接均已从 UI 移除。Tinylink 插件数据仍有原 project 和 6 张原卡，临时卡 `f7021739-fc85-45c7-9ce4-64971a9de738` 及其 artifacts 已删除。
- 测试卡 workspace `wks_65f6e99be9072033` 已不在 Paseo 活跃 workspace 列表。卡片 session agent `660f3541-622b-4e75-814e-b72d8c6a1c9e` 已归档（status closed）；自动生成的 summary agents 也均 closed/archived。
- Mock server 已停止；Playwright contexts/browser 已关闭。临时卡使用既有 Tinylink 目录，未创建或删除该目录。
- 已知清理缺口：上述 `cache.json` 残留由第 9 项缺陷导致；token 未出现在该 cache、plugin logs 或 agent outputs 中。按“禁止直接改插件数据文件”的约束保留为缺陷证据。

## 失败摘要（先列）

1. **FAIL：**删除连接未将缓存清理持久化，`cache.json` 留有 5 条 mock 摘要；见第 9 项和 `server/connectors/service.ts:263-269`。
2. **UNRUN：**未对 Jira 条目的 deprecated `ticket` 兼容字段做运行时正向验证；本轮遵守“不把真实 Jira 工单加到卡片”的要求。
3. 其余 UI、连接、三种外部读取、unread 变化与触控验收均通过；未发现其它产品缺陷。

## Re-check after fixes (2026-10-20)

本节使用 11:05 重载后的 `flowly` 运行实例；结果覆盖并更新初次验收的 case 9 缓存清理 FAIL。测试执行 session 仍为 `01a158d9-4112-71b0-8c48-da3649e78702`（`codex/gpt-6-luna`, `full-access`，commit `06c72aa`，checkout dirty）。本次没有创建 agent session；两张测试卡均为 0 session。

Mock 沿用 loopback GitLab `:19381`、GitHub Enterprise `:19382`、Confluence `:19383`，另启 `:19384` 仅记录 changed-address 测试是否到达。GitHub mock 加入 `group/app#7`，与已链接的 GitLab issue 使用相同 key。脚本在 `/tmp/flowly-connectors-recheck-mocks.mjs`；请求日志只记录 method/path/query/鉴权布尔值。共 29 个请求，全部为白名单 GET 且鉴权通过；`:19384` 探针 0 字节。

| 项 | 结果 | 结果与证据 |
|---|---|---|
| A. 删除 GitLab 后持久清缓存并恢复 | **PASS** | 临时卡关联 MR `group/app!8` 和 issue `group/app#7`。先移除 GitHub mock 以隔离断言，再移除 GitLab：删除前缓存有 2 条 GitLab loopback 摘要，删除后为 0（仅 Jira 缓存保留）。预览显示连接已移除；以相同地址重加后，Artifacts 行恢复 `GitLab merge request · Open`，预览出现 `Open in GitLab`。见 [删除前](connectors/recheck-2026-10-20/a-final-linked-before-remove.png)、[移除时](connectors/recheck-2026-10-20/a-final-removed.png)、[重加恢复](connectors/recheck-2026-10-20/a-final-restored.png)。 |
| B. 跨 provider 相同 key 不误判已关联 | **PASS** | GitLab `group/app#7` 已在卡片上时，GitHub picker 的同 key 条目仍可选，行未禁用且没有 `On card …`；选择后形成各自 provider 的 input。见 [collision picker](connectors/recheck-2026-10-20/b-github-cross-provider-collision.png)；board.json 中 GitLab 与 GitHub 两条 artifact 的 key 相同、provider 不同。 |
| C. 改地址但不填新 token | **PASS** | 编辑 GitLab 地址为 `http://127.0.0.1:19384`，不输入 token 后 Test 显示“地址或类型已更改，需要重新输入 token”；19384 探针无请求。见 [提示](connectors/recheck-2026-10-20/c-address-change-needs-token.png)。 |
| D. 拒绝非 loopback HTTP | **PASS** | 新建 GitLab 连接填 `http://example.invalid` 与本地假 token，Test 和 Save 均返回 `Use an https address for GitLab`；mock 日志无该地址请求。见 [HTTPS 拒绝](connectors/recheck-2026-10-20/d-http-address-refused.png)。 |
| E. GitHub `/issues/` PR URL | **PASS** | 粘贴 `http://127.0.0.1:19382/acme/web/issues/12` 后创建为 `acme/web#12 Add secure login flow`，role=`input`、itemType=`pull`，行显示 `GitHub pull request · Open`。见 [PR 识别](connectors/recheck-2026-10-20/e-github-pr-from-issues-url.png)。 |

### Re-check 清理

- 本轮临时卡 `Connectors recheck 2026-10-20` 和额外重跑 A 的 `Connectors recheck A 2026-10-20` 均已永久删除；其 artifacts 一并删除，两个 workspace 均不在 Paseo 活跃列表中。没有创建 session，因此没有待归档的测试 agent。
- GitLab 与 GitHub mock 连接均已从 Settings 移除；Confluence 未添加。`connections.json` 只剩原 Jira；Tinylink 恢复为原有 6 张卡。最终 `cache.json` 只有 1 条 Jira 缓存、0 条 loopback 条目。
- mock server 已停止，Playwright browser/context 已关闭。plugin logs 未命中两个 re-check mock token。
- 第一轮自动化因设置页关闭转场超时而未建卡；随后重试时短暂保存了重复 GitLab mock 连接，该重复连接已移除。最终连接、缓存、卡片和 workspace 清理已按上文复核。

## 真实服务联调（2026-10-20，实现 session 85c0d154）

令牌来源：用户指定的本机 `~/.env`（`GITLAB_TOKEN`、`CONFLUENCE_TOKEN`；没有 GitHub 令牌）。令牌只由脚本读入设置页表单，没有打印、没有写入仓库；保存后核对 `connections.json` 为 0600，`paseo plugin logs flowly` 中命中令牌 0 次。按项目规则通过设置页配置（headless Chromium 驱动 app.paseo.sh，未触碰用户的 Paseo 窗口），没有直接写数据文件。

| 项 | 结果 | 证据 |
|---|---|---|
| GitLab 连接（https://git.garena.com，自建） | **PASS** | Test connection：`Connected as Bofan Wang (@bofan.wang)`；保存为 “Garena GitLab” |
| Confluence 连接（https://confluence.shopee.io，自建） | **PASS** | Test connection：`Connected as Bofan Wang`；保存为 “Shopee Confluence” |
| GitLab MR 链接识别 | **PASS** | `…/agent-smith/-/merge_requests/209/diffs` → `shopee/deep/agent-smith!209`，多级 group、`/diffs` 子页面去掉，状态 Merged |
| GitLab issue 链接识别 | **PASS** | `shopee-server/search#32`，Open，指派人正确 |
| Confluence viewpage 链接识别 | **PASS** | 页面 id 3328653496，空间 Shopee Search Team |
| `flowly_read_external` 三项 | **PASS** | MR：分支、head sha、描述、评论；issue：描述；页面：元数据、路径、版本、表格、评论 |
| **发现并修复**：MR 改动文件 | **FAIL → PASS** | git.garena.com 为 GitLab 14.10，没有 `/diffs`（15.7 才有）→ 文件列表缺失。改为 404 时回退 `/changes`（只取文件名，不取 patch），加回归测试；reload 后重读列出 100+ 个文件 |
| + 菜单 | **PASS** | `File or link… / Jira ticket… / Confluence page… / GitLab issue or merge request… / Connect another service…`（GitHub 未连接） |
| 选择器“我的最近” | **PASS** | GitLab 10 条（含 Draft MR 状态），Confluence 10 条 |
| 选择器文字搜索 | **PASS** | GitLab `check_item_visibility` → 3 个 MR；Confluence `Telemedicine` → 11 个页面 |
| GitHub | **UNRUN** | `~/.env` 中没有 GitHub 令牌 |
| 真实条目的 unread | **UNRUN** | 不修改真实工单/页面；由 mock 测试覆盖 |

已知限制（未改）：Confluence 中 `ri:user` 提及显示为 user key（如 `@8a3c…`），需要额外的用户查询才能换成姓名；嵌套表格被压成单元格内文本，可读但不美观。

清理：本卡上的 3 条临时 input 已移除；两个连接按用户要求保留；`/tmp` 下的脚本与截图（含公司内容）已删除。

## 用户反馈修正（2026-10-20 晚）

1. **GitHub 从 New task 选择时报错**：`GitHub rejected the request (HTTP 422): Query must include 'is:issue' or 'is:pull-request'`。GitHub 现在要求每个 issue 搜索都声明类型。修正：所有搜索拆成 `is:issue` 与 `is:pull-request` 两个请求并行，按更新时间合并；测试中的 GitHub 模拟也照此拒绝缺类型的查询。
   - 真实验证（用户自己配置的 github.com 连接，@JasprW）：New task → From GitHub 最近列表 10 条，issue 与 PR 混排、无报错；“我参与的全部”搜索 `usage` 返回 6 条；项目仓库（JasprW/flowly）内搜 `flowly` 为 0 条，属正常的无结果。**PASS**
2. **Confluence 默认列表改为“我最近看过和编辑过的”**：DC 用 `/rest/recentlyviewed/1.0/recent`（带查看时间），Cloud 用 CQL `recentlyViewedContent()`；与 `contributor = currentUser()` 合并去重，按 max(查看时间, 最后修改时间) 倒序。
   - 真实验证（confluence.shopee.io，DC 7.13）：From Confluence 最近列表 10 条，最前面是 4 小时前看过的页面，后面是更早看过或编辑过的页面。**PASS**
- `npm run typecheck` 通过；`npm test` 103 个文件，795 通过 / 65 跳过（含其他卡片新增的测试）；connector 测试 47 个。

## 品牌图标（2026-10-21）

用户要求每个 connector 配自己的 icon。Headless Chrome（不碰用户的 Paseo 窗口）打开 app.paseo.sh 截图核对：
- 设置 → Connections 分组行与编辑页标题、Artifacts 的 + 菜单、New task 的 From 按钮：四个 logo 都显示，浅色与深色主题都清楚（GitHub 深色下用浅色版本）。**PASS**
- 本卡临时加 GitLab MR 输入 `agent-smith!209`：侧栏 Artifacts 行与卡片正面的 key 前都是 GitLab logo。**PASS**；该输入随后已移除。
- 截图含公司内容，核对后已从 `/tmp` 删除，未进仓库。

