# 教师工作流验证与回退

本批功能位于 `feat/teacher-workflows-v035`，版本为 `0.4.0-beta.1`。旧版基线是 `rollback/v0.3.4-20261026`，提交 `b4f41b5`。本次没有推送远程仓库或发布 GitHub Release。

## 需求与验证范围

| 功能 | 实现与实际检查 |
| --- | --- |
| 本地题库 | 独立 JSON 原子持久化、重复幂等、修改后版本关联；当前题/整卷保存；四类筛选与搜索；不同试卷批量加入及 ID 拖拽；新题/图 ID、答案解析与图片保留；删除确认与备份恢复。纯逻辑和真实桌面 UI 回归。 |
| A3/8K 双栏与密封线 | 分别为 420×297、390×270 mm 横版，按列测量后组成物理页；左密封区独立预留；题前分页为物理分页；答题卡 17–19 题独立整页。实际 PDF 分别 4/6 页，Poppler 全页渲染并核对页数、尺寸及密封区绘制像素。 |
| Word 导出 | 真 OOXML 正文、表格、选项、卷尾答案解析与速对；每份样卷 45 个原生 OMML 公式；题图/TikZ 嵌入 PNG。实际 IPC 导出后，用独立 LibreOffice 26.2.6 渲染 A4 3 页、A3 2 页、8K 2 页，所有页已检查。修复竖线/平行符号斜体与密封栏换行；密封栏为静态高分辨率模板，数学不栅格化。 |
| 分析与细目表 | 题型、难度、知识点的分值及比例，知识点×题型矩阵与逐题细目；多知识点分值均分；空字段和零总分有处理。实际 CSV 导出保留 UTF-8 BOM，并防止来源等文本成为 Excel 公式。 |
| B 卷 | 选项排列与答案映射联动，答题卡读取同一份新数据；不改变原题内容及分值；含顺序依赖的选项保持原序并报告。生成前持久化原卷历史，单步撤销恢复。 |
| 截图粘贴 | 工作区、题干框中的纯截图 Ctrl+V 自动识别，核对后才加入；纯文字/混合文字不被抢占，专用题图区域仍附图。真实 UI 合成剪贴板回归，模型请求使用隔离替身。 |
| 变式与解析 | 保存的模型配置、8192 输出上限、取消及超时、密钥遮盖；草稿绑定原题完整快照，换题/任务或取消后不接纳迟到结果。变式新 ID，解析只更新解析与待核对标记，不覆盖答案；单选多答案、空/重复选项明确拒绝。实际核对/确认/取消 UI 回归。 |

常规入口位于左上角功能菜单（`Ctrl+K`）。A3/8K 在排版设置选择印卷预设。没有为测试调用用户的真实 OCR 或生成服务，也未读取用户私人试卷。

## 可复现检查

- `npm test`
- `npm run build`
- `node scripts/question-bank-regression.cjs --packaged`
- `node scripts/teacher-workflow-regression.cjs --packaged`
- `node scripts/paper-columns-regression.cjs --packaged`
- `node scripts/word-export-regression.cjs --packaged`
- `node scripts/experimental-workbench-regression.cjs --packaged`
- `node scripts/sidebar-regression.cjs --no-screenshots`
- `node scripts/verify-release.cjs`（同时比较前端资源与 Electron 后端模块）

视觉检查是额外门槛，不能用结构检查替代：

- PDF：实际导出后用 Poppler 渲染全页，再运行 `scripts/audit-paper-columns-pdf.py`。
- Word：`word-export-regression.cjs --keep` 保留三份样卷，再用 documents 技能的 `render_docx.py` 生成所有页面。`scripts/audit-word-render.py --suffix=-final` 校验实际尺寸、原生公式、页面时效与跨页密封栏像素一致性；仍须人工看每一页。
- 用户授权下载的验证工具仅纯解包在项目 `tmp/word-renderer`，没有系统安装、注册 COM 或修改文件关联，也不随应用发行。

教师工作流回归曾出现一次合成图片粘贴等待超时，之后保持原断言连续五次通过，未重现。根因未作无证据结论；脚本已保留失败事件链、草稿、图片状态和计数诊断，便于后续定位。

## 回退保护

1. 0.3.4 安装包与免安装 ZIP 保留，代码基线标签不变；本批功能提交单独记录，不需要硬重置工作树。
2. 新版第一次保存现有草稿前，在同一个写入队列中创建不覆盖的 `draft.pre-0.4.0.json`。普通保存仍保留上一份 `draft.backup.json`。
3. 新纸型旧版不认识，回旧程序时不能直接拿 A3/8K 草稿给旧版打开。先关闭软件，备份当前 `draft.json` 和题库，再用升级前备份恢复旧草稿；不要删除新草稿或题库。
4. 题库使用独立 `question-bank.json` 及备份，恢复程序版本不要求删除题库。用户原题只在明确确认导入、生成或恢复后更改；操作仍可撤销或从历史恢复。

当前版本为测试版，不承诺不同 Word 版本逐像素一致。公式未知命令或不支持的结构会明确报错，不静默用截图替换或丢弃。
