# 2026-10-27 开源参考与实施边界

按用户要求，编辑代码前先搜索并阅读高 star 项目的官方实现。页面显示的 star 为本次检索的近似值，不作为代码正确性的保证。

| 项目 | Star 约数 | 本次借鉴 |
| --- | --- | --- |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | 134.6k | [LayerUI 的组件隔离](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/LayerUI.tsx)、上下文工具与留白；不引入白板或复制整套界面。 |
| [Motion](https://github.com/motiondivision/motion) | 34.6k | [官方性能审计](https://github.com/motiondivision/motion/blob/main/plans/PERFORMANCE_AUDIT.md)明确区分原生 transform 动画与逐帧 JS 样式写入；保持进入/退出、弹簧、收藏、飞入、排序动效，优先移走主线程工作。 |
| [TanStack Virtual](https://github.com/TanStack/virtual) | 7.2k | [virtual-core 缓存、惰性测量与有界可见集合](https://github.com/TanStack/virtual/blob/main/packages/virtual-core/src/index.ts)。现有题库每页25题已有限界，不为名义虚拟化另加运行时依赖。 |
| [React](https://github.com/facebook/react) | 252k | 官方 [memo](https://react.dev/reference/react/memo)、[useDeferredValue](https://react.dev/reference/react/useDeferredValue)，结构共享和稳定回调；只延后屏幕预览，保存、撤销、项目和打印使用最新题目。 |
| [Radix Primitives](https://github.com/radix-ui/primitives) | 高 star 组件库 | 焦点、键盘、触屏与悬停行为的可访问性边界，不依赖透明按钮碰运气。 |

## 针对实际界面的取舍

- 独立大号“本地题库”和标题栏重复字样移除；主导航保留一个题库入口。“全部题目”标签与次要操作在悬停/聚焦时展开，保留可访问名称和触屏直接操作。
- 累计使用及题型分布降为侧栏底部弱提示，位于收藏入口上方，不占顶端大色块。
- Telegram 从各面板重复同一SVG改为一张有疏密变化的连续场景；仅在切换配色时解码缓存，正常帧只移动一个合成层。弹窗每个根面板共享缓存纹理，内部不再重新盖章。正文、题图、白纸与导出不受影响。
- 编辑器、预览和题卡使用有意义的稳定边界，减少无关状态更新；搜索、派生统计与命令内容不在无关输入时反复全量生成。
- 不因性能数据删除动效、降低题目完整度、覆盖本地编辑或更换导出实现；测量使用相同的合成题库与试卷，不读取私人资料或调用真实模型。

验证结果应以 `artifacts/qa-chrome-performance/` 中同一脚本、同一窗口/题量的前后报告为准，不能把离屏测试的帧时间写成真实显示器帧率承诺。

## beta.7：窄栏与后台任务参考

本轮编辑前重新检索并阅读 [shadcn/ui](https://github.com/shadcn-ui/ui)（约126.7k star，MIT）的[侧栏源码](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx)，以及 [TanStack Query](https://github.com/TanStack/query)（约50.5k star，MIT）的[mutationObserver](https://github.com/TanStack/query/blob/main/packages/query-core/src/mutationObserver.ts)与任务状态实现。借鉴图标栏/展开内容分层和观察者与任务生命周期分离，不安装整套依赖，也不复制整套样式。

- 左栏收窄后由浮层展开，给列表实际腾出空间，避免仅把文字藏掉但继续保留宽栏；键盘与触屏有可用入口。
- 详情不把只读预览伪装成编辑器，明确进入完整题干/选项/答案/解析编辑台，并保留版本、保存及取消语义。
- 后台模式仅在用户选择并确认预算后启动，UI关闭不等于任务取消；任务与面板分离，避免隐藏面板每次输入还计算整卷分析。实验功能不自动发送或收费重试，结果仍受快照过期保护。

## 2026-10-28 / beta.8：深度性能、评析预算与原生拖放

编辑前重新检索官方项目：Motion性能审计、TanStack Virtual（约7.2k）、React Hook Form（约44.9k）、dnd-kit（约17.8k），并阅读原生矢量绘制方向的Paper.js（约15k，MIT）。Star仅筛选，不代替运行时证据。本轮不引入这些依赖，也不复制其整套实现。

- Motion的[审计](https://github.com/motiondivision/motion/blob/main/plans/PERFORMANCE_AUDIT.md)与[React Hook Form](https://github.com/react-hook-form/react-hook-form)的局部订阅思路，用于排查主线程和无关重渲染；[TanStack Virtual](https://github.com/TanStack/virtual)的有界测量/缓存思路用于分页几何，不拿删除题目或关闭动效冒充优化。
- beta.7真实CPU采样发现Motion投影的滚动/布局测量热点；预览外还常驻一整份分页测量DOM。决定在资源就绪后回收重复测量树，只为变化块重新挂载测量，保留完整可见页面与打印树；等待图片/字体/TikZ并做精确分页前后对照。
- 超过8页的屏幕预览只挂载视口附近页及当前选中题所在页，保留所有页位的尺寸、入场/缩放弹簧和可访问页号；跳到末题必须验证真实内容挂载，打印入口仍独立渲染全卷。目录使用稳定题目ID与局部订阅，避免每次题干输入让整个Reorder组重建布局上下文。
- 快速切题回归复现了Motion的`AnimatePresence mode="wait"`待显示子树落后于当前选择的问题；阅读当前锁定版本的`AnimatePresence`/`PresenceChild`源码后改为可重入的出入场组合。保留原有淡入、位移和模糊变体，退出内容禁止交互，不修改node_modules或以关闭动效解决同步问题。
- 实际1440×900窗口的适宽验收捕获了滚动条反馈环：clientWidth在507/517之间、clientHeight在746/756之间交替，纸张持续缩放。为预览固定滚动条占位，适宽预留2 CSS像素吸收Windows分数DPI舍入，仍允许放大后的水平滚动。失败采样保留在`artifacts/qa-v012/sidebar-resize-loop-before-beta8.json`，不放宽布局稳定断言。
- 首尾跳题使用真实题目与可视区相交作为双向断言，发现离屏`content-visibility:auto`的首次题目坐标为0；仅对选中题所在页恢复布局，其他页仍按需渲染。自动滚动继续保留平滑过渡，不靠每帧遍历全部页面或移除离屏优化解决。
- [dnd-kit](https://github.com/clauderic/dnd-kit)的目标反馈、声明动作与键盘替代原则：收藏夹拖放复用已有原生DataTransfer协议和原子追加关联；不改变题干、不制造修订、不移除已有收藏夹。保留现有批量下拉作为不使用鼠标拖动时的替代。
- [Paper.js](https://github.com/paperjs/paper.js)的路径组合启发六套原创原生矢量纹理，不使用外部图床；大小/密度与色盘独立，仍为一个合成背景层和有界缓存，不在每帧生成图像。
- 模型限制以阿里官方文档核对：[Qwen3-Max](https://help.aliyun.com/zh/model-studio/model-qwen3-max)、[Qwen3.5-Plus](https://www.alibabacloud.com/help/en/model-studio/qwen3-5-plus)。输出上限不能由兼容接口统一推断；评析允许用户按模型配置，OCR维持独立8192限制，不自动改模型或收费重试。
- 后续完整题库的规划另参考[Moodle题库](https://docs.moodle.org/503/en/Question_bank)、[Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/usage.md)和[Anki导入去重](https://github.com/ankitects/anki/blob/main/docs-site/manual/importing/text-files.mdx)的分类、版本、审核、检索、批量与可逆导入思路；规划不等于本轮已全部实现。

## 2026-10-28 / beta.9：评估结果写回与手改保护

本轮编辑前重新检索高star的[TanStack Query](https://github.com/TanStack/query)与[React Hook Form](https://github.com/react-hook-form/react-hook-form)，阅读官方[结果不可变写回](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/updates-from-mutation-responses.md)、[keepDirtyValues](https://react-hook-form.com/docs/useform/reset)及MIT许可证。借鉴完成结果同步到真实数据源、按字段保留已有输入的原则，不安装新依赖、不复制整套代码或改界面设计。

- 原问题不是表格不刷新，而是AI报告与真实题目属性之间缺少自动采用：在工作区会话完成时写回空缺知识点/难度，有效旧报告可在打开分析时补全，后台不依赖弹窗生命周期。
- 先比对原快照，Reducer写入前再比对当前指纹；只允许准确采用本报告的标签差异，不把所有知识点/难度变化一概忽略。原题、答案、顺序、来源或非建议标签变化仍使报告过期。
- 自动采用记录与弹窗分离，同一报告处理一次，可撤销且重开不填回。处理记录在草稿保存成功后才持久化；保存开始时捕获序号，旧保存完成不得提前消耗之后的采用记录。使用有界200项记录，不更改题库/项目/报告协议。
