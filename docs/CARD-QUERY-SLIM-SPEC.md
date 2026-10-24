# Card query 内部兼容层最小瘦身

2026-10-24；范围：NATIVE-OVERVIEW-SPEC 第二阶段完成后的内部清理。

## 1. 目的与依据

独立 `CardDetailProvider` 已接管 native 详情。当前生产源码没有
`CardBoardContext.Provider`，其默认值始终为 `undefined`；因此
`useBoardQuery` 的 `withCardBoard` 分支只会返回原 query。
删除这条无生产入口的旧路径，减少上下文、Proxy 和按 revision 选数据的维护负担。
这是复杂度清理，不承诺加载时长或 FPS 改善。

## 2. 精确改动

| 文件 | 改动 |
|---|---|
| `client/queries.ts` | 删除 `CardBoardContext`、`preferFullBoard`、`withCardBoard` 及只供它们使用的 React imports；`useBoardQuery` 直接返回现有 `useQuery` 结果 |
| `client/queries.test.ts` | 删除仅验证 scoped fallback 的 tracked-result 和 Proxy 行为两项测试；保留 silent poll observer、etag、patch 和 live-agent 测试 |
| `client/session-link-query.test.ts` | 删除旧 scoped Board 与完整 Board 按 revision 合并的测试；保留四项当前完整看板导航/fresh 校验测试 |

不改 `useBoardQuery` 的 key、fetcher、options、etag、重试或通知策略。
直接返回 tracked result，不展开它，也不增加替代 wrapper、框架或缓存。

## 3. 必须保持的行为与契约

- Overview、CardDetail 和完整 Board 继续使用独立类型、query key 与 etag；
  不把任一投影当作完整 Board，不增加 native full-board observer。
- 原生详情继续使用 `CardDetailProvider`；web/旧完整看板读者继续使用原 `useBoardQuery`。
- query 的 data、pending、error、refetch 和按属性追踪行为来自原始 TanStack result；
  读取失败不以旧 scoped 数据冒充成功，删除或 workspace/session 变化仍拒绝访问。
- fresh task/workspace/session 归属、发送授权、失败拒绝与旧 route 隔离不变；
  缓存仍只用于展示，不能授权动作。
- 保留旧 `sessions.card-board` RPC 的注册、schema 和服务端实现，不删除旧客户端可调用的协议。
- 保留现有事件正文、描述搜索、实时 Attention、输入/滚动状态、连续高度动画和 450ms modal 交接。
  动画、路由、UI、写路径、服务端与依赖文件不在修改范围。
- 无可见功能变化，不新增 onboarding、tip 或 What's new 文案。

## 4. 验证与验收

先保存当前 dirty 工作树的产品文件哈希，再修改上述三个文件。
其他产品文件应保持字节一致；历史验证文档不因旧符号名称而改写。

必要检查：

```sh
npm run typecheck
npx vitest run --exclude 'docs/verification/**' client/queries.test.ts client/session-link-query.test.ts client/card-detail-query.test.ts client/overview-query.test.ts server/card-board.test.ts client/session.test.ts
git diff --check -- client/queries.ts client/queries.test.ts client/session-link-query.test.ts docs/CARD-QUERY-SLIM-SPEC.md docs/PROGRESS.md
```

由独立 Paseo `codex/gpt-6-luna`、创建时 `full-access` 的测试会话执行一次 focused 回归并核对源码边界；
复用父方在同一源码上的 typecheck，不重复全量套件，不安装临时 renderer 或依赖。
保留 CardDetail scope/新鲜读取/失败拒绝、Overview key/etag、完整看板 fresh 导航、
发送归属及旧 card-board 投影兼容的现有回归。

验收条件：三个旧符号在生产代码与当前测试中无引用；只删除三项旧层专用测试；
当前上述回归与 typecheck 通过；受保护产品文件哈希不变；清理本轮测试会话。
证据保存到 `docs/verification/card-query-slim-2026-10-24/`。
本轮不构建/安装/重载插件，不操作手机；真实 UI、FPS 和端到端提速不作为本轮结论。
