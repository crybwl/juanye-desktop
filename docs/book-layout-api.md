# 教辅版式 v2 · P0 接口与验收

分栏与选项排列已接入数据模型、主进程存储、离线预览和 PDF 分页。下面保留字段协议与验收清单，作为界面/后端联调依据。作答区、样式表与计数器的数据及编辑器命令也已实现，操作面板仍需另行接入。

## 当前后端入口

- `src/book-blocks.ts`：作答区、块样式、计数器类型及默认值。
- `src/book-layout-actions.ts`：`setBookBlockStyle`、`removeBookBlockStyle`、`setBookQuestionAnswerAreas`。纯事务返回新书稿，先完整校验；不直接覆盖题库、试卷或历史。删除被引用的样式必须显式指定替代项；批量作答区可重复应用，不叠加重复节点。
- `src/components/BookBlockNodes.ts`：Tiptap 命令 `insertBookAnswerArea(attrs)`、`setBookAnswerAreas(attrs, 'selection' | 'chapter')`、`insertStyledBookBlock(styleId)`；作答区节点使用完整默认属性。无新增的大型操作面板。
- `BookProject.styles?: BookBlockStyle[]`：省略时使用内置样式。新块只需 `styleId`；旧 `kind` 块继续兼容原排版。样式字段只能是受限颜色、图标枚举和数字，不接受 CSS/HTML/SVG 字符串。
- `answerArea.attrs`：`kind: blank | lines | grid | coordinate`，`unit: lines | mm`，`size`，`lineHeight`（mm），`gridSize`（mm）。行数乘行高得到物理高度；格线为本机生成的矢量背景。超过整页的原子作答区拒绝导出，不静默裁掉。
- 样式 `counter: { format, reset, start }`：格式支持 `{章}`、`{节}`、`{n}`；每个样式独立计数。节边界定义为一级/二级正文标题，章由 `kind: chapter` 计数；前言/封面不占章号。章节预览也先按全书顺序计算，避免局部预览重置全书计数。
- `upgradeBookLayoutVersion(book)`：编辑事务使用新增能力时升级 v2；严格导入仍拒绝将新节点伪装成 v1。旧 v1 项目继续加载，缺失的全书选项默认补为 auto。
- `measureBookOptions(source)`：字体/图片准备好后实际测量选项和 KaTeX 固有宽度，批量读写并清理测量节点；编辑器共用带缓存的实际宽度判断。
- `materializeBookColumns(source, plan)`：将流式分栏物化为物理栏盒；手动换栏和换页、表头重现、超长段落拆分均保留文本身份；外围 Paged.js 管理页眉/页脚/目录。通栏交接最多 5 次有界测量，不稳定则明确拒绝导出。

书稿编辑和渲染不会调用模型；验证使用隔离资料，无真实密钥。

## 0. 原始接入清单（实现对照）

本次开源参考为 MIT 的 [Tiptap 节点接口](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node)、[Tiptap 仓库](https://github.com/ueberdosis/tiptap) 与 [Paged.js](https://github.com/pagedjs/pagedjs)。复用现有结构化节点和分页钩子；不引入付费 Pages、在线编译或新渲染器依赖。分栏采用项目自己的物理栏盒与有界测量实现，未把 CSS 多栏声明直接当作跨页支持。

## 已执行验证

- `npm test`：前端/纯函数、模型、项目 ZIP 与 Electron 存储测试。
- `scripts/book-options-regression.cjs`：实际 Electron/KaTeX 固有宽度，手动排列、题图、窄栏、公式和重复测量清理。
- `scripts/book-p0-editor-regression.cjs`：在真实编辑台输入、修改分栏属性、原生 IPC 保存与重开，验证新节点不会被 schema 丢弃。
- 原 `book-editor-regression.cjs` 和 `book-workspace-regression.cjs --no-pdf`：原文档流、题目副本、公式、表格、版本、ZIP 和四类外观回归。
- `scripts/book-columns-render-regression.cjs`：真实 Electron/Paged.js 分栏几何、文字完整性，原生打印生成 16 页分栏样本及 2 页样式/作答区样本，全部 18 页渲染后检查；PDF 为隔离验收材料，不覆盖用户文件。
- `scripts/book-p0-editor-regression.cjs --pdf`：额外通过真实 `book:pdf` IPC、校验与独立导出窗口生成 3 页验收 PDF。
- `scripts/book-columns-render-regression.cjs --capacity --no-pdf`：同一份 1000 题、40 章、每章 25 题的 B5 合成样本，依次生成单栏/双栏，均为 120 页且题号顺序完整。当前一次本机运行约 5 秒/23 秒；初版双栏约 56 秒。只表示这份样本的全书预排耗时，不是编辑帧率，也不是所有书稿的性能保证。较大双栏书稿全书预览仍有等待成本。

验证资料在 `artifacts/qa-book-*`（不入项目交付文件）。上述案例不是任意内容绝无分页问题的承诺；超高不可拆块、超宽公式/表格、版心不足或交接处无法收敛时明确失败，禁止导出已知裁切内容。

## 原始实施步骤

1. 按第 2、3 节修改校验与存储，第 4 节修改渲染。
2. 跑第 6 节验收用例。
3. 把 `BOOK_LAYOUT_CAPABILITIES` 中对应开关改为 `true`，入口即对所有用户开放。两项能力可以分开上线。

开关为 `false` 时，界面不显示任何新入口，不会写出新节点或新属性，现有书稿行为不变。

当前版本两项能力已开启，无需设置开发预览开关。不要为了联调清空真实草稿；回归脚本均使用独立临时资料目录。

## 1. 数据模型

### 1.1 `columnSet`：流式分栏区

```jsonc
{
  "type": "columnSet",
  "attrs": { "count": 2, "gap": 6, "rule": false },
  "content": [
    { "type": "bookQuestion", "attrs": { "questionId": "…", "optionColumns": null } },
    { "type": "columnBreak" },
    { "type": "paragraph", "content": [ … ] }
  ]
}
```

| 属性 | 类型 | 范围 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `count` | `2 \| 3` | 整数 2 或 3 | 2 | 栏数。单栏 = 没有 columnSet，不存 `count:1` |
| `gap` | number | 2–20，步长 0.5 | 6 | 栏间距，**毫米** |
| `rule` | boolean | — | false | 栏间分隔线 |

**语义**：流式多栏。内容按文档顺序先填满第 1 栏，再填第 2 栏，满页后进入下一页的第 1 栏，相当于 `column-fill: auto` 加跨页续排。它不是左右并排的手工分栏，栏与栏之间没有独立的内容容器。

**结构约束**（界面用 ProseMirror schema 保证，后端校验仍需检查，因为导入的项目文件可能被篡改）：

- 只能是章节 `doc` 的**直接子节点**，不能出现在 `columnSet`、`callout`、`blockquote`、`listItem` 或表格单元格里。
- `content` 非空，只能包含 block 节点（与 `doc` 允许的块相同，但不含 `columnSet`）和 `columnBreak`。
- 允许连续多个 `columnSet`，也允许 `columnSet` 和通栏内容交替出现。

`content` 里包含 `pageBreak` 时，它的含义仍然是"另起一页"，新页面从第 1 栏开始。

分栏区的直接子标题可设置 `attrs.columnSpan: 'all'`，先结束当前栏组、通栏排标题，再开启下一组栏。标题属性由编辑器保留，暂无单独的跨栏按钮。

### 1.2 `columnBreak`：强制换栏

```json
{ "type": "columnBreak" }
```

原子节点，没有属性和子节点。**只能是 `columnSet` 的直接子节点**。语义为后续内容从下一栏开始；已在最后一栏时，从下一页的第 1 栏开始。

### 1.3 `bookQuestion.optionColumns`：本题选项排列

```jsonc
{ "type": "bookQuestion", "attrs": { "questionId": "…", "optionColumns": null } }
```

取值为 `null | "auto" | 1 | 2 | 4`：

- `null`：跟随全书默认。界面保存时会**始终写出**这个键，通常为 `null`，现有校验器已经接受 null 属性。
- `"auto"`：按渲染后的最长选项宽度和所在栏可用宽度自动选择。
- 数字：每行放几个选项。

题目右侧有绕排题图时，最多 2 列，手动设置为 4 时也按 2 列排。

### 1.4 `settings.optionColumns`：全书默认选项排列

`BookSettings` 新增字段 `optionColumns: "auto" | 1 | 2 | 4`，默认 `"auto"`。旧书稿缺少这个字段时按 `"auto"` 读取。

### 1.5 版本号

这些改动都是新增字段和节点，不改变旧字段的含义。当前实现：

- 书稿用到任一 v2 能力时，写出 `version: 2`；没用到时保持 `version: 1`。
- `validateBookProject` / `validateStoredBook` 同时接受 1 和 2；`version: 1` 的书稿出现 v2 节点时，视为非法。

这样旧版程序打开 v2 书稿，会明确拒绝不支持的版本。界面提交事务通过 `upgradeBookLayoutVersion` 自动升级；严格导入不会擅自替篡改的 v1 文件升级版本。

## 2. `src/book-model.ts`

- `NODE_TYPES` 和 `BLOCK_TYPES` 加入 `columnSet`；`NODE_TYPES` 加入 `columnBreak`。注意 `columnSet` 只能出现在 doc 顶层，不能加进 `callout`、`tableCell` 等容器允许的块类型。
- 属性白名单：
  - `columnSet`：`count`（整数 2 或 3）、`gap`（2–20）、`rule`（boolean）。
  - `bookQuestion`：`optionColumns`，可以用 `isBookOptionColumns()` 判断；值为 null 时已经被通用规则放行。
- 结构规则：
  - `doc` 的子节点可以是 block 或 `columnSet`。
  - `columnSet` 的子节点非空，且只能是 block（不含 `columnSet`）或 `columnBreak`。
  - `columnBreak` 只能出现在 `columnSet` 下，且没有子节点。
  - 其他容器内出现 `columnSet` 或 `columnBreak` 时拒绝。
- `checkedSettings.optionColumns = settings.optionColumns === undefined ? 'auto' : choice(...)`。
- `DEFAULT_BOOK_SETTINGS` 增加 `optionColumns: 'auto'`。
- 可选：用 `normalizeColumnSetAttrs()` 做容错归一化，再做严格校验。

`bookQuestionIds()` 已经递归遍历，分栏区内的题目编号和书尾答案不需要改。

## 3. `electron/book-store.cjs`

- 存储校验接受 `columnSet`、`columnBreak`、`answerArea` 与样式引用，并校验节点所在层级。
- `settings.optionColumns` 存在时，取值必须属于 `['auto',1,2,4]`。
- `book:pdf` 接收的书稿也先经过 `validateStoredBook`，项目 ZIP 与原生草稿均保留版式版本。

## 4. `src/book-render.ts`（以及 Paged.js 分页）

### 4.1 分栏区

```html
<section class="book-columns" data-columns="2" data-column-gap="6" data-column-rule="true">…</section>
<div class="book-column-break"></div>
```

标记由 `materializeBookColumns` 转成实测后的栏盒，栏间线按 `data-column-rule` 绘制。`renderNode` 将当前栏数和栏距传给子节点，供选项排列计算。若版心扣除栏距后单栏不足 20 mm，预览及导出会提示调整纸张、页边距或栏距。

### 4.2 选项排列

`resolveOptionColumns` 计算题目卡片的自动列数和渲染初值。编辑器和导出都用 `bookOptionAvailableWidthMm` 扣除右侧题图与绕排间距，并用同一实测列数规则。打印源准备好字体后，由 `measureBookOptions` 读取实际文本、公式、选项标号和列距，一次性应用最终列数，再进入分页。

## 5. 界面已完成的部分（供对照）

| 位置 | 内容 |
| --- | --- |
| 正文工具栏 | "通栏 / 双栏 / 三栏"下拉：不在分栏区时，把所选顶层块包进分栏区；在分栏区内时修改栏数；选"通栏"则取消分栏。另有"插入换栏"按钮（Ctrl+Shift+Enter） |
| 分栏区头部 | 栏数切换、栏距（mm）、分隔线、每栏宽度和每行约多少字、展开编辑、取消分栏（保留内容并移除换栏标记） |
| 分栏区正文 | 按**印刷栏宽**显示，由纸张、页边距、字号换算成 em，所以每行字数和 PDF 接近。右侧显示"第 N 栏 · 自动续排"的占位栏。编辑区内的题目时自动展开到全宽 |
| 题目卡片 | 标题行显示"选项 N 列 · 自动"；编辑态可以选"跟随全书 / 自动 / 每行 4、2、1 个"，阅读态的选项网格按结果实时排列 |
| 右侧"排版" | "选项排列（全书默认）" |
| schema | `columnSet` 属于独立分组 `bookFlow`，只允许出现在 doc 顶层；`columnBreak` 只允许在 `columnSet` 内。粘贴或导入的非法嵌套会被编辑器丢弃 |

相关文件：`src/book-layout-contract.ts`、`src/components/BookColumns.tsx`、`src/components/book-columns.css`、`src/components/BookEditor.tsx`、`src/components/BookWorkspace.tsx`。纯函数测试：`src/book-layout-contract.test.ts`。

## 6. 验收用例

1. 旧书稿（v1，不含新内容）的加载、保存、导出 PDF 和导出项目都不变。
2. 一章内"讲解（通栏）→ 30 道选择题（双栏）→ 解答题（通栏）"，PDF 中双栏区跨 3 页以上，题目顺序正确，题目不在栏底被切开（`keepTogether` 默认生效）。
3. 双栏区内插入 `columnBreak`，后续内容从右栏开始；在右栏插入时，从下一页左栏开始。
4. 三栏、gap = 2 和 gap = 20、`rule: true`，PDF 中栏宽和分隔线位置正确。
5. 同一组短选项在通栏中排 4 列，在 B5 双栏中排 2 列，和编辑器标签一致；单题设为"每行 1 个"时覆盖全书默认；有右侧题图时最多 2 列。
6. 导入篡改过的项目：`columnSet` 嵌套在 `callout` 里、`columnBreak` 在 doc 顶层、`count: 5`、`optionColumns: 3`，都应明确拒绝，当前书稿不变。
7. `book-pagination-integrity` 对多栏内容也能检测出缺失或重复的文字片段。
8. 千题样稿中加入分栏后，全书预览和导出耗时与现状在同一量级（同机器、同样本对比）。
