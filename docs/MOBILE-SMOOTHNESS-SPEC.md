# 动画流畅度：有限对照与最小修复

2026-10-24，用户要求以实际流畅度开始新一轮优化。延续
[宽度统一](RESPONSIVE-PERFORMANCE-SPEC.md)和[连续高度](MOBILE-DISCLOSURE-SPEC.md)，
不以打开更早、功能完成或单测通过代替动画验收。

## 1. 范围与不变量

同一三星SM-S911B、正式Paseo0.12.0、原连接、接电常亮、系统动画倍率不变。
选择现有本卡的Progress内容与区段开合、非空Idea内容，附带开卡/session preview/Back。
不创建业务资源、不发送消息、不修改任务正文；fixture仍为现有本卡/Tinylink。
保留fresh task/workspace/exact session授权、独立Overview/CardDetail、描述搜索、实时Attention、
220/160ms可反转连续高度、输入/滚动身份、Reduce Motion和450ms modal交接。
所有性能行为继续按可用宽度统一，不增加平台分支、依赖、缓存、设置或框架。

## 2. 先归因

当前HEAD e0c693d新增运行态点阵扫光（RunningDots/useMarquee）。已存在高度动画lease
只暂停PulseDot；新loop未使用该lease，且紧凑看板被详情覆盖时仍保留树。
这是源码事实，不是已证实的真机因果。优先在冻结副本只关闭点阵循环/层做counter-control，
比较开合与idle。若无一致收益，再仅对照drawer clipping或追加挂载时机；不同时改变两项。
已有解密/React/原生绘制共享线程边界保留，不从gfxinfo或整窗线程CPU推断JS函数因果。

## 3. 采样与版本

先保存root源码hash/HEAD/dirty、入口原字节、设备状态；复制入口/client/server/shared与构建配置
为本轮baseline，复用root node_modules，禁止复制依赖/创建缓存。源变更后单独candidate。
宿主模块白名单要求运行副本位于client/server下：使用本轮owned `.perf-smooth-f4e2dd52`
子目录，文件与冻结清单逐项匹配；docs中的证据副本不能直接作为宿主import路径。
只在原入口仍匹配本轮持有字节时临时桥接冻结副本；别的会话修改入口则停用桥接，不能覆盖。
结束恢复入口原字节，最终产品只应用经过验收的最小hunk，其他dirty文件逐项hash保留。
typecheck在每个改变的安装输入reload前通过。只reload flowly，不重启daemon或替换app。

诊断仅在冻结副本：注册bounded read-only runtime receipt，contribute只安排一次4s后回执，
不立即联网；cleanup取消timer，失败忽略，不影响业务结果。回执含variant/build/run/platform，
不含正文/凭据；catalog hash与运行回执关联，在warm采样前确认并静默，禁止逐帧网络/日志。

复用Artemis的uiautomator2环境。每次fresh找可见目标，记录allowlist标签/边界与结果谓词，
禁止保存原始hierarchy正文或宿主私有侧栏。量测前读屏，随后quiet，再reset gfxinfo、输入动作、
等待约550ms，先读framestats，最后才做终态读屏；实际控制窗口时长必须保留。
Flags=0且FrameCompleted>IntendedVsync的帧用于分布；空帧、ring溢出、目标离屏/错误起点、
终态未证实标INVALID/UNVERIFIED，不把零帧当提速。UIA完成上界不作为触摸/paint时间。

最多3组Progress内容、3组Progress区段、2组Idea内容，每组开/关；baseline与candidate同路径。
每条件2个idle窗口；必要reverse控制只选最明显路径，初轮目标不超过42窗口。
必要时只给idle/问题路径取3s Perfetto sched/gfx/view trace，工具归属清楚，避免取证覆盖整套动作。
报告每路径样本/有效帧、p50/p95/max及长帧数，保留原始样本；不把idle占比或少数max当FPS。
先看实际动作段，再看尾部工作；有界视频仅在用户/截图规则允许且隐私受控时使用。

## 4. 最小候选的准入

若点阵控制支持绘制争用，只复用既有高度lease或已有可见性context，暂歇装饰循环，
几何稳定后恢复原有点阵/呼吸效果。避免因暂停而卸载/重建全部点阵；禁止去掉连续高度、
缩短时长掩盖停顿或全局LayoutAnimation。若收益来自减少不可见点阵，限定在真正覆盖时。
未出现点阵的路径不可用该控制解释；clipping/挂载假设需各自对照，不能顺便重写列表。
候选必须改善所定位路径且没有内容丢失、复挂长帧或导航退化；混合/不足则保留结论并撤回候选。

## 5. 验收、失败与清理

先必要focused，再稳定full-access codex/gpt-6-luna独立验收。Luna只写本目录luna-*证据，
不操作设备/实现/daemon，手机采样时不让新验证会话混入running列表；父方负责精确清理。
可复用现有renderer，临时prefix限本证据目录，shared npm cache保留，finally清理临时renderer。
若使用lease，mounted覆盖重叠/反转/旧回调/结束/取消/unmount、Reduce Motion、宽窄一致，
暂停不改变正文身份、点阵节点不因暂停重建；恢复重新开始一圈扫光，沿用原有外观/周期。
共享loop的最后一名使用者真正退出时清零，并清理高度lease订阅。

独立mounted的v1反例：同一同步反转中，旧lease释放到新lease持有的间隙会额外启动再停止扫光。
v2只把恢复放到一次microtask末尾，再复查既有users/busy/loop；暂停仍立即生效，不新增timer或状态。
保留该失败断言和日志。Luna完成v2验收并清理会话后，再补最多4个冻结v2手机窗口，避免额外session网格混入。
这4窗的raw独立Luna审计若未做则明确UNRUN，父复算不冒充独立审计。

检查命令：`npm run typecheck`；`node docs/verification/mobile-smoothness-2026-10-24/luna-run-mounted.mjs`
（若候选涉及生命周期）；`npx vitest run --exclude 'docs/verification/**' client/running-geometry.test.ts client/query-activity.test.ts client/card-detail-query.test.ts client/session-link-query.test.ts`；
稳定候选必要一次`npm test`；`python3 docs/verification/mobile-smoothness-2026-10-24/analyze.py`；
手机采样入口`docs/verification/artemis-2026-10-22/runtime/artemis/.venv/bin/python docs/verification/mobile-smoothness-2026-10-24/phone.py`。

失败、工具错误、未执行和通过分开保留。真实iOS、IME、系统Reduce Motion和函数级profile未测时
保持UNRUN；不把合成renderer代替视觉连续性。保持边界及现有功能，无新tour/tip/What's new。
输出README、源码/运行身份、原始gfx/可选trace、对照分析及cleanup回执；所有owned临时副本/工具/
验证agent清理，持久证据留本地docs/verification。用户后续已授权只提交本修复与对应规范，
在最新origin/main的隔离树验收后走PR评审合并；不带入其他会话资源或改动。

## 6. 执行结果与边界

2026-10-24三星固定源码共41个窗口：37个起终态/窗口有效，1个布局漂移观察、2个未证实、
1个窗口过长无效。有效不等于性能达标；窗口包括idle尾部，不代表精确触摸延迟或逐动画FPS。

| 正文开合 | 原baseline两次最长帧 | 最终v2两次最长帧 |
|---|---|---|
| 展开 | 42.43 / 31.87ms | 59.07 / 25.15ms |
| 收起 | 39.28 / 39.62ms | 26.13 / 28.21ms |

反向baseline收起为34.80/26.33ms，与候选有重叠，因此仅支持局部减轻绘制争用。
展开没有稳定改善，区段收起约40–48ms仍在；Idea的125ms窗口起终态未证实，不算成功对照。
v1同步trace首个捕获vsync后500ms RenderThread on-CPU为baseline323.41ms、静止点阵253.09ms、
候选274.29ms；JS仍有长运行。非JS函数/React子树/GPU独占归因，不据此重写高度或列表。

前轮共享dirty树的独立full-access Luna验收：v2 mounted8项、root focused22项、全量1024项PASS，
374源hash稳定；反转零额外loop启动断言保留。旧140 captures/37窗独立审计通过，最终161 captures/
41窗由父方复算，新增4窗独立审计UNRUN。真实iOS/IME、系统Reduce Motion、像素连续性、FPS和函数归因UNRUN。
本次发运在最新main隔离树另跑typecheck及全量，不拿共享dirty树的测试数冒充发运验证。

本规范上面的设备runner、renderer、trace及分析命令记录一次性本地验收方法；脚本和原始设备数据
保存在本地取证目录，不作为随仓库分发的工具或可下载附件。仓库常规检查为`npm run typecheck`、`npm test`。

## 7. 用户反馈修正：宽屏保留共享动画连续性

用户实测连续点开多张卡时，运行态点阵反复从头播放。原因是任意高度lease都会停止全局共享loop，
允许恢复后显式phase0；这是当前策略的可见代价，不是精确暂停续播。既有三星有限样本只支持局部
正文收起最长帧约39ms→26–28ms，展开不稳定；没有宽屏A/B或整体FPS收益证据，不能为此牺牲宽屏连续性。
本节取代前文“所有宽度一律让路”，历史设备数据及其边界保留。

共享装饰时钟是当前宿主窗口级资源：按React Native Dimensions提供的窗口逻辑宽度，复用
isCompactLayout的760分界，不按单张卡片/窄抽屉的宽度判断。窗口宽度未知按0视作紧凑；
看板/菜单/直达详情原有的容器布局判断不变。不按Android/iOS/Web或桌面身份分叉。

- 窗宽>=760：高度动作不暂停点阵或呼吸点。保留同一个运行中的loop和phase，连续开卡、关闭、
  反转及高度lease通知不stop/start或归零；新增点阵消费者共享现有时钟。最后一个消费者真正退出仍清理/归零。
- 窗宽<760：保留当前高度优先、重叠/反转microtask检查、暂停不卸载网格、结束后phase0新一圈。
  本轮不引入native相位回读、剩余时长补播或第二套时钟。
- 复用现有高度状态监听，只在有消费者时维持一个窗口尺寸订阅，最后一个订阅者退出时移除。
  改变窗口宽度立即重算busy；宽→宽或无高度动画的resize不能重启loop；窄→宽仅从暂停恢复一次，
  后续旧lease释放不能再重启。resize不打断高度动画本身。
- Reduce Motion、220/160ms连续高度、fresh归属、450ms交接、正文/输入/滚动身份不变。
  不新增RPC、网络、依赖、缓存、设置、timer、逐帧回调或动画框架；无tour/tip/What's new。

实现只改motion.tsx并同步既有规范。先typecheck，再full-access codex/gpt-6-luna mounted覆盖
760边界、宽屏多次导航/高度动作零额外启停/归零、resize中lease、紧凑反转、Reduce Motion及订阅清理；
必要focused包含geometry/running-geometry/query-activity/card-detail-query/session-link-query。
命令及前后source hashes记录在verification/marquee-width-2026-10-24。
只reload flowly，不重启daemon，不创建业务资源；若无法明确绑定非fullscreen窗口，真实UI保持UNRUN。
不拿mock的loop计数证明像素连续性或FPS。没有新的手机性能预算，不重复无关全量/平台矩阵。用户随后明确要求停止补测并合入：保留已完成结果，停止新增本地验证，只按仓库PR流程选择性发运本修复和规范，不带入其他会话改动。
