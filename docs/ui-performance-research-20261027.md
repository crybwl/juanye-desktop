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
