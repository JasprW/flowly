# CodeRabbit follow-up — 2026-11-16

PR #115，基于bdf9804；只改daemon同步、定时回归与契约，客户端产品源码不变。

- 缺失工作区：绑定workspace不在在线列表时，原实现每次chip轮次都重新列出全部agent/workspace。现按2分钟有界复查，看板变化清延期；普通失败保留重试资格。
- 用户批准的忙时补轮：created/changed在同步忙时只记pendingChange，完成后读新绑定补一轮；失败只置dirty，不会立即自旋；stop清待处理标记。
- 定时断言：拒绝后的5秒窗口必须至少一次读取；正常订阅59999ms不读，60000ms必须校对一次。
- 红灯：用bdf9804原metadata模块执行新增回归，exit1，3失败/14跳过；缺失workspace和两个慢同步创建用例均复现失败。临时模块/配置已删除。
- 绿灯：typecheck exit0；5文件聚焦套件exit0，52通过。完整套件及新SHA独立复核随后记录。
- 回调ref意见不适用当前调用链：BoardPush唯一产品调用方传入useStableCallback与React setState dispatcher，二者身份稳定；没有会随未提交render改变的回调。未为未来假设增加layout effect，按AGENTS Scope control在审查线程说明。

普通失败重试、改绑、创建后重查和完整轮纠正回归均保留。未新增API、依赖、客户端包、界面、引导或遥测字段；手机取样保留原运行边界。

## 独立复核发现的绑定读取窗口

Luna在4d8f667末次检查拒绝放行：异步读取绑定时尚未设置running，新事件的定时回调可能在旧pass运行时被合并而丢失新绑定。已新增同时阻塞bindings和agents.list的确定性回归：修复前exit1，1失败/17跳过，实际writes为空；修复后整套聚焦53通过/0失败，typecheck exit0。readingBindings与running统一保护pendingChange，只有两阶段均结束才drain；普通失败不制造pending，原失败不自旋断言保留。

最终363073c：typecheck exit0，53聚焦通过；全量exit0，1501通过/6跳过/0失败。新的独立Luna会话对精确363073c审阅和typecheck/53聚焦后给出PASS，见LUNA-FINAL.md。

## 补轮必须保留完整清理

CodeRabbit补审确认：旧363异步读取旧绑定后可能消耗dirty，补轮得到空绑定便提前返回。新增冷/热缓存删除回归在旧363均失败（exit1，2失败/18跳过，两个Flowly session键仍存在）；drainChange启动新绑定读取前重新dirty，修复后5文件55聚焦通过、typecheck exit0，失败不自旋断言仍通过。旧报告结论时序由新的独立验收者澄清，不由实现者修改旧验证证据。

d38c8ab最终：typecheck exit0、55聚焦通过；全量1503通过/6跳过/0失败；独立Luna在精确SHA复核PASS。旧报告时序已由独立会话澄清，见LUNA-CLEANUP-FINAL.md。
