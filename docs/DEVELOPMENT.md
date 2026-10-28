# 开发与验证

## 环境

正式目标是 Windows 10/11 x64，Node.js 22.13+ 和 npm；CI 使用 Node.js 24。首次安装依赖需要网络，Electron 会下载对应平台的运行时。

```powershell
npm ci
npm test
npm run build
npm start
```

如果包管理器禁用了安装脚本，允许 Electron 安装脚本后重试，或运行 `node node_modules/electron/install.js`。图标构建依赖 @napi-rs/canvas 的本机模块，请不要将其他操作系统的 node_modules 直接复制过来。

## 常用流程

`npm run dev` 提供浏览器 UI 开发，但没有桌面 IPC、密钥存储和原生 PDF 导出。使用 `npm run build` 后再 `npm start` 检查完整桌面流程。

`npm run pack` 生成 release/win-unpacked；`npm run dist` 生成 Windows 安装版和免安装 ZIP。安装包未配置商业签名，Windows 可能提示未知发布者。

## 测试

- `npm test`：文本解析、导入匹配、公式、分页几何、缓存和 Electron 服务单测；不调用真实模型服务。
- `npm run test:ui`：侧栏展开、目标大题、编辑、拖动和布局回归。
- `node scripts/import-fix-regression.cjs`：合成 DOCX、GBK、UTF-16 的实际导入与字段编辑回归。
- `node scripts/import-workflow-regression.cjs --imports-only`：三种导入及 Markdown 导出。
- `node scripts/performance-regression.cjs --label=local`：120 题、44 页量级的压力样例（实际页数受布局影响）；动效保持开启。
- `node scripts/verify-release.cjs`：打包后比较 asar 中的版本和入口资源与本地 dist 是否一致。
- `node scripts/bank-workspace-regression.cjs [--packaged]`：独立题库全流程，临时用户目录，禁止 HTTP；从完整编辑到题集、版本、回收站、选题篮和新卷。
- `node scripts/library-ai-regression.cjs [--packaged]`：题库外观/窗口宽度、来源对照、整卷 AI 真实 IPC 与本机模型替身；发送确认、缓存、取消、元数据采用/撤销、报告失效及实际 Word 导出，不使用真实密钥。
- `node scripts/beta7-regression.cjs [--packaged]`：60px窄栏/220px悬停浮层、原宽栏区域不抢点击、列表不重排；后台分析确认前零请求、请求时仅左下角转圈、编辑/切换/重新查看不重复请求、完成报告过期保护、后台明确取消与普通关闭取消、服务错误脱敏且不自动重试。手动释放本机模型替身响应，不使用真实密钥或付费模型。
- `node scripts/ai-metadata-regression.cjs [--packaged]`：AI完成后逐字段补全空缺知识点/难度，前台/后台/有效历史报告一致；实际细目、矩阵、CSV与草稿同步，手改/过期保护、撤销及重启不重复填回，不使用真实密钥。
- `node scripts/scene-patterns-regression.cjs [--packaged]`：六套背景在深浅色下的实际已解码图片、大小/密度、偏好持久化、单层漂移、减弱动效与白纸隔离；不调用模型或网络。
- `node scripts/collection-drop-regression.cjs [--packaged]`：真实 Chromium 原生单题/多选拖入收藏夹、嵌套目标、重复加入、无效载荷及重启持久化；验证题目版本、使用次数和卷内快照不变。
- `node scripts/editor-selection-regression.cjs [--packaged]`：120题快速往返、末题/首题跳转、进入动画中输入和退出失焦；检查新旧内容都有动画中间态，旧编辑台不可交互且不串写其他题目。
- `node scripts/paper-measurement-regression.cjs --label=local --baseline=beta7-exact-reference`：同一合成题卷核对逐页题号、文本、续页切割、长表格、TikZ、双栏及答题卡；参考报告需先保存在 `artifacts/qa-paper-measurements/`。打印入口检查包含最后输入及全部题目，不冒充实际PDF写盘。
- `node scripts/ui-overhaul-regression.cjs [--packaged]`：当前用户补丁的界面与真实动效验收；悬停/真实Tab聚焦/粗指针触屏模式、无框底部统计入口、列表/卡片偏好、题型计数、飞入选题篮、收藏粒子、原生拖放、小数分值、图片键盘操作、编辑分组、20套实际外观及1000/1280/1500px窗口边界，不调用模型或HTTP。报告及截图位于 `artifacts/qa-ui-overhaul/`。
- `node scripts/integrated-surfaces-regression.cjs [--packaged]`：统一按钮与Telegram背景巡检；通过设置界面切换20种外观，检查单一连续背景、缓存PNG纹理、面板不重复铺图、弹窗根面板纹理、主按钮普通/悬停可读性、次要按钮边框与阴影，遍历设置/编辑/公式/OCR/导入/分析/导出/历史/题库，验证白纸与打印不受影响；不执行模型。报告及截图位于 `artifacts/qa-integrated-surfaces/`。
- `node scripts/chrome-performance-regression.cjs --label=local --baseline=beta5 --latest-export`：同一500道题库、120道试卷样例，记录四种外观的输入、选择、侧栏、工作区、检索与弹窗共64个样本；区分首帧等待、后续帧分位、脚本/布局/样式耗时和长任务。最新输入的打印DOM、项目与草稿另作正确性验证；原生保存对话框与PDF写盘由替身拦截，不应称为实际PDF文件验收。
- `node scripts/chrome-performance-regression.cjs --label=local-navigation --baseline=beta5 --appearances=telegram-dark --quick-navigation --latest-export --assert-parking`：短工作区回归，额外检查退出后暂停布局、重新进入与快速切换。只比较匹配的工作区样本；短流程与完整流程的前置操作不同，不混成一次完整64样本结果。
- `node scripts/ui-polish-regression.cjs [--packaged]`：保留 beta.3 的历史表现层验收（宽编辑区、折叠筛选等）；这些布局已被用户指定的新补丁替换，当前界面以 ui-overhaul 验收为准。

UI 测试使用项目的 Playwright；如有需要，可通过 JUANYE_PLAYWRIGHT 指向其他 Playwright 模块。Electron 使用自带浏览器，不需要额外下载 Playwright 浏览器。测试窗口使用临时用户目录，必要时在屏幕外显示以避免后台节流，不接管用户的其他窗口。

自选文件验证可运行 `node scripts/import-fix-regression.cjs --actual-file 文件路径`，但该脚本的断言专用于维护期的 19 题答案样例，不是通用导入验证器；不要将个人文件提交到仓库。

性能脚本记录 React 提交、几何读取、长任务与布局开销。隐藏窗口、遮挡、DPI、系统负载及硬件都会影响数据，不能将样例的帧时间直接当作用户机器的 FPS 保证。

## 工作流

CI 在 Windows 上安装锁定依赖、运行单测并构建前端。Windows 打包工作流为手动触发，默认仅上传构建产物，不包含签名证书或模型密钥。

发布时先将版本提交打为 `v版本号` 标签，再在 Windows packages 工作流填写该标签并勾选 `publish_release`。工作流从标签构建，核对版本及打包资源，生成 SHA-256 校验文件；在草稿 Release 上传安装包和 ZIP，全部成功后才转为公开。已公开的同名 Release 不会被覆盖。发布说明放在 `docs/releases/v版本号.md`。

修改 package.json 的版本时同步 package-lock.json 及相关 UI 版本断言；关于页直接读取 package.json。发布前检查更新记录、导入兼容性、三类打印布局和安装包资源。
