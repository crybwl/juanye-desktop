import { emptyRich, richFromPlain, sanitizeRich, type RichDoc } from "./rich";

export type QuestionKind = "single" | "multi" | "blank" | "essay";
export type NoteTone = "ink" | "red" | "blue" | "green" | "purple";

export interface ChoiceOption { id: string; text: RichDoc }

interface BlockBase { id: string }
export interface HeadingBlock extends BlockBase { kind: "heading"; level: 1 | 2 | 3; text: RichDoc }
export interface TextBlock extends BlockBase { kind: "text"; text: RichDoc }
export interface QuestionBlock extends BlockBase {
  kind: "question";
  qtype: QuestionKind;
  stem: RichDoc;
  options: ChoiceOption[];
  /** 选择题：正确选项 id。 */
  correct: string[];
  /** 解答题 / 无挖空填空题的参考答案。 */
  answer: RichDoc;
  analysis: RichDoc;
  /** 学生版作答留白（mm）。 */
  space: number;
  /** 题号前缀，例如“例 1”；为空则自动编号。 */
  label?: string;
}
export interface NoteBlock extends BlockBase { kind: "note"; tone: NoteTone; title: string; text: RichDoc; /** 仅教师版显示 */ teacherOnly?: boolean }
export interface FormulaBlock extends BlockBase { kind: "formula"; latex: string }
export interface FigureBlock extends BlockBase { kind: "figure"; src: string; width: number; caption: RichDoc }
export interface DividerBlock extends BlockBase { kind: "divider" }
export interface PageBreakBlock extends BlockBase { kind: "pagebreak" }

export type Block = HeadingBlock | TextBlock | QuestionBlock | NoteBlock | FormulaBlock | FigureBlock | DividerBlock | PageBreakBlock;
export type BlockKind = Block["kind"];

export type WorkbookPaper = "A4" | "16K" | "B5" | "A5";
export const PAPER_SIZE: Record<WorkbookPaper, [number, number]> = { A4: [210, 297], "16K": [185, 260], B5: [176, 250], A5: [148, 210] };
export const ACCENTS = { ink: "#2f4a7a", teal: "#1f6f6b", wine: "#8a2f3c", moss: "#4c6a2e", plum: "#5b3f7a" } as const;
export type WorkbookAccent = keyof typeof ACCENTS;

export interface WorkbookLayout {
  paper: WorkbookPaper;
  /** mm：上、右、下、左（左为订口一侧）。 */
  margin: [number, number, number, number];
  fontSize: number; // pt
  lineHeight: number;
  font: "serif" | "sans";
  accent: WorkbookAccent;
  header: boolean;
  pageNumber: boolean;
}

export interface Workbook {
  version: 1;
  id: string;
  title: string;
  layout: WorkbookLayout;
  blocks: Block[];
  updatedAt: number;
}

export type Edition = "student" | "teacher";

export const defaultLayout = (): WorkbookLayout => ({
  paper: "A4", margin: [20, 18, 18, 20], fontSize: 10.5, lineHeight: 1.8, font: "serif", accent: "ink", header: true, pageNumber: true,
});

let counter = 0;
export const uid = (prefix = "b") => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const options = (texts: string[]): ChoiceOption[] => texts.map(text => ({ id: uid("o"), text: richFromPlain(text) }));

export function createBlock(kind: BlockKind, variant?: string): Block {
  const id = uid();
  switch (kind) {
    case "heading": return { id, kind, level: (Number(variant) || 2) as 1 | 2 | 3, text: emptyRich() };
    case "text": return { id, kind, text: emptyRich() };
    case "question": {
      const qtype = (variant as QuestionKind) || "single";
      const choice = qtype === "single" || qtype === "multi";
      return { id, kind, qtype, stem: emptyRich(), options: choice ? options(["", "", "", ""]) : [], correct: [], answer: emptyRich(), analysis: emptyRich(), space: qtype === "essay" ? 40 : 0 };
    }
    case "note": return { id, kind, tone: (variant as NoteTone) || "blue", title: variant === "red" ? "易错警示" : variant === "green" ? "方法技巧" : "知识梳理", text: emptyRich() };
    case "formula": return { id, kind, latex: "" };
    case "figure": return { id, kind, src: "", width: 60, caption: emptyRich() };
    case "divider": return { id, kind };
    case "pagebreak": return { id, kind };
  }
}

/** 题型切换：保留题干、答案和解析，按需补齐或收起选项。 */
export function convertQuestion(block: QuestionBlock, qtype: QuestionKind): QuestionBlock {
  const choice = qtype === "single" || qtype === "multi";
  const opts = choice && block.options.length < 2 ? options(["", "", "", ""]) : block.options;
  // 非选择题不显示选项答案，但保留下来，切回选择题时还原。
  const correct = qtype === "single" ? block.correct.slice(0, 1) : block.correct;
  // 留白跟随题型：解答题默认 40 mm，其余题型不留白（切回选择题时自动收起）。
  const space = qtype === "essay" ? (block.qtype === "essay" ? block.space : block.space || 40) : 0;
  return { ...block, qtype, options: opts, correct, space };
}

export const EXAMPLE_LABEL = "例";

/** 自动题号：遇到一级标题重新计数；例题（label = “例”）单独编号，其他自定义前缀不占号。 */
export function questionNumbers(blocks: readonly Block[]): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0, example = 0;
  for (const block of blocks) {
    if (block.kind === "heading" && block.level === 1) { n = 0; example = 0; }
    else if (block.kind === "question" && !block.label) out.set(block.id, ++n);
    else if (block.kind === "question" && block.label === EXAMPLE_LABEL) out.set(block.id, ++example);
  }
  return out;
}

/** 页眉显示最近的一级标题。 */
export function chapterAt(blocks: readonly Block[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const block = blocks[i];
    if (block.kind === "heading" && block.level === 1) return block.text.content.map(p => (p.content ?? []).map(n => n.text ?? "").join("")).join(" ");
  }
  return "";
}

export function sanitizeWorkbook(value: unknown): Workbook | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Workbook>;
  if (raw.version !== 1 || !Array.isArray(raw.blocks)) return null;
  const layout = { ...defaultLayout(), ...(raw.layout ?? {}) };
  if (!PAPER_SIZE[layout.paper]) layout.paper = "A4";
  if (!ACCENTS[layout.accent]) layout.accent = "ink";
  const blocks = raw.blocks.flatMap((block): Block[] => {
    if (!block || typeof block !== "object" || typeof block.id !== "string") return [];
    switch (block.kind) {
      case "heading": case "text": return [{ ...block, text: sanitizeRich(block.text) }];
      case "question": return [{ ...block, stem: sanitizeRich(block.stem), answer: sanitizeRich(block.answer), analysis: sanitizeRich(block.analysis), options: Array.isArray(block.options) ? block.options.map(o => ({ id: String(o.id), text: sanitizeRich(o.text) })) : [], correct: Array.isArray(block.correct) ? block.correct.map(String) : [], space: Number(block.space) || 0 }];
      case "note": return [{ ...block, text: sanitizeRich(block.text), title: String(block.title ?? "") }];
      case "figure": return [{ ...block, caption: sanitizeRich(block.caption), width: Math.min(100, Math.max(15, Number(block.width) || 60)) }];
      case "formula": case "divider": case "pagebreak": return [block];
      default: return [];
    }
  });
  return { version: 1, id: String(raw.id || uid("wb")), title: String(raw.title || "未命名教辅"), layout, blocks, updatedAt: Number(raw.updatedAt) || Date.now() };
}

/** 首次打开的示例：高中数学一节，覆盖知识框、例题、填空、解答与易错提示。 */
export function sampleWorkbook(): Workbook {
  const q = (qtype: QuestionKind, stem: string, opts: string[], correct: number[], analysis: string, extra: Partial<QuestionBlock> = {}): QuestionBlock => {
    const base = convertQuestion({ ...(createBlock("question", qtype) as QuestionBlock), stem: richFromPlain(stem) }, qtype);
    const optionList = opts.length ? options(opts) : base.options;
    return { ...base, options: optionList, correct: correct.map(i => optionList[i].id), analysis: richFromPlain(analysis), ...extra };
  };
  const blankStem = (before: string, answer: string, after: string): RichDoc => {
    const head = richFromPlain(before).content[0].content ?? [], tail = richFromPlain(after).content[0].content ?? [];
    return { type: "doc", content: [{ type: "paragraph", content: [...head, { type: "blank", attrs: { answer } }, ...tail] }] };
  };
  return {
    version: 1,
    id: uid("wb"),
    title: "高中数学 · 必修第一册",
    layout: defaultLayout(),
    updatedAt: Date.now(),
    blocks: [
      { id: uid(), kind: "heading", level: 1, text: richFromPlain("第三章　函数的概念与性质") },
      { id: uid(), kind: "heading", level: 2, text: richFromPlain("3.4　二次函数的图像与性质") },
      { id: uid(), kind: "note", tone: "blue", title: "知识梳理", text: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "二次函数 " }, { type: "inlineMath", attrs: { latex: "y=ax^2+bx+c\\ (a\\ne 0)" } }, { type: "text", text: " 的图像是一条抛物线，对称轴为直线 " }, { type: "inlineMath", attrs: { latex: "x=-\\dfrac{b}{2a}" } }, { type: "text", text: "，顶点坐标为 " }, { type: "inlineMath", attrs: { latex: "\\left(-\\dfrac{b}{2a},\\ \\dfrac{4ac-b^2}{4a}\\right)" } }, { type: "text", text: "。" }] },
        { type: "paragraph", content: [{ type: "text", text: "当 " }, { type: "inlineMath", attrs: { latex: "a>0" } }, { type: "text", text: " 时开口向上，函数在 " }, { type: "inlineMath", attrs: { latex: "\\left(-\\infty,-\\dfrac{b}{2a}\\right]" } }, { type: "text", text: " 上单调递减；当 " }, { type: "inlineMath", attrs: { latex: "a<0" } }, { type: "text", text: " 时开口向下。" }] },
      ] } },
      { id: uid(), kind: "heading", level: 3, text: richFromPlain("典例精析") },
      q("single", "已知二次函数 $y=x^2-4x+3$，下列说法正确的是（　　）", ["图像开口向下", "对称轴为直线 $x=-2$", "顶点坐标为 $(2,-1)$", "与 $y$ 轴交于点 $(0,-3)$"], [2],
        "配方得 $y=(x-2)^2-1$，开口向上，对称轴为 $x=2$，顶点为 $(2,-1)$；令 $x=0$ 得 $y=3$。故选 C。", { label: EXAMPLE_LABEL }),
      { id: uid(), kind: "note", tone: "red", title: "易错警示", teacherOnly: false, text: richFromPlain("求对称轴时注意 $x=-\\dfrac{b}{2a}$ 中的负号，$b=-4$ 时对称轴为 $x=2$，而不是 $x=-2$。") },
      { id: uid(), kind: "heading", level: 3, text: richFromPlain("课堂训练") },
      q("single", "函数 $f(x)=-2x^2+4x+1$ 在区间 $[0,3]$ 上的最大值为（　　）", ["$1$", "$3$", "$-5$", "$5$"], [1], "对称轴 $x=1\\in[0,3]$，开口向下，最大值 $f(1)=3$。"),
      { ...q("blank", "", [], [], "由 $\\Delta=0$ 得 $16-4m=0$，所以 $m=4$。"), stem: blankStem("若抛物线 $y=x^2-4x+m$ 与 $x$ 轴只有一个公共点，则 $m=$ ", "$4$", "。") },
      q("essay", "已知二次函数 $f(x)=x^2-2ax+3$。\n（1）若 $f(x)$ 在 $(-\\infty,2]$ 上单调递减，求 $a$ 的取值范围；\n（2）当 $x\\in[0,2]$ 时，求 $f(x)$ 的最小值 $g(a)$。", [], [],
        "（1）对称轴 $x=a$，依题意 $a\\ge 2$。\n（2）当 $a<0$ 时，$g(a)=f(0)=3$；当 $0\\le a\\le 2$ 时，$g(a)=f(a)=3-a^2$；当 $a>2$ 时，$g(a)=f(2)=7-4a$。", { space: 48 }),
      { id: uid(), kind: "note", tone: "green", title: "方法技巧", text: richFromPlain("“轴动区间定”问题按对称轴与区间的位置分类讨论：轴在区间左侧、区间内、区间右侧。") },
    ],
  };
}
