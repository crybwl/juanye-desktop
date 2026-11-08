import katex from "katex";
import "katex/contrib/mhchem";
import { renderMathText } from "../math";
import { StringLruCache } from "../string-lru";

const cache = new StringLruCache(4096, 8 * 1024 * 1024);

/** 与试卷同一套 KaTeX 参数；额外启用 mhchem（\ce{}）用于理化方程式。 */
export function formulaHtml(latex: string, display = false): string {
  const source = latex.trim();
  const key = `${display ? "d" : "i"}\u0000${source}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const html = katex.renderToString(source, { throwOnError: false, displayMode: display, strict: "ignore", trust: false, maxExpand: 1000, maxSize: 20, output: "htmlAndMathml" });
  cache.set(key, html);
  return html;
}

export function formulaError(latex: string): string {
  if (!latex.trim()) return "";
  try { katex.renderToString(latex, { throwOnError: true, strict: "ignore", trust: false, maxExpand: 1000, maxSize: 20 }); return ""; }
  catch (error) { return error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, "") : "公式有误"; }
}

/** 填空答案可含 `$...$`。 */
export const inlineAnswerHtml = (text: string) => renderMathText(text);

/** 化学式快捷写法：2H2O2 == 2H2O + O2↑ → \ce{...}。 */
export function chemistryToLatex(input: string): string {
  const body = input.trim().replace(/↑/g, " ^").replace(/↓/g, " v").replace(/={2,}/g, "=").replace(/→/g, "->");
  return `\\ce{${body}}`;
}
