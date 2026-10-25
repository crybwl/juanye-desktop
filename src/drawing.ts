export type DrawingSegment = { kind: "text"; text: string } | { kind: "tikz"; code: string };
export type DrawingResult = { svg: string; width: number; height: number };
export const CUBE_TIKZ = String.raw`\begin{tikzpicture}[line join=round,scale=2]
\coordinate (A) at (0,0); \coordinate (B) at (1,0);
\coordinate (C) at (1,1); \coordinate (D) at (0,1);
\coordinate (E) at (0.4,0.4); \coordinate (F) at (1.4,0.4);
\coordinate (G) at (1.4,1.4); \coordinate (H) at (0.4,1.4);
\draw[dashed] (A)--(E)--(F) (E)--(H);
\draw (A)--(B)--(C)--(D)--cycle;
\draw (B)--(F)--(G)--(H)--(D); \draw (C)--(G);
\end{tikzpicture}`;

/** Protect complete drawing blocks from math-dollar parsing, including $labels$ inside them. */
export function drawingSegments(text: string): DrawingSegment[] {
  const out: DrawingSegment[] = [];
  const regex = /\\begin\s*\{tikzpicture\}[\s\S]*?\\end\s*\{tikzpicture\}/g;
  let previous = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index!;
    if (start > previous) out.push({ kind: "text", text: text.slice(previous, start) });
    out.push({ kind: "tikz", code: match[0] });
    previous = start + match[0].length;
  }
  if (previous < text.length) out.push({ kind: "text", text: text.slice(previous) });
  return out;
}
export const extractTikzBlocks = (text: string) => drawingSegments(text).flatMap(segment => segment.kind === "tikz" ? [segment.code] : []);
export const stripTikzBlocks = (text: string) => drawingSegments(text).flatMap(segment => segment.kind === "text" ? [segment.text] : []).join("").trim();
const cache = new Map<string, Promise<DrawingResult>>();
let compilationQueue: Promise<unknown> = Promise.resolve();
export function renderDrawing(code: string): Promise<DrawingResult> {
  if (!cache.has(code)) {
    const job = compilationQueue.then(() => {
      if (typeof window === "undefined" || !window.juanye?.renderDrawing) throw new Error("绘图请使用桌面应用");
      return window.juanye.renderDrawing(code);
    });
    compilationQueue = job.catch(() => {});
    cache.set(code, job);
    // A rejection is consumed by mounted drawing components/prepareDrawings.
    void job.catch(() => {});
    if (cache.size > 80) cache.delete(cache.keys().next().value!);
  }
  return cache.get(code)!;
}
export const prepareDrawings = async (texts: string[]) => {
  for (const code of new Set(texts.flatMap(extractTikzBlocks))) await renderDrawing(code);
};
export async function waitForDrawings(root: ParentNode = document, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (true) {
    const error = root.querySelector<HTMLElement>('[data-drawing-status="error"]');
    if (error) throw new Error(error.textContent || "绘图失败");
    if (!root.querySelector('[data-drawing-status="pending"]')) return;
    if (Date.now() - start > timeoutMs) throw new Error("绘图尚未完成，请稍后重试");
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}
