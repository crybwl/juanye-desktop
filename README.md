<img src="src/assets/juanye-icon.svg" width="88" alt="卷页图标">

# 卷页 · Juanye

本地优先的数学试卷编辑与排版工具。将题目、图片和公式整理成可编辑试卷，实时预览并导出 PDF。

基于 Electron、React 与 TypeScript，面向 Windows 10/11 x64。公式、字体、Markdown 表格及受限 TikZ 绘图随应用提供；日常编辑、预览和导出不需要安装 LaTeX。OCR 为可选功能，需要使用自己的模型服务。

## 能做什么

- **编辑与组卷**：单选、多选、填空、判断、解答、材料和自定义题型；拖动排序、大题管理、复制与跨大题移动。
- **批量操作**：统一分数、题型、来源、知识点、难度、分页和答题空间；支持撤销、重做与历史快照。
- **公式与题图**：KaTeX、公式编辑器、Markdown 表格、受限 TikZ 绘图；每题最多 8 张题图，支持右侧绕排。
- **三种文件导入**：题目文件、独立答案解析、解析版试卷；将题干、选项、答案、解析分配到对应的可编辑字段。
- **可选 OCR**：图片选择、拖放、粘贴及 PDF 逐页识别；识别后核对入卷，支持失败重试与原图重新识别。
- **排版与导出**：纸张、方向、页边距、字号、行距、题距、选项列数及图文比例；导出 PDF、Markdown、LaTeX 源码和可编辑的 `.juanye` 项目。
- **试卷与答题卡**：普通试卷、独立答题卡、试题答题一体卷；答题卡留白与普通试卷独立控制，参考答案和解析统一置于卷尾。
- **界面**：深色、淡色、Telegram 风格主题；Telegram 内另有独立深浅切换，九种配色及花纹分别保留，支持记忆偏好。外观中可选实验性题目编辑台，分组整理中央编辑区，不改变侧栏与 PDF。保留面板弹簧、页面入场、缩放与背景纹理动效，新增折页图标的单次启动动画。

## 下载与开始使用

Windows 安装包与免安装版见 [Releases](https://github.com/crybwl/juanye-desktop/releases)。安装包尚未发布时，也可以从源码构建。

1. 安装版运行 `Juanye-版本号-Setup.exe`；免安装版完整解压 ZIP 后运行 `卷页.exe`。
2. 首次启动提供示例试卷。按 `Ctrl+K`，选择“新建空白试卷”开始编辑。
3. 在命令菜单中选择相应导入方式；已有试卷只补答案时，使用“导入解析文件”。
4. 切换到排版预览，调整布局，再导出 PDF。

目前安装包未做商业代码签名，Windows 可能提示未知发布者。请仅使用你信任的源码或本仓库发布的安装包。

## 导入答案解析

| 入口 | 用途 |
| --- | --- |
| 导入题目文件 | 新建题目，拆出题干与选项，不导入答案解析 |
| 导入解析文件 | 按原题号匹配现有题目，补充答案与解析，不重复新建题目 |
| 导入解析版试卷 | 同时导入题目和解析，选择原文件的解析位于题后还是卷尾 |

支持 TXT、Markdown、DOCX、文字型 PDF 和受支持的 JSON 数据。独立解析建议包含明确题号，例如：

```markdown
## 第1题

**答案：B。方法：代入并化简。**

由已知条件可得 $f(2)=2$，故选 B。

## 第16题

【答案】$E(X)=2$
【解析】分别计算各事件的概率，再按期望公式求和。
```

已有不同内容不会静默覆盖。请核对匹配目标和选中题目，再确认允许覆盖。完整工作区备份请使用 `.juanye` 项目，而不是 Markdown。

## OCR 配置与隐私

设置 → 模型服务，填写自己的 OpenAI 兼容请求地址、模型名和 API Key。可接入兼容的 Qwen 视觉模型服务；不同服务可能有地区和模型名限制。

- 应用不提供共享密钥，不包含任何生产 API Key。
- 仅主动测试连接或运行 OCR 时，才请求配置的模型服务。
- **发送到远程模型的图片和识别指令会离开本机**，费用由你的服务账号承担；请勿上传无权分享的试卷或个人信息。
- 草稿、历史和模型配置默认保存在本机；API Key 使用 Electron safeStorage 加密，不随项目或导出文件转移。
- 本地存储位置为 `%APPDATA%\Juanye`。跨设备转移时另存项目，不要公开上传整个数据目录。
- 没有额外配置应用分析或遥测；模型服务本身的数据政策由其提供方决定。

## 开发与构建

需要 Node.js **22.13+**、npm，以及可下载 npm/Electron 依赖的网络。CI 使用 Node.js 24。

```powershell
npm ci
npm test
npm run build
npm start
```

其他命令：

```powershell
npm run dev       # 浏览器 UI 开发；桌面 IPC 功能不可用
npm run test:ui   # 隔离草稿下的本地侧栏/编辑交互回归
npm run pack      # 打包 Windows 应用目录
npm run dist      # 生成 Windows 安装包和 ZIP
```

`npm run build` 会从源码生成图标并复制 PDF.js 必要资源；不要手工提交 `dist/`、`public/pdfjs/` 或安装包。若 Electron 的安装脚本被禁用，请先运行 `node node_modules/electron/install.js`。

详细说明：[开发指南](docs/DEVELOPMENT.md) · [架构](docs/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [更新记录](CHANGELOG.md)

## 已知边界

- OCR 结果必须人工校对；不保证任意格式的试卷都能无损转换。
- DOCX 公式对象、复杂合并单元格和 PDF 的原始分栏/数学结构可能无法完整提取；扫描 PDF 请使用 OCR。
- TikZ 运行在受限的本地 WASM 环境，不支持任意 LaTeX 宏包或系统文件访问。
- PDF 导出不依赖外部 TeX；导出的 `.tex` 源码如需单独编译，要自行准备 TeX 环境，题图不会嵌入为二进制附件。
- 答题卡是可打印填写版，不承诺兼容特定机读设备。
- 当前发布与验证目标是 Windows x64；其他平台尚未正式支持。

## 性能

0.3.2 将预览缩放与整卷 React 渲染分离，使用屏外页面绘制隔离、分页几何复用及有界公式缓存，未关闭既有动效。

本地 120 题、44 页、1400 个公式和 20 个表格的同环境对比中，切预览的长任务累计耗时约从 1111ms 降至 52ms；这些是压力样例结果，不是对任意设备帧率的保证。复现方式见开发指南。

方案参考 [Motion](https://github.com/motiondivision/motion)、[TanStack Virtual](https://github.com/TanStack/virtual) 和 [WICG content-visibility](https://github.com/WICG/display-locking/blob/main/explainers/content-visibility.md)。固定纸张预览采用原生屏外渲染隔离，没有新增虚拟列表运行时依赖。

## 许可

项目自有代码采用 [MIT](LICENSE) 许可。第三方引擎、字体及依赖保留各自的许可条件，尤其是 node-tikzjax 的 LPPL-1.3c；请见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。

请仅导入、使用和分发你拥有使用权的题目、图片和文档。
