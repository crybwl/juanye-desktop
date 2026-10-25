import katex from "katex";
import MarkdownIt from "markdown-it";
import { memo, useMemo } from "react";
import { drawingSegments, extractTikzBlocks, stripTikzBlocks } from "./drawing";
import { TikzDrawing } from "./TikzDrawing";
import { StringLruCache } from "./string-lru";

export interface MathSegment { text: string; math: boolean; display: boolean }
const escapedAt = (src: string, at: number) => {
  let count = 0;
  for (let i = at - 1; i >= 0 && src[i] === "\\"; i--) count++;
  return count % 2 === 1;
};

/** Recognise complete delimiters only; leave unmatched OCR output visible for correction. */
export function mathSegments(src: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let plainStart = 0;
  for (let i = 0; i < src.length; i++) {
    if (escapedAt(src, i)) continue;
    const open = src.startsWith("$$", i) ? "$$" : src.startsWith("\\[", i) ? "\\[" : src.startsWith("\\(", i) ? "\\(" : src[i] === "$" ? "$" : "";
    if (!open) continue;
    const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
    let end = i + open.length;
    while ((end = src.indexOf(close, end)) !== -1) {
      if (!escapedAt(src, end) && !(open === "$" && (src[end + 1] === "$" || src[end - 1] === "$"))) break;
      end += close.length;
    }
    if (end === -1) { if (open === "$$") i++; continue; }
    if (i > plainStart) segments.push({ text: src.slice(plainStart, i), math: false, display: false });
    segments.push({ text: src.slice(i + open.length, end), math: true, display: open === "$$" || open === "\\[" });
    i = end + close.length - 1;
    plainStart = i + 1;
  }
  if (plainStart < src.length) segments.push({ text: src.slice(plainStart), math: false, display: false });
  return segments;
}

export function normalizeMathDelimiters(src: string): string {
  return mathSegments(src).map((s) => s.math ? s.display ? `\\[${s.text}\\]` : `$${s.text}$` : s.text).join("");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const esc = (s: string) => escapeHtml(s).replace(/_{3,}/g, '<span class="q-blank"></span>').replace(/\r?\n/g, "<br/>");
// Budgets count source keys and HTML values as UTF-16 payload; entry limits also bound Map overhead.
const cache = new StringLruCache(4096, 16 * 1024 * 1024);
const formulaCache = new StringLruCache(8192, 12 * 1024 * 1024);
function renderFormula(text: string, displayMode: boolean): string {
  const source = text.trim();
  const key = `${displayMode ? "display" : "inline"}\u0000${source}`;
  const hit = formulaCache.get(key);
  if (hit !== undefined) return hit;
  const html = katex.renderToString(source, {
    throwOnError: false, displayMode, strict: "ignore", trust: false,
    maxExpand: 1000, maxSize: 20, output: "htmlAndMathml",
  });
  formulaCache.set(key, html);
  return html;
}
// Shipped in the application bundle. No HTML, external images, links, scripts, or CDN dependencies.
const markdown = new MarkdownIt("zero", { html: false, breaks: true, linkify: false, typographer: false })
  .enable(["table", "emphasis", "newline", "escape", "entity"]);
// Keep single inline answers inline, and keep the existing compact spacing between question paragraphs.
markdown.renderer.rules.paragraph_open = () => "";
markdown.renderer.rules.paragraph_close = (tokens, index) => index < tokens.length - 1 && tokens[index + 1].type !== "table_open" ? "<br/><br/>" : "";
markdown.renderer.rules.table_open = () => '<table class="math-table">\n';
markdown.renderer.rules.text = (tokens, index) => escapeHtml(tokens[index].content).replace(/_{3,}/g, '<span class="q-blank"></span>');

export function renderMathText(src: string): string {
  const hit = cache.get(src);
  if (hit !== undefined) return hit;
  const protectedHtml: string[] = [];
  let marker = "\ue000";
  while (src.includes(marker)) marker += "\ue002";
  const protect = (html: string) => `${marker}${protectedHtml.push(html) - 1}\ue001`;
  // Protect entire math spans BEFORE Markdown sees pipes, underscores, or multiline environments.
  const protectedText = drawingSegments(src).map(segment => segment.kind === "tikz" ? protect(esc(segment.code)) : mathSegments(segment.text).map(s => !s.math ? s.text.replace(/<br\s*\/?\s*>/gi, () => protect("<br/>")) : protect(renderFormula(s.text, s.display))).join("")).join("");
  const out = markdown.render(protectedText).trimEnd().replace(new RegExp(`${marker}(\\d+)\ue001`, "g"), (_, index: string) => protectedHtml[Number(index)]);
  cache.set(src, out);
  return out;
}

export const MathText = memo(function MathText({
  text,
  className,
  placeholder,
}: {
  text: string;
  className?: string;
  placeholder?: string;
}) {
  const html = useMemo(() => renderMathText(text), [text]);
  const Tag = html.includes('<table class="math-table"') ? "div" : "span";
  const classes = `math-text${Tag === "div" ? " math-block" : ""}${className ? ` ${className}` : ""}`;
  if (!text.trim() && placeholder)
    return <span className={`${className ?? ""} text-faint italic`}>{placeholder}</span>;
  if (extractTikzBlocks(text).length) return <Tag className={classes}>{drawingSegments(text).map((segment, index) => segment.kind === "tikz" ? <TikzDrawing key={index} code={segment.code} /> : <MathText key={index} text={segment.text} />)}</Tag>;
  return <Tag className={classes} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** 去掉 LaTeX 后的纯文本（用于搜索、长度估算） */
export function plain(src: string) {
  src = stripTikzBlocks(src);
  return mathSegments(src).map((s) => s.math ? s.text.replace(/\\(?:dfrac|frac)\{([^}]*)\}\{([^}]*)\}/g, "$1/$2").replace(/\\[a-zA-Z]+/g, "").replace(/[{}\\]/g, "") : s.text).join("").replace(/\s+/g, " ").trim();
}

/** 编辑器语法高亮：公式、命令、括号 */
export function highlightTex(src: string) {
  return mathSegments(src).map((s) => {
    if (!s.math) return escapeHtml(s.text).replace(/_{3,}/g, (m) => `<span class="hl-blank">${m}</span>`);
    const marked = escapeHtml(s.display ? `\\[${s.text}\\]` : `$${s.text}$`).replace(/(\\[a-zA-Z]+)/g, '<span class="hl-cmd">$1</span>').replace(/([{}])/g, '<span class="hl-brace">$1</span>');
    return `<span class="hl-math">${marked}</span>`;
  }).join("") + "\n";
}
