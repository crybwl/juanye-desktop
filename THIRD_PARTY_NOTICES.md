# 第三方许可说明

仓库根目录 MIT 许可证仅适用于本项目有权按该许可证提供的自有代码。第三方依赖、字体、引擎和其附带资源仍适用上游各自的许可，不因本项目使用 MIT 而变更。

## 主要依赖

| 组件 | 上游许可 | 用途 |
| --- | --- | --- |
| Electron | MIT；随包 Chromium/Node.js 等另有许可 | 桌面宿主与 PDF 输出 |
| React / React DOM | MIT | 编辑界面 |
| Motion | MIT | 动画 |
| KaTeX | MIT；字体及附带资源以包内说明为准 | 数学公式 |
| markdown-it | MIT | Markdown 表格及文字 |
| Mammoth | BSD-2-Clause | DOCX 提取 |
| PDF.js / pdfjs-dist | Apache-2.0；附带字体等另有说明 | PDF 文本及图像处理 |
| node-tikzjax | LPPL-1.3c；TeX/字体资源另有说明 | 本地受限 TikZ/WASM 绘图 |
| @xmldom/xmldom | MIT | SVG/XML 解析 |
| Lucide | ISC | 界面图标 |
| Inter / @fontsource-variable/inter | OFL-1.1 | 界面字体 |
| TypeScript | Apache-2.0 | 构建工具 |
| Vite / Tailwind CSS | MIT | 构建及样式 |
| Playwright | Apache-2.0 | 本地 UI 回归测试 |
| @napi-rs/canvas | MIT | 构建图标及图像测试 |
| JSZip | MIT 或 GPL-3.0-or-later 双重许可，按 MIT 使用 | 合成文档测试夹具 |

具体版本见 package-lock.json。此表是主要组件导航，不替代传递依赖的完整许可文本。

## 分发要求

- npm 安装的依赖保留各自包内 LICENSE、NOTICE 和其他上游说明。
- Windows 发行目录应保留 Electron 的 LICENSE 与 LICENSES.chromium.html 等文件，不要只分发单个 EXE。
- PDF.js 的 cMaps、标准字体和 WASM 资源由构建脚本复制，上游许可文件一并保留。
- node-tikzjax 携带的 TeX、WASM 和 BaKoMa 字体等资源不得被统一改标为 MIT；再分发时保留其许可文本和通知。若修改这些第三方文件，应按对应许可另行履行变更与分发要求。

本仓库不包含用户的私人试卷、题库授权或模型服务授权。导入内容的版权和服务使用权限需由使用者自行确认。
