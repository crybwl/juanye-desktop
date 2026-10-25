import type { QType, Question, QuestionFigure } from "./types";
import { drawingSegments } from "./drawing";
import { mathSegments, normalizeMathDelimiters } from "./math";
import { splitOcrOptions } from "./ocr-options";
import { normalizeOcrMath } from "./text-normalization";

export type ImportKind = "questions" | "solutions" | "annotated";
export type SolutionPlacement = "after" | "end";
export interface ImportRequest { kind: ImportKind; placement?: SolutionPlacement }
export interface ImportedQuestion { number: number; question: Question }
export interface SolutionEntry {
  number: number;
  questionId?: string;
  importNumber?: number;
  answer?: string[];
  analysis?: string;
  type?: QType;
  score?: number;
  source?: string;
  knowledge?: string[];
  difficulty?: Question["difficulty"];
  options?: string[];
  drawing?: string;
  figure?: string;
  figures?: QuestionFigure[];
  sourceImage?: string;
  image?: Question["image"];
  answerSpace?: Question["answerSpace"];
  paperAnswerSpace?: Question["paperAnswerSpace"];
  pageBreakBefore?: boolean;
}
export interface ImportPlan { kind: ImportKind; questions: ImportedQuestion[]; solutions: SolutionEntry[]; warnings: string[] }

const types: QType[] = ["single", "multi", "judge", "blank", "essay", "material", "custom"];
const normalize = (value: string) => normalizeMathDelimiters(value.trim());
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const positiveInteger = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : undefined;
const safeString = (value: unknown, limit = 200000) => typeof value === "string" && value.length <= limit ? value : undefined;
const dataImage = (value: unknown) => typeof value === "string" && value.length <= 40 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(value) ? value : undefined;
const metaPattern = /<!--[ \t]*juanye-question[ \t]+([^]*?)[ \t]*-->/g;
const sectionPattern = /^[ \t]{0,3}(?:#{1,6}[ \t]+)?(?:[一二三四五六七八九十]+[、.．][ \t]*)?(单项选择题|单选题|多项选择题|多选题|填空题|解答题|计算题|判断题|材料题|自定义题型)[^\n]*$/gm;
const tailPattern = /^[ \t]{0,3}(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:[一二三四五六七八九十]+[、.．][ \t]*)?[【\[]?[ \t]*(?:参考答案(?:与解析|及解析|和解析|及试题解析)?|答案(?:与解析|及解析|和解析|解析|汇总)?|参考解析|试题解析|解析汇总)[ \t]*[】\]]?(?:\*\*|__)?[ \t]*[:：]?[ \t]*$/gm;

function inferType(value: unknown): QType | undefined {
  if (typeof value !== "string") return;
  if (types.includes(value as QType)) return value as QType;
  if (/多选|多项/.test(value)) return "multi";
  if (/单选|单项|选择题/.test(value)) return "single";
  if (/判断/.test(value)) return "judge";
  if (/填空/.test(value)) return "blank";
  if (/材料/.test(value)) return "material";
  if (/自定义/.test(value)) return "custom";
  if (/解答|计算|证明|简答/.test(value)) return "essay";
}

function safeMetadata(value: unknown): Partial<Question> & { questionId?: string; importNumber?: number } {
  const raw = record(value);
  if (!raw) return {};
  const meta: Partial<Question> & { questionId?: string; importNumber?: number } = {};
  const type = inferType(raw.type);
  if (type) meta.type = type;
  if (typeof raw.score === "number" && Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 1000) meta.score = raw.score;
  for (const key of ["source", "drawing", "flag"] as const) {
    const text = safeString(raw[key], key === "drawing" ? 32768 : 2000);
    if (text !== undefined) meta[key] = text;
  }
  if (Array.isArray(raw.knowledge) && raw.knowledge.length <= 100 && raw.knowledge.every(value => typeof value === "string" && value.length <= 2000)) meta.knowledge = raw.knowledge as string[];
  if (["easy", "medium", "hard"].includes(String(raw.difficulty))) meta.difficulty = raw.difficulty as Question["difficulty"];
  if (["auto", "quarter", "half", "full"].includes(String(raw.answerSpace))) meta.answerSpace = raw.answerSpace as Question["answerSpace"];
  if (["auto", "quarter", "half", "full"].includes(String(raw.paperAnswerSpace))) meta.paperAnswerSpace = raw.paperAnswerSpace as Question["paperAnswerSpace"];
  if (typeof raw.pageBreakBefore === "boolean") meta.pageBreakBefore = raw.pageBreakBefore;
  if (raw.image === "plot") meta.image = "plot";
  for (const key of ["figure", "sourceImage"] as const) {
    const image = dataImage(raw[key]);
    if (image) meta[key] = image;
  }
  if (Array.isArray(raw.figures) && raw.figures.length <= 8) {
    const figures: QuestionFigure[] = [];
    for (const value of raw.figures) {
      const figure = record(value), src = dataImage(figure?.src);
      if (!figure || !src || !["right", "half", "full"].includes(String(figure.layout))) continue;
      figures.push({ id: safeString(figure.id, 200) || crypto.randomUUID(), src, layout: figure.layout as QuestionFigure["layout"],
        ...(safeString(figure.caption, 2000) === undefined ? {} : { caption: figure.caption as string }),
        ...(typeof figure.width === "number" && figure.width >= 15 && figure.width <= 100 ? { width: figure.width } : {}),
        ...(typeof figure.maxHeight === "number" && figure.maxHeight >= 50 && figure.maxHeight <= 800 ? { maxHeight: figure.maxHeight } : {}) });
    }
    meta.figures = figures;
  }
  const questionId = safeString(raw.questionId ?? raw.id, 200);
  if (questionId) meta.questionId = questionId;
  const importNumber = positiveInteger(raw.importNumber);
  if (importNumber) meta.importNumber = importNumber;
  return meta;
}

/** Same-length masking protects formula environments, drawings and metadata from structural detection. */
function maskProtected(text: string): string {
  const hide = (raw: string) => raw.replace(/[^\n]/g, "\ufffc");
  let masked = drawingSegments(text).map(segment => {
    if (segment.kind === "tikz") return hide(segment.code);
    let offset = 0;
    return mathSegments(segment.text).map(part => {
      const delimiter = !part.math ? 0 : segment.text.startsWith("$$", offset) || segment.text.startsWith("\\[", offset) || segment.text.startsWith("\\(", offset) ? 2 : 1;
      const length = part.text.length + delimiter * 2;
      const raw = segment.text.slice(offset, offset + length);
      offset += length;
      return part.math ? hide(raw) : raw;
    }).join("");
  }).join("");
  masked = masked.replace(/<!--[^]*?-->/g, hide).replace(/^[ \t]*```[^\n]*\n[^]*?^[ \t]*```[ \t]*$/gm, hide);
  return masked;
}

interface NumberedBlock { number: number; body: string; start: number; context: string }
function numberedBlocks(text: string): NumberedBlock[] {
  const mask = maskProtected(text);
  const pattern = /^[ \t]{0,3}(?:#{1,6}[ \t]+)?(?:(?:\*\*|__)[ \t]*)?(?:第[ \t]*(\d{1,4})[ \t]*题[.．、:：]?|(\d{1,4})(?:(?:\*\*|__)[ \t]*)?[.．、](?!\d))(?:(?:\*\*|__)[ \t]*)?[ \t]*/gm;
  let marks = [...mask.matchAll(pattern)];
  // Our Markdown export has explicit heading boundaries; original numbered text inside a stem stays text.
  if (text.includes("<!-- juanye-question ") && marks.some(mark => /^[ \t]{0,3}#{1,6}[ \t]/.test(mark[0]))) marks = marks.filter(mark => /^[ \t]{0,3}#{1,6}[ \t]/.test(mark[0]) && /^[^\n]*\n[ \t\n]*<!--[ \t]*juanye-question[ \t]/.test(text.slice(mark.index! + mark[0].length)));
  return marks.map((mark, index) => ({ number: Number(mark[1] || mark[2]), start: mark.index!, context: text.slice(0, mark.index!), body: text.slice(mark.index! + mark[0].length, marks[index + 1]?.index ?? text.length).trim() }));
}

interface Parts {
  body: string;
  options?: string[];
  ownFields?: boolean;
  answer?: string[];
  analysis?: string;
  meta: Partial<Question> & { questionId?: string; importNumber?: number };
}
function answerValues(value: unknown, type?: QType): string[] {
  const values = (Array.isArray(value) ? value : [value]).filter((item): item is string | number => typeof item === "string" || typeof item === "number").map(item => normalize(String(item))).filter(Boolean);
  const letters = values.join(" ").replace(/\*\*|__|\$|\\\(|\\\)/g, "").trim();
  if ((!type || type === "single" || type === "multi" || type === "judge") && /^[A-Ha-h\s,，、;；]+$/.test(letters)) return [...new Set(letters.toUpperCase().match(/[A-H]/g) ?? [])];
  if (type === "judge" && values.length === 1) {
    if (/^(?:正确|对|√|true)$/i.test(values[0])) return ["A"];
    if (/^(?:错误|错|×|false)$/i.test(values[0])) return ["B"];
  }
  return values;
}

/** A choice key is short; prose following it belongs in the editable analysis, never a quick-answer cell. */
function choiceLead(value: string, type?: QType): { answer: string[]; analysis: string } | undefined {
  if (type && !["single", "multi", "judge"].includes(type)) return;
  const source = value.trim();
  const lead = /^(?:(?:\*\*|__)[ \t]*)?(?:\$|\\\()?([A-Ha-h](?:[ \t、,，]*[A-Ha-h]){0,7})(?:\$|\\\))?(?:[ \t]*(?:\*\*|__))?/.exec(source);
  if (!lead) return;
  const rest = source.slice(lead[0].length);
  // Do not turn an English word, a formula such as A+B, or arbitrary same-line prose into a choice key.
  if (rest && !/^(?:[ \t]*\n|[ \t]*[。．.、，,；;：:]|[ \t]*(?:[【［\[])?(?:解析|分析|详解|详细解析|方法|思路|解题思路|解答|证明|解)(?:[】］\]]|[ \t]*[:：]))/.test(rest)) return;
  const analysis = rest.replace(/^[ \t]*[。．.、，,；;：:][ \t]*/, "").trim();
  return { answer: answerValues(lead[1], type), analysis };
}

function parts(text: string): Parts {
  let meta: Parts["meta"] = {};
  let storedAnswers: string[] | undefined;
  let storedOptions: string[] | undefined;
  let clean = text.replace(metaPattern, (_, encoded: string) => {
    try {
      const value = JSON.parse(decodeURIComponent(encoded.trim()));
      meta = { ...meta, ...safeMetadata(value) };
      if (Array.isArray(value.answerParts) && value.answerParts.length <= 100 && value.answerParts.every((answer: unknown) => typeof answer === "string" && answer.length <= 200000)) storedAnswers = value.answerParts;
      if (Array.isArray(value.optionParts) && value.optionParts.length <= 26 && value.optionParts.every((option: unknown) => typeof option === "string" && option.length <= 200000)) storedOptions = value.optionParts;
    } catch { /* Invalid hidden metadata never executes or consumes visible content. */ }
    return "";
  }).replace(sectionPattern, "").trim();
  // External answer books often bold one complete summary line, not each individual label.
  // Unwrap only that whole-line container so its closing ** cannot leak into the analysis.
  clean = clean.replace(/^([ \t]{0,3})(\*\*|__)((?:参考答案|答案|参考结论|结论)[ \t]*[:：][^\n]*)\2[ \t]*$/gm, "$1$3");
  const ownFields = [...clean.matchAll(/<!--[ \t]*juanye-field[ \t]+(stem|options|answer|analysis)[ \t]*-->/g)];
  if (ownFields.length) {
    const contents = new Map<string, string>();
    for (const [index, field] of ownFields.entries()) contents.set(field[1], clean.slice(field.index! + field[0].length, ownFields[index + 1]?.index ?? clean.length).trim());
    const answerText = (contents.get("answer") || "").replace(/^【答案】[ \t]*(?:\n[ \t]*)*/, "");
    const analysis = (contents.get("analysis") || "").replace(/^【解析】[ \t]*(?:\n[ \t]*)*/, "");
    const answer = storedAnswers && normalize(storedAnswers.join("\n\n")) === normalize(answerText) ? storedAnswers.map(normalize) : answerValues(answerText, meta.type);
    const optionText = contents.get("options") || "";
    const sourceOptions = storedOptions?.flatMap((option, index) => [`${String.fromCharCode(65 + index)}. ${option}`, ""]).join("\n").trim();
    let options = storedOptions && sourceOptions === optionText ? storedOptions.map(normalize) : undefined;
    if (options === undefined && contents.has("options")) {
      const marks = [...maskProtected(optionText).matchAll(/^([A-Z])[.．][ \t]*/gm)];
      if (marks.length && marks.every((mark, index) => mark[1] === String.fromCharCode(65 + index))) options = marks.map((mark, index) => normalize(optionText.slice(mark.index! + mark[0].length, marks[index + 1]?.index ?? optionText.length)));
    }
    return { body: [clean.slice(0, ownFields[0].index).trim(), contents.get("stem"), options === undefined ? optionText : undefined].filter(Boolean).join("\n\n"), meta, ownFields: true,
      ...(options === undefined ? {} : { options }),
      ...(contents.has("answer") ? { answer } : {}), ...(contents.has("analysis") ? { analysis: normalize(analysis) } : {}) };
  }
  const combinedLabels = ["参考答案与解析", "参考答案及解析", "参考答案和解析", "答案与解析", "答案及解析", "答案和解析", "答案解析"];
  const labels = `${combinedLabels.join("|")}|参考答案|答案|参考结论|结论|详细解析|试题分析|解题思路|解析|分析|详解|方法|思路|解答|证明|解|题型|分值|分数|来源|知识点|难度`;
  const pattern = new RegExp(`(?:(?:(?:\\*\\*|__)[ \\t]*)?[【［\\[](${labels})[】］\\]][ \\t]*[:：]?|(?:^|\\n|(?<=[。；;]))[ \\t]*(?:\\*\\*|__)?(${labels})(?:\\*\\*|__)?[ \\t]*[:：])(?:\\*\\*|__)?[ \\t]*`, "gm");
  const mask = maskProtected(clean), marks = [...mask.matchAll(pattern)];
  const values = new Map<string, string[]>();
  for (const [index, mark] of marks.entries()) {
    const key = mark[1] || mark[2], value = clean.slice(mark.index! + mark[0].length, marks[index + 1]?.index ?? clean.length).trim();
    values.set(key, [...values.get(key) || [], value]);
  }
  const first = marks[0]?.index ?? clean.length;
  const body = clean.slice(0, first).trim();
  const collect = (...keys: string[]) => keys.flatMap(key => (values.get(key) || []).map(value => ["方法", "思路", "解题思路"].includes(key) && value ? `${key}：${value}` : value)).filter(Boolean).join("\n\n");
  const type = inferType(collect("题型"));
  if (type) meta.type = type;
  const scoreText = collect("分值", "分数").match(/\d+(?:\.\d+)?/);
  if (scoreText && Number(scoreText[0]) <= 1000) meta.score = Number(scoreText[0]);
  if (values.has("来源")) meta.source = collect("来源");
  if (values.has("知识点")) meta.knowledge = collect("知识点").split(/[,，、;；\n]/).map(value => value.trim()).filter(Boolean);
  const difficulty = collect("难度");
  if (/^(?:基础|容易|简单|easy)$/i.test(difficulty)) meta.difficulty = "easy";
  else if (/^(?:中等|适中|medium)$/i.test(difficulty)) meta.difficulty = "medium";
  else if (/^(?:较难|困难|难|hard)$/i.test(difficulty)) meta.difficulty = "hard";
  const combined = collect(...combinedLabels);
  const combinedChoice = combined ? choiceLead(combined, meta.type) : undefined;
  const hasAnswer = values.has("答案") || values.has("参考答案") || values.has("结论") || values.has("参考结论") || !!combinedChoice;
  const hasAnalysisLabel = ["解析", "分析", "详解", "详细解析", "试题分析", "方法", "思路", "解题思路", "解答", "证明", "解"].some(key => values.has(key));
  const rawAnswerText = collect("参考答案", "答案", "参考结论", "结论");
  // A sentence stop immediately before 方法： separates fields; it is not part of a formula answer.
  const answerText = hasAnalysisLabel ? rawAnswerText.replace(/[。；;][ \t\n]*$/, "").trim() : rawAnswerText;
  const stored = storedAnswers && normalize(storedAnswers.join("\n\n")) === normalize(answerText);
  const separated = !stored && hasAnswer ? choiceLead(answerText, meta.type) : undefined;
  const answer = stored ? storedAnswers!.map(normalize) : separated?.answer ?? (answerText ? answerValues(answerText, meta.type) : combinedChoice?.answer ?? []);
  const analysis = [separated?.analysis, combinedChoice?.analysis ?? combined, collect("解析", "分析", "详解", "详细解析", "试题分析", "方法", "思路", "解题思路", "解答", "证明", "解")].filter(Boolean).join("\n\n");
  return { body, meta, ...(hasAnswer ? { answer } : {}), ...(analysis ? { analysis: normalize(analysis) } : {}) };
}

function embeddedFigures(stem: string, meta: Partial<Question>, number: number, warnings: string[]): { stem: string; figures?: QuestionFigure[] } {
  const pattern = /!\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)/g;
  const figures = [...meta.figures || []], known = new Set([meta.figure, ...figures.map(figure => figure.src)].filter(Boolean));
  const removals: { start: number; end: number }[] = [];
  for (const mark of maskProtected(stem).matchAll(pattern)) {
    const original = stem.slice(mark.index!, mark.index! + mark[0].length).match(pattern)?.[0];
    if (!original) continue;
    const detail = /^!\[((?:\\.|[^\]\\\n])*)\]\(([^\s)]+)\)$/.exec(original);
    if (!detail) continue;
    const src = dataImage(detail[2]);
    if (!src) { warnings.push(`第 ${number} 题包含未嵌入的图片，外部图片不会自动加载，请手动补图。`); continue; }
    if (!known.has(src)) {
      if (figures.length >= 8) { warnings.push(`第 ${number} 题超过 8 张题图，其余图片引用保留在原文中，请核对。`); continue; }
      const caption = detail[1].replace(/\\([\[\]\\])/g, "$1");
      figures.push({ id: crypto.randomUUID(), src, layout: "right", ...(caption ? { caption } : {}) });
      known.add(src);
    }
    removals.push({ start: mark.index!, end: mark.index! + mark[0].length });
  }
  for (const removal of removals.reverse()) stem = stem.slice(0, removal.start) + stem.slice(removal.end);
  return { stem: stem.replace(/\n{3,}/g, "\n\n").trim(), ...(figures.length || meta.figures ? { figures } : {}) };
}

function questionFrom(block: NumberedBlock, warnings: string[]): ImportedQuestion | undefined {
  const parsed = parts(block.body);
  let stem = parsed.body;
  const score = stem.match(/^[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）][ \t]*/);
  if (score) { if (parsed.meta.score === undefined && Number(score[1]) <= 1000) parsed.meta.score = Number(score[1]); stem = stem.slice(score[0].length); }
  const headings = [...block.context.matchAll(sectionPattern)];
  const hinted = inferType(headings.at(-1)?.[1]);
  const split = parsed.options === undefined ? splitOcrOptions(stem) : undefined;
  const options = parsed.options ?? (split?.stem ? split.options.map(option => normalizeOcrMath(option, true)) : []);
  if (split?.stem) stem = split.stem;
  if (!stem.trim()) { warnings.push(`第 ${block.number} 题没有题干，未新建。`); return; }
  let type = parsed.meta.type ?? hinted ?? (options.length ? "single" : /_{3,}|填空/.test(stem) ? "blank" : "essay");
  const answer = answerValues(parsed.answer || [], type);
  if (!parsed.meta.type && !hinted && options.length && answer.length > 1 && answer.every(value => /^[A-H]$/.test(value))) type = "multi";
  const { questionId: _questionId, ...metadata } = parsed.meta;
  const pictures = embeddedFigures(stem, metadata, block.number, warnings);
  const question = {
    ...metadata, id: crypto.randomUUID(), type,
    score: parsed.meta.score ?? ({ single: 5, multi: 6, blank: 5, essay: 12, judge: 2, material: 15, custom: 5 })[type],
    ...pictures, stem: normalize(pictures.stem), options: type === "judge" && !options.length ? ["正确", "错误"] : options,
    answer, analysis: parsed.analysis || "", importNumber: parsed.meta.importNumber ?? block.number,
  } as Question;
  return { number: block.number, question };
}

function solutionFrom(block: NumberedBlock): SolutionEntry | undefined {
  const parsed = parts(block.body);
  let answer = parsed.answer, analysis = parsed.analysis;
  const unlabelled = parsed.ownFields ? "" : parsed.body.trim();
  const shorthand = unlabelled ? choiceLead(unlabelled.replace(/^(?:[（(]\d+(?:\.\d+)?\s*分[)）])\s*/, ""), parsed.meta.type) : undefined;
  if (shorthand && answer === undefined) {
    answer = shorthand.answer;
    analysis = [shorthand.analysis, analysis].filter(Boolean).join("\n\n") || undefined;
  } else if (unlabelled && answer === undefined && analysis === undefined) {
    const lines = unlabelled.split("\n");
    const first = lines[0].replace(/^(?:[（(]\d+(?:\.\d+)?\s*分[)）])\s*/, "").trim();
    const letters = answerValues(first, parsed.meta.type);
    if (answer === undefined && letters.length && letters.every(value => /^[A-H]$/.test(value))) {
      answer = letters;
      if (lines.length > 1) analysis = [lines.slice(1).join("\n").trim(), analysis].filter(Boolean).join("\n\n");
    } else if (!analysis && !answer && lines.length === 1 && /^\$[^$]+\$$|^[-+]?\d+(?:\.\d+)?%?$/.test(first)) answer = [normalize(first)];
    else analysis = [normalize(unlabelled), analysis].filter(Boolean).join("\n\n");
  }
  if (answer === undefined && analysis === undefined) return;
  const { id: _id, ...meta } = parsed.meta;
  return { ...meta, number: block.number, ...(answer === undefined ? {} : { answer }), ...(analysis === undefined ? {} : { analysis }) };
}

function cells(line: string): string[] {
  const mask = maskProtected(line), breaks: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === "|") {
    let slashes = 0;
    for (let j = i - 1; j >= 0 && mask[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) breaks.push(i);
  }
  if (!breaks.length) return [];
  const parts: string[] = []; let previous = 0;
  for (const at of breaks) { parts.push(line.slice(previous, at).trim()); previous = at + 1; }
  parts.push(line.slice(previous).trim());
  if (!parts[0]) parts.shift();
  if (!parts.at(-1)) parts.pop();
  return parts;
}
const unmark = (text: string) => text.replace(/\*\*|__|\$|[【】]/g, "").trim();
function tableCellText(text: string): string {
  // DOCX cell paragraphs use this one inert line-break marker. Preserve LaTeX and escaped literal pipes.
  const mask = maskProtected(text);
  let result = text;
  for (const match of [...mask.matchAll(/<br[ \t]*\/?>/gi)].reverse()) result = result.slice(0, match.index) + "\n" + result.slice(match.index! + match[0].length);
  for (const match of [...maskProtected(result).matchAll(/\\\|/g)].reverse()) result = result.slice(0, match.index) + "|" + result.slice(match.index! + match[0].length);
  return result.trim();
}
function tableSolutions(text: string): { entries: SolutionEntry[]; remaining: string } {
  const lines = text.split("\n"), result: SolutionEntry[] = [], remaining = [...lines];
  for (let i = 0; i + 2 < lines.length; i++) {
    const header = cells(lines[i]), separator = cells(lines[i + 1]);
    if (header.length < 2 || separator.length !== header.length || !separator.every(value => /^:?-{3,}:?$/.test(value))) continue;
    const rows: string[][] = [];
    let end = i + 2;
    while (end < lines.length && cells(lines[end]).length === header.length) rows.push(cells(lines[end++]));
    const names = header.map(unmark);
    const entries: SolutionEntry[] = [];
    if (/^(?:题号|题目)$/.test(names[0]) && names.slice(1).every(value => /^\d+$/.test(value))) {
      for (let column = 1; column < names.length; column++) {
        const body: string[] = [];
        for (const row of rows) {
          const label = unmark(row[0]);
          if (/^(?:答案|参考答案|解析|分析|详解|解答)$/.test(label) && row[column]) body.push(`【${label}】${tableCellText(row[column])}`);
        }
        const entry = solutionFrom({ number: Number(names[column]), body: body.join("\n"), start: 0, context: "" });
        if (entry) entries.push(entry);
      }
    } else {
      const numberColumns = names.flatMap((value, column) => /^(?:题号|题目|序号|编号|题目编号)$/.test(value) ? [column] : []);
      for (const [group, numberColumn] of numberColumns.entries()) {
        const groupEnd = numberColumns[group + 1] ?? names.length;
        const columnFor = (pattern: RegExp) => names.findIndex((value, column) => column > numberColumn && column < groupEnd && pattern.test(value));
        const answerColumn = columnFor(/^(?:答案|参考答案)$/);
        const analysisColumn = columnFor(/^(?:解析|分析|详解|详细解析|解答|解题思路)$/);
        const combinedColumn = columnFor(/^(?:(?:参考)?答案(?:(?:与|及|和)?(?:试题)?解析|(?:与|及|和)详解))$/);
        if (answerColumn < 0 && analysisColumn < 0 && combinedColumn < 0) continue;
        for (const row of rows) {
          const number = Number(unmark(row[numberColumn]));
          if (!positiveInteger(number)) continue;
          const body = [answerColumn >= 0 && row[answerColumn] ? `【答案】${tableCellText(row[answerColumn])}` : "", analysisColumn >= 0 && row[analysisColumn] ? `【解析】${tableCellText(row[analysisColumn])}` : "", combinedColumn >= 0 ? tableCellText(row[combinedColumn]) : ""];
          // Metadata columns use the same field parser as per-question imports.
          names.forEach((label, column) => { if (column > numberColumn && column < groupEnd && /^(?:题型|分值|分数|来源|知识点|难度)$/.test(label) && row[column]) body.push(`【${label}】${tableCellText(row[column])}`); });
          const entry = solutionFrom({ number, body: body.filter(Boolean).join("\n"), start: 0, context: "" });
          if (entry) entries.push(entry);
        }
      }
      // Layout-only answer tables have no semantic header: every cell must have its own explicit question
      // number AND a solution marker or a short choice key. Never infer answers from an ordinary data table.
      if (!numberColumns.length) {
        const values = [header, ...rows].flat().map(tableCellText).filter(Boolean);
        const layoutEntries: SolutionEntry[] = [];
        const reliable = values.length > 0 && values.every(value => {
          const blocks = numberedBlocks(value);
          if (!blocks.length || blocks[0].start !== 0) return false;
          for (const block of blocks) {
            const parsed = parts(block.body);
            if (parsed.answer === undefined && parsed.analysis === undefined && !choiceLead(parsed.body, parsed.meta.type)) return false;
            const entry = solutionFrom(block);
            if (!entry) return false;
            layoutEntries.push(entry);
          }
          return true;
        });
        if (reliable) entries.push(...layoutEntries);
      }
    }
    if (entries.length) { result.push(...entries); remaining.fill("", i, end); }
    i = end - 1;
  }
  return { entries: result, remaining: remaining.join("\n") };
}

function mergeSolutions(entries: SolutionEntry[], warnings: string[]): SolutionEntry[] {
  const byNumber = new Map<number, SolutionEntry>();
  const conflicts = new Set<number>();
  for (const entry of entries) {
    if (conflicts.has(entry.number)) continue;
    const previous = byNumber.get(entry.number);
    if (!previous) { byNumber.set(entry.number, entry); continue; }
    const answerConflict = previous.answer?.length && entry.answer?.length && JSON.stringify(previous.answer) !== JSON.stringify(entry.answer);
    const analysisConflict = previous.analysis && entry.analysis && previous.analysis !== entry.analysis;
    if (answerConflict || analysisConflict) {
      warnings.push(`第 ${entry.number} 题存在不同的重复答案或解析，已暂停该题匹配，请核对原文件。`);
      byNumber.delete(entry.number); conflicts.add(entry.number); continue;
    }
    byNumber.set(entry.number, { ...previous, ...entry, answer: entry.answer?.length ? entry.answer : previous.answer, analysis: entry.analysis || previous.analysis });
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function parseSolutions(text: string, warnings: string[]): SolutionEntry[] {
  const entries: SolutionEntry[] = [];
  const tables = tableSolutions(text);
  const remaining = tables.remaining.split("\n").map(line => {
    const marks = [...line.matchAll(/(?<![^\s;；,，])(\d{1,4})[.．、:：][ \t]*([A-Ha-h](?:[、,，]?[A-Ha-h])*)(?=[ \t]*(?:$|[;；,，]|\d{1,4}[.．、:：]))/g)];
    if (marks.length < 2) return line;
    for (const mark of marks) entries.push({ number: Number(mark[1]), answer: answerValues(mark[2]) });
    return "";
  }).join("\n");
  entries.push(...numberedBlocks(remaining).map(solutionFrom).filter((entry): entry is SolutionEntry => !!entry));
  return mergeSolutions([...tables.entries, ...entries], warnings);
}

function tailHeading(text: string): RegExpMatchArray | undefined {
  for (const heading of maskProtected(text).matchAll(tailPattern)) {
    if (/解析|汇总/.test(heading[0])) return heading;
    const after = text.slice(heading.index! + heading[0].length).trimStart();
    const firstNumber = numberedBlocks(after)[0];
    if (firstNumber?.start === 0 || /^[|\s]*(?:题号|题目)\s*\|/m.test(after.split("\n").slice(0, 3).join("\n"))) return heading;
  }
}

function parseJson(text: string, request: ImportRequest): ImportPlan | undefined {
  if (!/^[\[{]/.test(text)) return;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("JSON 文件不完整，请修复后重试。"); }
  const root = record(parsed), exam = record(root?.exam), nested = record(root?.data);
  const questionValues = Array.isArray(parsed) ? parsed : root?.questions ?? root?.items ?? nested?.questions ?? (Array.isArray(exam?.sections) ? exam.sections.flatMap(value => { const section = record(value); return Array.isArray(section?.questions) ? section.questions : []; }) : undefined);
  const values = request.kind === "solutions" ? root?.solutions ?? root?.answers ?? questionValues : questionValues;
  const list = Array.isArray(values) ? values : record(values) ? Object.entries(values as Record<string, unknown>).map(([number, value]) => ({ number: Number(number), ...(record(value) || { answer: value }) })) : undefined;
  if (!list) throw new Error("JSON 中没有题目或解析列表。");
  if (list.length > 2000) throw new Error("一次最多导入 2000 道题。");
  const plan: ImportPlan = { kind: request.kind, questions: [], solutions: [], warnings: [] };
  for (const [index, value] of list.entries()) {
    const raw = record(value);
    if (!raw) { plan.warnings.push(`第 ${index + 1} 项不是完整题目对象，未导入。`); continue; }
    const metadata = safeMetadata(raw), number = positiveInteger(raw.number ?? raw.questionNumber ?? raw.importNumber) ?? (request.kind === "solutions" ? undefined : index + 1);
    if (!number) { plan.warnings.push(`第 ${index + 1} 条解析缺少题号，未自动匹配。`); continue; }
    const type = metadata.type ?? "essay";
    const answer = raw.answer ?? raw.answers;
    const choice = typeof answer === "string" ? choiceLead(answer, metadata.type) : Array.isArray(answer) && answer.length === 1 && typeof answer[0] === "string" ? choiceLead(answer[0], metadata.type) : undefined;
    const explicitAnalysis = safeString(raw.analysis ?? raw.analyze ?? raw.explanation);
    const analysis = [choice?.analysis, explicitAnalysis].filter(Boolean).join("\n\n") || (explicitAnalysis === undefined ? undefined : "");
    const optionsValue = raw.options ?? raw.choices;
    const options = Array.isArray(optionsValue) ? optionsValue.filter((item): item is string => typeof item === "string").map(value => normalizeOcrMath(value, true)) : [];
    if (request.kind === "solutions") {
      const { id: _id, ...meta } = metadata;
      plan.solutions.push({ ...meta, number, ...(answer === undefined ? {} : { answer: choice?.answer ?? answerValues(answer, metadata.type) }), ...(analysis === undefined ? {} : { analysis: normalize(analysis) }), ...(options.length ? { options } : {}) });
      continue;
    }
    const stem = safeString(raw.stem ?? raw.text ?? raw.question ?? raw.content);
    if (!stem?.trim()) { plan.warnings.push(`第 ${number} 题缺少题干，未新建。`); continue; }
    const split = !options.length ? splitOcrOptions(stem) : undefined;
    const { questionId: _questionId, ...meta } = metadata;
    const answers = choice?.answer ?? answerValues(answer, metadata.type);
    const choiceOptions = options.length ? options : split?.options.map(option => normalizeOcrMath(option, true)) || [];
    const actualType = metadata.type ?? (choiceOptions.length ? answers.length > 1 && answers.every(value => /^[A-H]$/.test(value)) ? "multi" : "single" : type);
    const pictures = embeddedFigures(split?.stem || stem, meta, number, plan.warnings);
    const q = { ...meta, ...pictures, id: crypto.randomUUID(), type: actualType, score: metadata.score ?? ({ single: 5, multi: 6, blank: 5, essay: 12, judge: 2, material: 15, custom: 5 })[actualType], stem: normalize(pictures.stem), options: choiceOptions, answer: request.kind === "questions" ? [] : answers, analysis: request.kind === "questions" ? "" : normalize(analysis || ""), importNumber: metadata.importNumber ?? number } as Question;
    plan.questions.push({ number, question: q });
  }
  plan.solutions = mergeSolutions(plan.solutions, plan.warnings);
  return plan;
}

export function parsePaperImport(raw: string, request: ImportRequest): ImportPlan {
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  text = text.replace(/^```(?:json|markdown|md|text|txt)?[ \t]*\n([^]*?)\n```[ \t]*$/i, "$1").trim();
  // A final, explicitly separated source citation is document metadata, not the last question's solution.
  for (const separator of [...maskProtected(text).matchAll(/^[ \t]{0,3}-{3,}[ \t]*$/gm)].reverse()) {
    const footer = text.slice(separator.index! + separator[0].length).trim();
    if (/^题目依据[ \t]*[:：][^\n]*\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)[^\n]*$/.test(footer)) text = text.slice(0, separator.index).trimEnd();
    break;
  }
  if (!text) throw new Error("文件中没有可导入的内容。");
  if (request.kind === "annotated" && !request.placement) throw new Error("请选择解析在题后还是集中在卷尾。");
  const json = parseJson(text, request);
  if (json) return json;
  const plan: ImportPlan = { kind: request.kind, questions: [], solutions: [], warnings: [] };
  if (request.kind === "solutions") {
    plan.solutions = parseSolutions(text, plan.warnings);
    if (!plan.solutions.length && !plan.warnings.length) throw new Error("没有找到带题号的答案或解析，请使用“1. 答案：…”或答案表格式。");
    return plan;
  }
  const tail = tailHeading(text);
  let questionText = tail ? text.slice(0, tail.index) : text;
  let solutionText = tail ? text.slice(tail.index! + tail[0].length) : "";
  if (tail && !numberedBlocks(questionText).length && questionText.split("\n").every(line => !line.trim() || /^[ \t]{0,3}#{1,6}[ \t]/.test(line)) && numberedBlocks(solutionText).length) throw new Error("这个文件只有答案解析，请使用“导入解析文件”匹配现有题目。");
  if (request.kind === "annotated" && request.placement === "after" && tail) throw new Error("检测到卷尾答案区，请选择“答案解析集中在卷尾”后导入。");
  if (request.kind === "annotated" && request.placement === "end" && !tail) {
    const blocks = numberedBlocks(text);
    const restart = blocks.findIndex((block, index) => index > 0 && block.number <= blocks[index - 1].number);
    if (restart > 0) {
      questionText = text.slice(0, blocks[restart].start); solutionText = text.slice(blocks[restart].start);
      plan.warnings.push("未找到卷尾标题，已按题号重新开始处分隔，请核对题目与解析。");
    } else throw new Error("未找到卷尾答案解析区。请添加“参考答案与解析”标题，或选择“答案解析在题后”。");
  }
  let blocks = numberedBlocks(questionText);
  if (!blocks.length) blocks = [{ number: 1, body: questionText, start: 0, context: "" }];
  if (blocks.length > 2000) throw new Error("一次最多导入 2000 道题。");
  const used = new Set<number>();
  for (const block of blocks) {
    if (used.has(block.number)) throw new Error(`题目区出现重复的第 ${block.number} 题，请核对题号或答案解析的位置。`);
    used.add(block.number);
    const imported = questionFrom(block, plan.warnings);
    if (!imported) continue;
    if (request.kind === "questions" || request.placement === "end") imported.question = { ...imported.question, answer: [], analysis: "" };
    plan.questions.push(imported);
  }
  if (request.kind === "annotated" && request.placement === "end") {
    const entries = parseSolutions(solutionText, plan.warnings);
    const matched = new Set<number>();
    for (const entry of entries) {
      const target = plan.questions.find(question => question.number === entry.number);
      if (!target) { plan.warnings.push(`卷尾第 ${entry.number} 题解析没有对应题目，未自动写入。`); plan.solutions.push(entry); continue; }
      const { number: _number, questionId: _questionId, importNumber: _importNumber, ...patch } = entry;
      target.question = { ...target.question, ...patch };
      matched.add(entry.number);
    }
    for (const item of plan.questions) if (!matched.has(item.number)) plan.warnings.push(`第 ${item.number} 题未找到卷尾答案解析。`);
  }
  if (!plan.questions.length) throw new Error("没有找到完整题目，请核对文件内容。");
  return plan;
}
