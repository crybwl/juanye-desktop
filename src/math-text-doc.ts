/**
 * 试卷题目字段（Markdown + $…$ 字符串）与可视编辑文档（ProseMirror JSON）之间的无损转换。
 * 只覆盖能原样往返的内容：文字、换行、$…$ / \(…\) 行内公式、$$…$$ / \[…\] 独立公式；
 * 表格、TikZ、HTML 换行、Markdown 强调等交给源码编辑，避免静默改写题目。
 */
import { extractTikzBlocks } from "./drawing";
import type { RichDoc, RichNode } from "./workbook/rich";

type Delim = "$" | "\\(" | "$$" | "\\[";
const CLOSE: Record<Delim, string> = { "$": "$", "\\(": "\\)", "$$": "$$", "\\[": "\\]" };

interface Segment { text: string; math?: { latex: string; delim: Delim } }

const escapedAt = (src: string, at: number) => {
  let count = 0;
  for (let i = at - 1; i >= 0 && src[i] === "\\"; i--) count++;
  return count % 2 === 1;
};

/** 与 math.tsx 的 mathSegments 同一识别规则，但保留原始定界符。 */
export function segmentMath(src: string): Segment[] {
  const out: Segment[] = [];
  let plainStart = 0;
  for (let i = 0; i < src.length; i++) {
    if (escapedAt(src, i)) continue;
    const open: Delim | "" = src.startsWith("$$", i) ? "$$" : src.startsWith("\\[", i) ? "\\[" : src.startsWith("\\(", i) ? "\\(" : src[i] === "$" ? "$" : "";
    if (!open) continue;
    const close = CLOSE[open];
    let end = i + open.length;
    while ((end = src.indexOf(close, end)) !== -1) {
      if (!escapedAt(src, end) && !(open === "$" && (src[end + 1] === "$" || src[end - 1] === "$"))) break;
      end += close.length;
    }
    if (end === -1) { if (open === "$$") i++; continue; }
    if (i > plainStart) out.push({ text: src.slice(plainStart, i) });
    out.push({ text: "", math: { latex: src.slice(i + open.length, end), delim: open } });
    i = end + close.length - 1;
    plainStart = i + 1;
  }
  if (plainStart < src.length) out.push({ text: src.slice(plainStart) });
  return out;
}

export function mathTextToDoc(src: string): RichDoc {
  const paragraphs: RichNode[][] = [[]];
  for (const segment of segmentMath(src)) {
    if (segment.math) {
      const display = segment.math.delim === "$$" || segment.math.delim === "\\[";
      paragraphs[paragraphs.length - 1].push({ type: "inlineMath", attrs: { latex: segment.math.latex, display, delim: segment.math.delim } });
      continue;
    }
    segment.text.split("\n").forEach((line, index) => {
      if (index > 0) paragraphs.push([]);
      if (line) paragraphs[paragraphs.length - 1].push({ type: "text", text: line });
    });
  }
  return { type: "doc", content: paragraphs.map(content => content.length ? { type: "paragraph", content } : { type: "paragraph" }) };
}

export function docToMathText(doc: RichDoc): string {
  const inline = (node: RichNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "inlineMath") {
      const delim = (node.attrs?.delim as Delim | undefined) ?? (node.attrs?.display ? "$$" : "$");
      return `${delim}${String(node.attrs?.latex ?? "")}${CLOSE[delim] ?? delim}`;
    }
    return (node.content ?? []).map(inline).join("");
  };
  return doc.content.map(paragraph => (paragraph.content ?? []).map(inline).join("")).join("\n");
}

const TABLE_LINE = /^\s*\|.*\|\s*$/m;
const EMPHASIS = /\*\*|(^|[^\\])\*[^*\s]/;
const HTML_BREAK = /<br\s*\/?\s*>/i;

/** 能否可视编辑：不含表格 / TikZ / HTML 换行 / 强调标记，且转换往返后与原文一致。 */
export function canEditVisually(src: string): boolean {
  if (!src) return true;
  if (extractTikzBlocks(src).length || HTML_BREAK.test(src)) return false;
  const plainParts = segmentMath(src).filter(segment => !segment.math).map(segment => segment.text).join("\u0000");
  if (TABLE_LINE.test(plainParts) || EMPHASIS.test(plainParts)) return false;
  return docToMathText(mathTextToDoc(src)) === src;
}
