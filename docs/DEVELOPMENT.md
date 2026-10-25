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

UI 测试使用项目的 Playwright；如有需要，可通过 JUANYE_PLAYWRIGHT 指向其他 Playwright 模块。Electron 使用自带浏览器，不需要额外下载 Playwright 浏览器。测试窗口使用临时用户目录，必要时在屏幕外显示以避免后台节流，不接管用户的其他窗口。

自选文件验证可运行 `node scripts/import-fix-regression.cjs --actual-file 文件路径`，但该脚本的断言专用于维护期的 19 题答案样例，不是通用导入验证器；不要将个人文件提交到仓库。

性能脚本记录 React 提交、几何读取、长任务与布局开销。隐藏窗口、遮挡、DPI、系统负载及硬件都会影响数据，不能将样例的帧时间直接当作用户机器的 FPS 保证。

## 工作流

CI 在 Windows 上安装锁定依赖、运行单测并构建前端。Windows 打包工作流为手动触发，只上传构建产物；它不会自动发布 GitHub Release，也不包含签名证书或模型密钥。

修改 package.json 的版本时同步 package-lock.json、关于页与相关 UI 版本断言。发布前检查更新记录、导入兼容性、三类打印布局和安装包资源。
