import type { Exam, Layout, Question, QType, Section } from "./types";
import { defaultLayout, PAPER_MM, TYPE_META } from "./data";
import { mathSegments, normalizeMathDelimiters } from "./math";
import { pdfOptions } from "./pdf";
import { drawingSegments } from "./drawing";
import { hasOptions, isLongAnswer, questionFigures } from "./figures";
import { decodeDocumentText } from "./text-decoding";

export const PROJECT_SCHEMA = "juanye/1" as const;
export interface ImportedDocument { exam?: Exam; layout?: Layout; questions?: Question[] }
export interface ProjectDocument { schema: typeof PROJECT_SCHEMA; exam: Exam; layout: Layout }
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const qTypes = Object.keys(TYPE_META) as QType[];
const id = () => crypto.randomUUID();
const object = (x: unknown, name: string): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error(`${name}格式不正确`);
  return x as Record<string, unknown>;
};
const str = (x: unknown, name: string, max = 200000): string => {
  if (typeof x !== "string" || x.length > max) throw new Error(`${name}必须是文本，且不能超过 ${max} 字`);
  return x;
};
const number = (x: unknown, name: string, min: number, max: number): number => {
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) throw new Error(`${name}必须在 ${min}–${max} 之间`);
  return x;
};
function oneOf<T extends string | number>(x: unknown, values: readonly T[], name: string): T {
  if (!values.includes(x as T)) throw new Error(`${name}不受支持`);
  return x as T;
}
function strings(x: unknown, name: string, max = 100): string[] {
  if (!Array.isArray(x) || x.length > max) throw new Error(`${name}必须是数组，且不能超过 ${max} 项`);
  return x.map((v) => str(v, name));
}
function validateQuestion(value: unknown, ids: Set<string>): Question {
  const q = object(value, "题目");
  const qid = str(q.id, "题目 ID", 200);
  if (!qid || ids.has(qid)) throw new Error("存在重复或空的题目 ID，请修复后重新导入");
  ids.add(qid);
  const result: Question = {
    id: qid, type: oneOf(q.type, qTypes, "题型"), score: number(q.score, "题目分数", 0, 1000),
    stem: normalizeMathDelimiters(str(q.stem, "题干")), options: strings(q.options, "选项", 26).map(normalizeMathDelimiters),
    answer: strings(q.answer, "答案").map(normalizeMathDelimiters), analysis: normalizeMathDelimiters(str(q.analysis, "解析")),
  };
  if (q.flag !== undefined) result.flag = str(q.flag, "校对提示", 1000);
  if (q.image !== undefined) result.image = oneOf(q.image, ["plot"] as const, "题图");
  if (q.sourceImage !== undefined) {
    const image = str(q.sourceImage, "原图", 40 * 1024 * 1024);
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(image)) throw new Error("原图必须是嵌入项目的 PNG、JPEG、WebP 或 GIF 图片");
    result.sourceImage = image;
  }
  if (q.figure !== undefined) {
    const image = str(q.figure, "题图", 40 * 1024 * 1024);
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(image)) throw new Error("题图必须是嵌入项目的 PNG、JPEG、WebP 或 GIF 图片");
    result.figure = image;
  }
  if (q.answerSpace !== undefined) result.answerSpace = oneOf(q.answerSpace, ["quarter", "half", "full", "auto"] as const, "答题区大小");
  if (q.paperAnswerSpace !== undefined) result.paperAnswerSpace = oneOf(q.paperAnswerSpace, ["quarter", "half", "full", "auto"] as const, "卷内答题区大小");
  if (q.importNumber !== undefined) {
    const imported = number(q.importNumber, "原题号", 1, 100000);
    if (!Number.isSafeInteger(imported)) throw new Error("原题号必须为整数");
    result.importNumber = imported;
  }
  if (q.figures !== undefined) {
    if (!Array.isArray(q.figures) || q.figures.length > 8) throw new Error("每题最多 8 张题图");
    const figureIds = new Set<string>();
    result.figures = q.figures.map(value => {
      const figure = object(value, "题图");
      const fid = str(figure.id, "题图 ID", 200);
      if (!fid || figureIds.has(fid)) throw new Error("题图 ID 为空或重复");
      figureIds.add(fid);
      const src = str(figure.src, "题图", 40 * 1024 * 1024);
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(src)) throw new Error("题图必须嵌入项目，不能引用外部文件");
      return { id: fid, src, layout: oneOf(figure.layout, ["right", "half", "full"] as const, "题图排列"), ...(figure.caption === undefined ? {} : { caption: str(figure.caption, "图注", 2000) }), ...(figure.width === undefined ? {} : { width: number(figure.width, "题图宽度", 15, 100) }), ...(figure.maxHeight === undefined ? {} : { maxHeight: number(figure.maxHeight, "题图限高", 50, 800) }) };
    });
  }
  if (q.drawing !== undefined) result.drawing = str(q.drawing, "绘图代码", 32768);
  if (q.source !== undefined) result.source = str(q.source, "来源", 2000);
  if (q.knowledge !== undefined) result.knowledge = strings(q.knowledge, "知识点", 100);
  if (q.difficulty !== undefined) result.difficulty = oneOf(q.difficulty, ["easy", "medium", "hard"] as const, "难度");
  if (q.pageBreakBefore !== undefined) { if (typeof q.pageBreakBefore !== "boolean") throw new Error("题前分页必须是开关值"); result.pageBreakBefore = q.pageBreakBefore; }
  return result;
}

/** Own editable project format only. No third-party ZIP protocol is accepted. */
export function parseProject(text: string): { exam: Exam; layout: Layout } {
  if (text.length > MAX_FILE_BYTES) throw new Error("项目文件过大，请将文件控制在 100MB 以内");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("项目不是完整的 JSON 文件，请选择卷页导出的项目文件"); }
  const doc = object(raw, "项目");
  if (doc.schema !== PROJECT_SCHEMA) throw new Error("不是卷页项目，或项目版本不受支持（需要 juanye/1）");
  const e = object(doc.exam, "试卷");
  if (!Array.isArray(e.sections) || e.sections.length > 100) throw new Error("大题列表不正确，最多支持 100 个大题");
  const ids = new Set<string>();
  const sectionIds = new Set<string>();
  const exam: Exam = {
    title: str(e.title, "试卷标题", 1000), subtitle: str(e.subtitle, "副标题", 1000),
    duration: number(e.duration, "考试时长", 0, 1440), notice: strings(e.notice, "注意事项"),
    sections: e.sections.map((value) => {
      const s = object(value, "大题");
      const sid = str(s.id, "大题 ID", 200);
      if (!sid || sectionIds.has(sid)) throw new Error("大题 ID 为空或重复");
      sectionIds.add(sid);
      if (!Array.isArray(s.questions) || s.questions.length > 1000) throw new Error("题目列表不正确，每个大题最多支持 1000 题");
      const section: Section = { id: sid, type: oneOf(s.type, qTypes, "大题题型"), title: str(s.title, "大题标题", 1000), note: str(s.note, "大题说明", 10000), questions: s.questions.map((q) => validateQuestion(q, ids)) };
      if (s.pageBreakBefore !== undefined) { if (typeof s.pageBreakBefore !== "boolean") throw new Error("大题分页必须是开关值"); section.pageBreakBefore = s.pageBreakBefore; }
      return section;
    }),
  };
  if (ids.size > 2000) throw new Error("单份试卷最多支持 2000 题");
  const l = object(doc.layout, "排版设置");
  const bool = (key: keyof Layout): boolean => {
    if (typeof l[key] !== "boolean") throw new Error(`排版设置 ${key} 必须是开关值`);
    return l[key] as boolean;
  };
  const layout: Layout = {
    style: oneOf(l.style, ["real", "structured"], "试卷样式"), density: oneOf(l.density, ["compact", "standard", "loose"], "排版密度"),
    paper: oneOf(l.paper, ["A4", "A3", "8K", "A5", "B5", "Letter"], "纸张"), orientation: oneOf(l.orientation, ["portrait", "landscape"], "纸张方向"),
    margin: number(l.margin, "页边距", 4, 50), fontSize: number(l.fontSize, "字号", 6, 36), lineHeight: number(l.lineHeight, "行距", 1, 3),
    optionCols: oneOf(l.optionCols, ["auto", 4, 2, 1], "选项栏数"), pageNumber: bool("pageNumber"), showScore: bool("showScore"), keepTogether: bool("keepTogether"), answerSpace: bool("answerSpace"),
  };
  if (l.questionGap !== undefined) layout.questionGap = number(l.questionGap, "题距", 0, 15);
  if (l.optionGap !== undefined) layout.optionGap = number(l.optionGap, "选项间距", 0, 10);
  if (l.figureWidth !== undefined) layout.figureWidth = number(l.figureWidth, "题图宽度", 15, 55);
  if (l.figureGap !== undefined) layout.figureGap = number(l.figureGap, "图文间距", 0, 10);
  if (l.answerMode !== undefined) layout.answerMode = oneOf(l.answerMode, ["none", "brief", "full"] as const, "答案模式");
  if (l.quickAnswers !== undefined) layout.quickAnswers = bool("quickAnswers");
  if (l.columns !== undefined) layout.columns = oneOf(l.columns, [1, 2] as const, "正文栏数");
  if (l.columnGap !== undefined) layout.columnGap = number(l.columnGap, "栏间距", 3, 25);
  if (l.sealLine !== undefined) layout.sealLine = bool("sealLine");
  if (l.sealWidth !== undefined) layout.sealWidth = number(l.sealWidth, "密封区宽度", 12, 30);
  layout.paperMode = l.paperMode === undefined ? "questions" : oneOf(l.paperMode, ["questions", "integrated"] as const, "试卷类型");
  return { exam, layout };
}

export function exportProject(exam: Exam, layout: Layout): string {
  const doc: ProjectDocument = { schema: PROJECT_SCHEMA, exam, layout };
  return JSON.stringify(doc, null, 2);
}

export function stripQuestionNumber(text: string): string {
  return text.replace(/^\s*(?:(?:第\s*)?\d{1,3}\s*题\s*[.．、:：]?|\d{1,3}\s*[.．、](?!\d))\s*/, "").trim();
}

function parseQuestion(text: string, hintedType?: QType): Question {
  let body = stripQuestionNumber(text).replace(/^\s*[一二三四五六七八九十]+[、．.].*(?:选择题|填空题|解答题).*$/gm, "").trim();
  const analysisMatch = /(?:^|\n)\s*(?:【(?:解析|分析)】|(?:解析|分析)\s*[:：])\s*/m.exec(body);
  let analysis = "";
  if (analysisMatch) { analysis = body.slice(analysisMatch.index + analysisMatch[0].length).trim(); body = body.slice(0, analysisMatch.index).trim(); }
  const answerMatch = /(?:^|\n)\s*(?:【(?:参考)?答案】|(?:参考答案|答案)\s*[:：])\s*/m.exec(body);
  let answer: string[] = [];
  if (answerMatch) { answer = [body.slice(answerMatch.index + answerMatch[0].length).trim()]; body = body.slice(0, answerMatch.index).trim(); }
  // Mask mathematics without changing offsets, so A. inside a formula is never treated as an option.
  let mask = "";
  let cursor = 0;
  for (const segment of mathSegments(body)) {
    if (!segment.math) { mask += segment.text; cursor += segment.text.length; continue; }
    // Find the source delimiters, whose length is not represented in MathSegment.text.
    const start = cursor;
    const open = body.startsWith("$$", start) || body.startsWith("\\(", start) || body.startsWith("\\[", start) ? 2 : 1;
    const len = segment.text.length + open * 2;
    mask += " ".repeat(len); cursor += len;
  }
  const marks = [...mask.matchAll(/(?<!\S)([A-H])[.．、:：]/g)];
  const options: string[] = [];
  // Require A followed by B, rather than turning a lone letter in prose into choices.
  const first = marks.findIndex((m, i) => m[1] === "A" && marks[i + 1]?.[1] === "B");
  if (first >= 0) {
    const sequence = marks.slice(first).filter((m, i) => m[1] === String.fromCharCode(65 + i));
    if (sequence.length >= 2) {
      sequence.forEach((mark, i) => options.push(body.slice(mark.index! + mark[0].length, sequence[i + 1]?.index ?? body.length).trim()));
      body = body.slice(0, sequence[0].index).trim();
    }
  }
  const type: QType = options.length ? hintedType === "multi" || /多选|多项选择/.test(text) ? "multi" : "single" : hintedType ?? (/_{3,}|填空/.test(body) ? "blank" : "essay");
  if ((type === "single" || type === "multi") && answer.length && /^[A-H\s、,，]+$/i.test(answer[0])) answer = [...new Set(answer[0].toUpperCase().match(/[A-H]/g) ?? [])];
  return { id: id(), type, score: type === "essay" ? 10 : type === "multi" ? 6 : 5, stem: normalizeMathDelimiters(body), options: options.map(normalizeMathDelimiters), answer: answer.map(normalizeMathDelimiters), analysis: normalizeMathDelimiters(analysis) };
}

/** Only line-start main numbering splits questions; (1)/(2) remain inside the stem. */
export function importText(raw: string): Question[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^```(?:text|markdown|md)?\s*\n|\n```\s*$/g, "").trim();
  if (!text) throw new Error("文件中没有可导入的文字");
  const matches = [...text.matchAll(/^[\t ]*(?:第\s*\d{1,3}\s*题\s*[.．、:：]?|\d{1,3}\s*[.．、](?!\d))\s*/gm)];
  if (!matches.length) return [parseQuestion(text)];
  const questions: Question[] = [];
  let previous = 0;
  let selected: typeof matches = [];
  // Monotonically increasing top-level numbers avoid splitting repeated calculation steps.
  for (const match of matches) {
    const n = Number(match[0].match(/\d+/)?.[0]);
    if (n > previous) { selected.push(match); previous = n; }
  }
  if (!selected.length) selected = matches;
  for (let i = 0; i < selected.length; i++) {
    const start = selected[i].index!;
    const context = text.slice(0, start);
    const headings = [...context.matchAll(/^[\t ]*[一二三四五六七八九十]+[、．.]\s*(单项选择题|单选题|多项选择题|多选题|填空题|解答题|计算题).*$/gm)];
    const heading = headings.at(-1)?.[1] ?? "";
    const hint: QType | undefined = /多/.test(heading) ? "multi" : /选/.test(heading) ? "single" : /填/.test(heading) ? "blank" : heading ? "essay" : undefined;
    const q = parseQuestion(text.slice(start, selected[i + 1]?.index ?? text.length), hint);
    if (q.stem.trim()) questions.push(q);
  }
  if (!questions.length) throw new Error("没有找到完整题目，请检查文件内容");
  return questions;
}

/** Read local document content once; the three import workflows decide how it is interpreted. */
export async function readDocumentText(file: File): Promise<string> {
  if (!file.size) throw new Error("文件为空");
  if (file.size > MAX_FILE_BYTES) throw new Error("文件过大，请选择 100MB 以内的文件");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["json", "juanye", "paperflow", "txt", "md", "markdown"].includes(ext ?? "")) return decodeDocumentText(await file.arrayBuffer());
  if (ext === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    const text = wordHtmlToMarkdown(result.value);
    if (!text.trim()) throw new Error("DOCX 中没有可提取的文字；图片题目或公式对象请转成图片后使用 OCR");
    return text;
  }
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const loading = pdfjs.getDocument({ ...pdfOptions(), data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 300) throw new Error("PDF 超过 300 页，请先拆分后导入");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        let previousY: number | undefined;
        let line = "";
        for (const item of text.items) {
          if (!("str" in item)) continue;
          const y = item.transform[5];
          if (previousY !== undefined && Math.abs(y - previousY) > 3 && !line.endsWith("\n")) line += "\n";
          line += item.str;
          line += item.hasEOL ? "\n" : " ";
          previousY = y;
        }
        pages.push(line);
        page.cleanup();
      }
      const text = pages.join("\n").trim();
      if (text.replace(/\s/g, "").length < 20) throw new Error("这是扫描版 PDF，未提取到足够文字。请使用图片 OCR 导入，不能直接转为可编辑试卷");
      return text;
    } finally { await loading.destroy(); }
  }
  if (file.type.startsWith("image/") || /^(png|jpe?g|webp|gif|bmp)$/.test(ext ?? "")) throw new Error("图片需要通过 OCR 识别，请使用图片识别入口");
  if (ext === "zip") throw new Error("电脑版不接收好题 ZIP；请导入卷页项目、PDF、DOCX、TXT 或 Markdown");
  throw new Error("不支持此文件类型。支持卷页项目、PDF、DOCX、TXT 和 Markdown");
}

/** Preserve Word paragraphs, emphasis and tables without injecting source HTML into the application. */
export function wordHtmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const textOf = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || "";
    if (!(node instanceof Element)) return "";
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object"].includes(tag)) return "";
    const inner = () => Array.from(node.childNodes).map(textOf).join("");
    if (tag === "table") {
      const rawRows = Array.from((node as HTMLTableElement).rows).map(row => Array.from(row.cells).map(cell => Array.from(cell.childNodes).map(textOf).join("").trim()));
      const cells = rawRows.flat().filter(Boolean);
      // A Word layout table is not a mathematical data table: each cell contains a complete numbered solution.
      const numberedSolution = (cell: string) => /^\s*(?:\*\*)?(?:第\s*\d{1,3}\s*题|\d{1,3}\s*[.．、])(?!\d)[\s\S]*(?:[【\[［](?:参考)?(?:答案|解析|分析|详解)|(?:答案|解析|分析|详解|解答|方法)\s*[:：]|\s[A-H](?:[。．、\s]|$))/.test(cell);
      if (cells.length && cells.every(numberedSolution)) return `\n\n${cells.join("\n\n")}\n\n`;
      const rows = rawRows.map(row => row.map(cell => mathSegments(cell).map(part => part.math ? part.display ? `\\[${part.text}\\]` : `$${part.text}$` : part.text.replace(/\|/g, "\\|")).join("").replace(/\r?\n+/g, "<br>")));
      const count = Math.max(0, ...rows.map(row => row.length));
      if (!count) return "";
      const line = (row: string[]) => `| ${Array.from({ length: count }, (_, i) => row[i] || "").join(" | ")} |`;
      return `\n\n${line(rows[0])}\n${line(Array(count).fill("---"))}\n${rows.slice(1).map(line).join("\n")}\n\n`;
    }
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${inner()}**`;
    if (tag === "em" || tag === "i") return `*${inner()}*`;
    if (tag === "img") {
      const src = node.getAttribute("src") || "";
      return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(src) ? `\n![${(node.getAttribute("alt") || "题图").replace(/[\[\]]/g, "")}](${src})\n` : "";
    }
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${inner()}\n\n`;
    if (["p", "div", "li"].includes(tag)) return `${inner()}\n\n`;
    return inner();
  };
  return Array.from(document.body.childNodes).map(textOf).join("").replace(/\n{3,}/g, "\n\n").trim();
}

export async function importDocument(file: File): Promise<ImportedDocument> {
  const text = await readDocumentText(file);
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["json", "juanye", "paperflow"].includes(ext ?? "")) return parseProject(text);
  const questions = importText(text);
  if (ext === "pdf") questions.forEach(q => { q.flag = "PDF 文字提取：请核对公式、分栏顺序和题图；扫描图及公式对象未自动识别"; });
  return { questions };
}

const TEX_ESCAPE: Record<string, string> = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$", "&": "\\&", "#": "\\#", "%": "\\%", "_": "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
export const escapeTex = (text: string) => text.replace(/[\\{}$&#%_~^]/g, (c) => TEX_ESCAPE[c]);
function texText(text: string): string {
  return drawingSegments(text).map(segment => segment.kind === "tikz" ? texDrawing(segment.code) : texPlainText(segment.text)).join("");
}
function texDrawing(code: string): string {
  if (/\\(?:input|include\w*|write\w*|open\w*|read\w*|catcode|csname|def|edef|gdef|xdef|newcommand|renewcommand|usepackage|documentclass|special|directlua|immediate|expandafter|scantokens)\b|\^\^/i.test(code)) throw new Error("绘图包含不允许导出的 LaTeX 文件或执行命令");
  return `\n${code}\n`;
}
function texPlainText(text: string): string {
  return mathSegments(text).map((part) => {
    if (!part.math) return escapeTex(part.text).replace(/\r?\n/g, "\\\\\n");
    if (/\\(?:input|include|write|openout|read|catcode|csname|def|edef|gdef|xdef|newcommand|renewcommand|usepackage|documentclass|special|directlua|immediate)\b|\\(?:begin|end)\s*\{document\}/i.test(part.text)) throw new Error("公式包含不允许导出的 LaTeX 文件或执行命令，请先修改公式");
    return part.display ? `\\[${part.text}\\]` : `$${part.text}$`;
  }).join("");
}

/** UTF-8 source intended for local XeLaTeX; PDF export uses Chromium, not a TeX service. */
export function exportTex(exam: Exam, layout: Layout): string {
  const [w, h] = PAPER_MM[layout.paper];
  const [pw, ph] = layout.orientation === "portrait" ? [w, h] : [h, w];
  const questions = exam.sections.flatMap((s) => s.questions);
  const score = questions.reduce((sum, q) => sum + q.score, 0);
  const out = ["% 卷页 Studio：使用 XeLaTeX 编译。题图保存在卷页项目中，纯 .tex 不嵌入二进制图片。", "\\documentclass[UTF8,10pt]{ctexart}", `\\usepackage[paperwidth=${pw}mm,paperheight=${ph}mm,margin=${layout.margin}mm]{geometry}`, "\\usepackage{amsmath,amssymb,enumitem,array,longtable,tikz}", "\\usetikzlibrary{arrows.meta,calc,intersections,angles,quotes,positioning,3d}", "\\setlength{\\parindent}{0pt}", `\\AtBeginDocument{\\fontsize{${layout.fontSize}}{${(layout.fontSize * layout.lineHeight).toFixed(2)}}\\selectfont}`, `\\setlist[enumerate]{leftmargin=*,itemsep=${layout.questionGap === undefined ? layout.density === "compact" ? "3pt" : layout.density === "loose" ? "10pt" : "6pt" : `${layout.questionGap}mm`}}`, layout.pageNumber ? "\\pagestyle{plain}" : "\\pagestyle{empty}", "\\begin{document}", "\\begin{center}", `{\\Large\\bfseries ${escapeTex(exam.title || "未命名试卷")}}\\\\[5pt]`, escapeTex(exam.subtitle), `\\\\[5pt]考试时间：${exam.duration} 分钟\\quad 满分：${score} 分\\quad 共 ${questions.length} 题`, "\\end{center}", "学校：\\underline{\\hspace{25mm}}\\quad 班级：\\underline{\\hspace{20mm}}\\quad 姓名：\\underline{\\hspace{20mm}}"];
  if (exam.notice.length) out.push("\\paragraph{注意事项}", ...exam.notice.map((n, i) => `${i + 1}. ${texText(n)}\\par`));
  let n = 0;
  exam.sections.forEach((s, si) => {
    if (!s.questions.length) return;
    if (s.pageBreakBefore) out.push("\\clearpage");
    out.push(`\\section*{${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][si] ?? si + 1}、${escapeTex(s.title)}}`);
    out.push(s.note ? texText(s.note) : `本大题共 ${s.questions.length} 小题，共 ${s.questions.reduce((sum, q) => sum + q.score, 0)} 分。`);
    out.push(`\\begin{enumerate}[start=${n + 1},label=\\arabic*.]`);
    for (const q of s.questions) {
      n++;
      if (q.pageBreakBefore) out.push("\\clearpage");
      out.push(`\\item ${layout.showScore ? `（${q.score} 分）` : ""}${texText(stripQuestionNumber(q.stem))}`);
      if (q.drawing) out.push(texDrawing(q.drawing));
      if (questionFigures(q).length || q.image) out.push(`% 第 ${n} 题含题图：请从项目另行导出并使用 includegraphics 引入。`);
      if (hasOptions(q.type)) q.options.forEach((o, i) => out.push(`\\par ${String.fromCharCode(65 + i)}. ${texText(o)}`));
      if (layout.paperMode === "integrated" && isLongAnswer(q.type)) {
        const space = q.paperAnswerSpace ?? (q.answerSpace && q.answerSpace !== "auto" ? q.answerSpace : n >= 17 && n <= 19 ? "full" : "half");
        out.push(space === "full" ? "\\vfill\\clearpage" : `\\vspace{${space === "quarter" ? 35 : space === "auto" ? 20 : 65}mm}`);
      }
    }
    out.push("\\end{enumerate}");
  });
  if (layout.answerMode !== "none" && questions.some((q) => q.answer.length || (layout.answerMode !== "brief" && q.analysis.trim()))) {
    out.push("\\clearpage", "\\section*{参考答案与解析}");
    const quick = layout.quickAnswers === false ? [] : questions.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => hasOptions(q.type) || q.type === "blank");
    if (quick.length) {
      out.push("\\subsection*{选择、填空速对}", "\\begin{longtable}{|p{12mm}|p{\\dimexpr\\linewidth-22mm\\relax}|}", "\\hline 题号 & 答案 \\\\ \\hline");
      for (const { q, n: number } of quick) out.push(`${number} & ${q.answer.length ? q.answer.map(texText).join("；") : "待补充"} \\\\ \\hline`);
      out.push("\\end{longtable}");
    }
    questions.forEach((q, i) => {
      if (!q.answer.length && !q.analysis.trim()) return;
      out.push(`\\paragraph{第 ${i + 1} 题}`, `答案：${q.answer.length ? q.answer.map(texText).join("；") : "待补充"}\\par`);
      if (layout.answerMode !== "brief" && q.analysis.trim()) out.push(`解析：${texText(q.analysis)}\\par`);
    });
  }
  return out.concat("\\end{document}", "").join("\n");
}

export const importDefaultLayout = () => ({ ...defaultLayout });
