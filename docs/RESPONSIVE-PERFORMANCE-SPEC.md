# 按可用宽度统一性能策略

2026-10-24 用户决定：不用先验证平台，再逐平台开启；Paseo/Flowly 的性能策略统一，
只根据屏幕/容器宽度区分展现形式。此决定取代早前优化规范中的 Android-only、
native-only 和 web bypass 性能门控。本轮不执行验证，不安装或重载插件。

## 1. 唯一布局判断

`isCompactLayout(width)` 只接受可用逻辑宽度：小于760为紧凑布局，760及以上为宽屏。
尚未测得容器宽度时使用窗口宽度；两者均未知时采用紧凑布局。
根布局、菜单和direct-card路由共用同一容器宽度来源，避免同一界面出现两种compact判断。
宿主的 compact 标记、Android/iOS/Web 身份不再覆盖已知宽度。
布局随窗口/容器宽度变化；不增加设备等级、平台白名单、设置、框架或缓存。

## 2. 统一后的现有路径

| 位置 | 统一规则 |
|---|---|
| Board / direct card | 所有紧凑布局使用现有独立 Overview / CardDetail / 轻量项目 context；宽屏保留完整看板展示路径；DTO/key/etag 仍相互隔离 |
| 被覆盖的 Board | 紧凑布局在详情、项目页或表单覆盖时暂停自身查询/stream；宽屏可见看板继续活动 |
| Drawer | 所有紧凑布局开启现有离屏裁剪；仅可见、未进入session preview的独立详情接手轮询，避免与宽屏根重复轮询 |
| 首屏辅助查询 | 紧凑布局等待主数据后启动；宽屏保持并行。不影响任何显式fresh读取 |
| Ideas / Memory | 所有紧凑布局沿用首批2条、近底部每批+2、Show more兜底；宽屏保留现有列表。筛选/排序/完整计数及编辑行保留规则不变 |
| Sidebar Attention角标 | 所有布局统一读取现有轻量attention.count；删除仅为Web角标读取完整Board/agents/receipts的分支 |
| TaskForm | 所有平台统一在现有进入转场settled后启动重内容及请求；Title/Description节点、取消与Create门控保持 |
| 呼吸点 | 任一连续高度动画进行时都暂时常亮，结束/取消后恢复；不再为Web绕过这一优先级规则 |

平台输入法、键盘坐标、文件选择、快捷键和 React Native Animated 的驱动兼容仍按各自API工作；
这些属于能力适配，不用于选择不同性能策略。不得为消除平台名字而破坏API调用约束。

## 3. 不变量与可见行为

不修改存储、RPC/schema、fresh task/workspace/session归属、发送授权、失败拒绝或路由过期保护。
保留Overview/CardDetail边界、已有历史正文和描述搜索；实时Attention卡面仍结合live agents与receipts。
保留220ms展开/160ms收起、可打断/反转与Reduce Motion、输入/滚动身份及450ms modal交接。
窄窗口Web和iOS现在采用与同宽Android相同的加载、渐进列表和裁剪策略；宽屏不受宿主compact标记强制切换。
Sidebar计数所有平台继续每15秒轻量读取，错误/未知仍为null，不改变入口或角标操作。
本轮无新功能入口、设置或文案，无需新增tour/tip/What's new。

## 4. 修改边界与交付

修改既有布局判断及调用、Board/Drawer/页面/表单/呼吸点/Sidebar性能门控；
同步现有geometry/query-activity测试的契约与命名，不添加测试框架或临时fixture。
`CardDetailProvider.native` 现有内部标记表示使用独立详情context，由compact传入，
不再由OS决定；本轮不为重命名该标记扩展到所有详情消费者。
更新相关规范的当前决策，旧真机记录保留为历史，不把它们当成统一版本的新证据。

按用户明确要求，本轮不执行typecheck、focused/full测试、真机或Luna验证，也不build、安装、reload。
交付只记录源代码改动及未运行项，不声称多平台测试通过或新的性能收益。

## 5. 2026-10-24 后续授权：重载、测试与提交

用户随后要求“重载并测试。确认无问题后提交推送”，解除上一轮不验证/不重载的限制。
先typecheck，再仅重载flowly而非daemon；同三星以及宽/窄Web检查入口、开卡、
Progress/Idea开合、项目页、session预览与Back、450ms modal交接和错误日志。
真实iOS未接入时明确UNRUN，不把Web/三星替代iOS实测。
复用现有契约测试，独立full-access Luna在精确待提交树运行focused及一次全量。
共享工作树存在其他工作，提交从最新origin/main构建隔离树，纳入Overview/CardDetail等
必要性能依赖，排除不相关的Insights、版本号和模型设置；不提交整份dirty工作树。
精确树通过typecheck/npm test后推送分支、创建PR，按仓库规则完成检查及squash merge。
保留非目标字节，清理owned测试会话、临时工作树与浏览器上下文，不清共享缓存。

验证发现的计数边界：宽屏缓存的完整Board与overview同revision时，metadata可继续选择完整Board。
此时Ideas角标必须从该完整来源计数，不能因紧凑布局的项目Ideas查询尚未启动而显示0。
投影与完整来源应遵守同一项目范围、open状态规则；较新完整删除仍优先，不新增补读或缓存。
