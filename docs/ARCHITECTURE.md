# 架构

## 数据与编辑

`src/types.ts` 定义试卷、大题、题目与排版设置。`src/App.tsx` 组织工作区，编辑与批量面板更新同一份数据；`useWorkspaceUndo.ts` 提供撤销、重做和原子批量更新。

`documents.ts` 读取本地文档并校验自有项目，`paper-import.ts` 将题目/答案解析拆成预览计划，`import-application.ts` 按来源题号或身份信息匹配并应用。未匹配、重复、冲突内容不按位置静默覆盖。

Markdown 用于可读交换，`.juanye` 用于保存完整工作区。导出的题目中不包含模型服务密钥。

## 公式、绘图与分页

`math.tsx` 组合 KaTeX 与受限 Markdown 渲染；`string-lru.ts` 为整段和公式提供有界缓存。绘图由 `drawing.ts`、`TikzDrawing.tsx` 与 Electron diagram 服务处理，TeX/WASM 编译及 SVG 清理在受限边界内完成。

`components/Paper.tsx` 在固定纸张宽度下测量内容，再生成分页片段；长题使用可复用的文字、表格和图片边界。普通试卷、独立答题卡与一体卷共用基础布局，但分别控制作答空间。

`PreviewPane.tsx` 用 MotionValue 驱动预览缩放，避免每帧重渲染整卷；原生 content-visibility 仅用于屏幕预览。打印会建立独立的完整页面树，再交由 Chromium 输出 PDF，不直接截图可见预览区。

## 桌面边界

`electron/main.cjs` 负责本地数据、文件对话框、PDF 输出和服务调度；预加载层暴露有限的 IPC。渲染端不启用 Node.js 集成，开启 sandbox、contextIsolation 和 webSecurity。

模型服务配置与凭据由主进程处理。API Key 使用操作系统加密服务存储，渲染端通过受限接口请求识别，不把密钥持久化到项目数据。

## 目录

| 目录 | 内容 |
| --- | --- |
| src/ | React/TypeScript 工作区、导入与排版 |
| electron/ | 桌面主进程、模型及绘图服务 |
| tests/ | 本地合成夹具和回归测试 |
| scripts/ | 构建、打包与隔离 UI 检查 |
| public/ | 静态资源，PDF.js 资源在构建时复制 |
| .github/ | CI、Windows 打包及问题模板 |

node_modules、dist、release、artifacts、output、tmp 和真实用户数据均不进入源码版本控制。
