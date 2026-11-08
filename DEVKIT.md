# 卷页桌面端 · 组卷与题库开发包

整理日期：2026-11-07。此包是当前桌面项目的独立源码副本，不是安装包。原工作区未修改，本包未上传。

2026-11-08：在此包内重新实现了一个独立的“教辅”编辑台（`src/workbook/`），与已移除的旧书稿编辑台无代码关系，见 CHANGELOG。

## 保留范围

- 试卷、大题和题目的编辑、排序、批量属性、撤销重做、历史及自动保存。
- 单选/多选/填空/解答等题型；题干、选项、答案、解析的独立编辑与文件导入。
- 公式编辑、KaTeX、Markdown 表格、题图和受限的离线 TikZ。
- 图片/PDF OCR、核对与重试、自配模型；AI 评析和元数据补全、解析草稿及变式。
- 独立本地题库、收藏夹、拖放、检索、版本、回收站、选题篮和备份。
- 试卷排版、答题卡、双栏、B 卷、PDF、原生公式 Word、Markdown、LaTeX、可编辑项目。
- 原有深色、浅色、Telegram 深浅外观、图案背景与动效。

## 已移除

教辅编辑台的新旧两套界面，书稿模型、章节与块节点、母版/印刷/计数器、专用分页渲染器、书稿持久化/版本、书稿项目及导出，以及对应的导航、IPC、全局类型、测试、脚本和文档。Tiptap/ProseMirror、Paged.js、PDF-LIB 已从直接依赖及锁文件中移除。（2026-11-08 的新教辅编辑台重新引入了 Tiptap/ProseMirror，Paged.js、PDF-LIB 仍未使用。）

试卷 Word 导出保留独立试卷实现，不含书稿编排和公式图片桥接。未加入好题传输入口。

不包含 Git 历史、node_modules、dist、release、缓存、模型配置、私人试卷、题库资料和 promo 脚本。图标与 PDF.js 静态资源在构建时由源码/依赖自动生成。

## 启动

目标环境：Windows 10/11 x64，推荐 Node.js 24 LTS（最低 22.13），npm。首次安装依赖需联网。

```powershell
npm ci
npm test
npm run build
npm start
```

仅 `npm run dev` 是浏览器界面开发，不提供桌面文件、模型和导出 IPC。改动桌面界面后重新 build，再 start。

若 npm 禁止 Electron 的安装脚本，运行 `node node_modules/electron/install.js` 后重试。不要复制其他平台的 node_modules。

## 本地打包

```powershell
npm run pack
npm run dist
```

输出在 release/；dist 命令已加 `--publish never`，不上传。未配置商业代码签名，Windows 可能提示未知发布者。

## 代码入口

| 部分 | 入口 |
| --- | --- |
| 应用、组卷与工作区切换 | src/App.tsx |
| 题目编辑 / 预览 / 排版 | src/components/Editor.tsx、Paper.tsx、PreviewPane.tsx、LayoutPanel.tsx |
| 本地题库 | src/components/BankWorkspace.tsx、src/question-bank.ts、electron/question-bank.cjs |
| OCR / 文件导入 | src/components/Ocr.tsx、ImportDialog.tsx、src/documents.ts、paper-import.ts |
| 公式与绘图 | src/math.tsx、drawing.ts、electron/diagram.cjs |
| 桌面接口 / 持久化 | electron/main.cjs、preload.cjs、src/desktop.d.ts、src/storage.ts |
| 模型 / AI 评析 | electron/model.cjs、model-store.cjs、exam-ai.cjs、src/exam-ai.ts |
| Word 导出 | electron/docx-export.cjs |
| 外观和动效 | src/appearance.ts、SceneBackdrop.tsx、scene-patterns.ts、components/Settings.tsx |
| 教辅编辑台 | src/workbook/（WorkbookWorkspace、Canvas、RichField、Overlays、pagination）；回归：scripts/workbook-regression.cjs |

## 数据与开发安全

默认本地资料目录仍为 `%APPDATA%\Juanye`，便于兼容原组卷资料。同机开发前请先导出项目及题库备份。现有 UI 验证脚本通过 `JUANYE_TEST_USER_DATA` 指定临时隔离资料目录，不覆盖真实数据；该变量是自动化专用，窗口默认不自动显示。普通开发使用上方的 `npm start`。

模型密钥由使用者在设置中填写，采用系统凭据加密；不能随 ZIP 或项目交接。不要使用真实收费模型做开发测试。

## 本包验证记录

在独立副本中执行了 `npm ci`、`npm test`、`npm run build`。单测共 263 项通过，1 项真实系统凭据测试按默认条件跳过；TypeScript 检查和 Vite 构建成功。已检查源码及依赖锁文件，不包含书稿编辑器、专用渲染入口、IPC 或专用依赖。未调用真实模型服务，未运行冒烟脚本，不提供 SHA256 清单。

许可见 LICENSE 与 THIRD_PARTY_NOTICES.md。
