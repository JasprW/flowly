# CodeRabbit follow-up — 2026-11-16

PR #115，基于bdf9804；只改daemon同步、定时回归与契约，客户端产品源码不变。

- 缺失工作区：绑定workspace不在在线列表时，原实现每次chip轮次都重新列出全部agent/workspace。现按2分钟有界复查，看板变化清延期；普通失败保留重试资格。
- 用户批准的忙时补轮：created/changed在同步忙时只记pendingChange，完成后读新绑定补一轮；失败只置dirty，不会立即自旋；stop清待处理标记。
- 定时断言：拒绝后的5秒窗口必须至少一次读取；正常订阅59999ms不读，60000ms必须校对一次。
- 红灯：用bdf9804原metadata模块执行新增回归，exit1，3失败/14跳过；缺失workspace和两个慢同步创建用例均复现失败。临时模块/配置已删除。
- 绿灯：typecheck exit0；5文件聚焦套件exit0，52通过。完整套件及新SHA独立复核随后记录。
- 回调ref意见不适用当前调用链：BoardPush唯一产品调用方传入useStableCallback与React setState dispatcher，二者身份稳定；没有会随未提交render改变的回调。未为未来假设增加layout effect，按AGENTS Scope control在审查线程说明。

普通失败重试、改绑、创建后重查和完整轮纠正回归均保留。未新增API、依赖、客户端包、界面、引导或遥测字段；手机取样保留原运行边界。
