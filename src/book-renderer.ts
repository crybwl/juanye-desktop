import { Previewer } from 'pagedjs';
import 'katex/dist/katex.min.css';
import './book-renderer.css';
import { buildBookDocument, BOOK_PAPER_MM } from './book-render';
import type { BookProject } from './book-model';
import type { DrawingResult } from './drawing';
import { continuedBookTextOffset, missingBookTextRuns } from './book-pagination-integrity';
import { materializeBookColumns, bookColumnFirstHeights } from './book-column-pagination';
import { measureBookOptions } from './book-option-measure';

export interface BookRenderResult { pages: number; warnings: string[]; errors: string[] }
declare global { interface Window { renderJuanyeBook: (book: BookProject, chapterId?: string) => Promise<BookRenderResult> } }
const pagesRoot = document.getElementById('book-pages')!;
const status = document.querySelector<HTMLElement>('.book-render-status')!;
let previewer: Previewer | undefined;
let work = Promise.resolve<unknown>(undefined);
let serial = 0;
let renderedPaperWidth = 176;
function fitPreview() { document.documentElement.style.setProperty('--book-preview-scale', String(Math.max(.2, Math.min(.9, (innerWidth - 40) / (renderedPaperWidth * 96 / 25.4))))); }
window.addEventListener('resize', fitPreview, { passive: true });
const drawingRequests = new Map<string, { resolve: (result: DrawingResult) => void; reject: (error: Error) => void; timer: number }>();
const drawingCache = new Map<string, Promise<DrawingResult>>();

async function draw(code: string): Promise<DrawingResult> {
  let result = drawingCache.get(code);
  if (!result) {
    result = window.juanye?.renderDrawing ? window.juanye.renderDrawing(code) : new Promise<DrawingResult>((resolve, reject) => {
      if (window.parent === window) { reject(Error('绘图服务不可用')); return; }
      const id = `drawing-${crypto.randomUUID()}`;
      const timer = window.setTimeout(() => { drawingRequests.delete(id); reject(Error('绘图超时')); }, 60000);
      drawingRequests.set(id, { resolve, reject, timer });
      window.parent.postMessage({ type: 'juanye-book-drawing', id, code }, '*');
    });
    drawingCache.set(code, result); if (drawingCache.size > 80) drawingCache.delete(drawingCache.keys().next().value!);
    void result.catch(() => { if (drawingCache.get(code) === result) drawingCache.delete(code); });
  }
  return result;
}

async function render(book: BookProject, chapterId?: string): Promise<BookRenderResult> {
  if (!book || book.kind !== 'juanye-book' || ![1, 2].includes(book.version) || !Array.isArray(book.chapters)) throw Error('书稿数据无效');
  status.textContent = '正在分页…'; document.body.dataset.bookReady = 'false';
  previewer?.chunker.destroy(); previewer?.polisher.destroy(); previewer = undefined;
  pagesRoot.replaceChildren();
  const documentData = buildBookDocument(book, chapterId);
  const source = document.createElement('div'); source.className = 'book-render-source'; source.innerHTML = documentData.html;
  document.body.appendChild(source);
  const warnings = [...documentData.warnings], errors = [...documentData.errors];
  try {
    const [width, height] = BOOK_PAPER_MM[book.settings.paper];
    renderedPaperWidth = width; fitPreview();
    const usableHeight = (height - book.settings.marginTop - book.settings.marginBottom) * 96 / 25.4;
    // A question/solution larger than a physical page cannot be kept as one.
    // Apply the same typography before deciding whether to permit a split.
    const sourceStyle = document.createElement('style'); sourceStyle.dataset.bookSourceStyle = ''; sourceStyle.textContent = documentData.css; document.head.appendChild(sourceStyle);
    source.style.width = `${(width - book.settings.marginInner - book.settings.marginOuter) * 96 / 25.4}px`;
    for (const drawing of documentData.drawings) {
      const node = source.querySelector<HTMLElement>(`[data-book-drawing="${drawing.id}"]`);
      if (!node) continue;
      try {
        const result = await draw(drawing.code), img = new Image();
        img.alt = 'TikZ 题图'; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
        img.style.width = `${Math.max(1, result.width * 1.33)}px`; img.style.maxWidth = '100%';
        node.replaceChildren(img);
      } catch (error) { const message = `绘图失败：${error instanceof Error ? error.message : String(error)}`; errors.push(message); node.classList.add('book-media-error'); node.textContent = message; }
    }
    await document.fonts.ready;
    const fontNames = book.settings.fontFamily.split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(item => item && !['serif', 'sans-serif', 'monospace'].includes(item));
    if (fontNames.length && typeof FontFace !== 'undefined') {
      const available = await Promise.all(fontNames.map(async name => { try { await new FontFace('BookLocalFontProbe', `local(${JSON.stringify(name)})`).load(); return true; } catch { return false; } }));
      if (!available.some(Boolean)) warnings.push(`当前电脑缺少所选字体 ${book.settings.fontFamily}，已使用本机后备字体。`);
    }
    await Promise.all([...source.querySelectorAll('img')].map(async img => { try { await img.decode(); } catch { errors.push(`图片无法解码：${img.alt || '未命名图片'}`); } }));
    await measureBookOptions(source);
    for (const node of source.querySelectorAll<HTMLElement>('.book-answer-area')) {
      if (node.getBoundingClientRect().height > usableHeight + 1) errors.push('作答区高于整页版心，请减小高度后导出。');
    }
    for (const node of source.querySelectorAll<HTMLElement>('.book-question,.book-solution,[style*="break-inside:avoid"]')) {
      if (node.getBoundingClientRect().height > usableHeight) node.style.breakInside = 'auto';
    }
    // Give each prose text run its own source identity. The upstream mapper
    // otherwise confuses repeated sibling text around BRs (pagedjs#208).
    // Do not alter KaTeX's carefully positioned markup or MathML.
    const textRuns = new Map<string, string>(), walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT), runs: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.textContent?.trim() && !node.parentElement?.closest('.katex,svg,style,script')) runs.push(node);
    }
    for (const node of runs) {
      const wrapper = document.createElement('span'), id = String(textRuns.size);
      wrapper.dataset.bookTextRun = id; textRuns.set(id, node.textContent || '');
      node.replaceWith(wrapper); wrapper.append(node);
    }
    const originalContent = source.innerHTML;
    const hasColumns = !!source.querySelector('.book-columns');
    let firstHeights: Map<string, number> | undefined;
    let totalPages = 0;
    const columnTimings: { materializeMs: number; paginateMs: number; changed: number; maxDrift: number }[] = [];
    // The first pass locates each region's insertion point in real Paged.js
    // pages. A bounded follow-up reclaims space after single-column content.
    for (let pass = 0; pass < (hasColumns ? 5 : 1); pass++) {
    const materializeStarted = performance.now();
    source.innerHTML = originalContent;
    if (!source.isConnected) document.body.append(source);
    if (!sourceStyle.isConnected) document.head.append(sourceStyle);
    if (hasColumns) materializeBookColumns(source, { usableHeight, firstHeights });
    const content = source.innerHTML; source.remove(); sourceStyle.remove();
    const materializeMs = performance.now() - materializeStarted;
    previewer?.chunker.destroy(); previewer?.polisher.destroy(); pagesRoot.replaceChildren();
    previewer = new Previewer();
    previewer.chunker.hooks.onBreakToken.register((token, overflow) => {
      const renderedText = overflow?.startContainer;
      if (!token || !renderedText || renderedText.nodeType !== Node.TEXT_NODE || token.node.nodeType !== Node.TEXT_NODE) return;
      const runId = renderedText.parentElement?.dataset.bookTextRun;
      if (runId === undefined || token.node.parentElement?.dataset.bookTextRun !== runId) return;
      const offset = continuedBookTextOffset(token.node.textContent || '', renderedText.textContent || '', overflow!.startOffset);
      if (offset !== undefined) token.offset = offset;
    });
    // Paged.js 0.4 does not reconstruct THEAD when rebuilding split table
    // ancestors. Insert it during renderNode, before the overflow calculation,
    // so the repeated header consumes real layout space (not an overlay).
    previewer.chunker.hooks.renderNode.register((rendered, original) => {
      const element = rendered instanceof Element ? rendered : rendered.parentElement;
      const table = element?.closest<HTMLTableElement>('table[data-split-from]');
      if (!table || table.tHead) return;
      const originalElement = original instanceof Element ? original : original.parentElement;
      const head = originalElement?.closest<HTMLTableElement>('table')?.tHead;
      if (!head) return;
      const repeated = head.cloneNode(true) as HTMLTableSectionElement;
      repeated.dataset.bookRepeatedHeader = 'true';
      repeated.removeAttribute('id'); repeated.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      table.prepend(repeated);
    });
    const paginateStarted = performance.now();
    const flow = await previewer.preview(content, [{ [location.href]: documentData.css }], pagesRoot);
    totalPages = flow.total;
    await document.fonts.ready;
    await Promise.all([...pagesRoot.querySelectorAll('img')].map(img => img.decode().catch(() => undefined)));
    if (!hasColumns) break;
    const nextHeights = bookColumnFirstHeights(pagesRoot, usableHeight);
    const drifts = [...nextHeights].map(([key, value]) => Math.abs(value - (firstHeights?.get(key) ?? usableHeight - 2)));
    const changed = drifts.some(value => value > 1);
    columnTimings.push({ materializeMs, paginateMs: performance.now() - paginateStarted, changed: drifts.filter(value => value > 1).length, maxDrift: Math.max(0, ...drifts) });
    if (!changed) break;
    if (pass === 4) { errors.push('分栏与通栏交接处未能稳定分页，请增加换页或调整块高度。'); break; }
    firstHeights = nextHeights;
    }
    // Local diagnostic only: no telemetry/network and no React frame updates.
    document.body.dataset.bookColumnPasses = String(columnTimings.length);
    document.body.dataset.bookColumnTimings = JSON.stringify(columnTimings);
    const missing = missingBookTextRuns(textRuns, [...pagesRoot.querySelectorAll<HTMLElement>('.pagedjs_page_content [data-book-text-run]')]
      .filter(node => !node.closest('[data-book-repeated-header]'))
      .map(node => [node.dataset.bookTextRun!, node.textContent || ''] as const));
    if (missing.length) errors.push(`分页内容完整性检查失败：${missing.length}处文字缺失或重复，请检查长段落或表格；未导出不完整文件。`);
    const bodyWidth = (width - book.settings.marginInner - book.settings.marginOuter) * 96 / 25.4;
    for (const node of pagesRoot.querySelectorAll<HTMLElement>('.katex-display,.book-table,.math-table')) {
      const cell = node.closest<HTMLElement>('.book-column-cell');
      const available = cell ? cell.clientWidth : bodyWidth;
      if (node.scrollWidth > available + 4) { errors.push('存在宽于所在栏或版心的公式或表格，请缩小字号或调整内容。'); break; }
    }
    for (const row of pagesRoot.querySelectorAll<HTMLElement>('.book-column-row')) {
      const page = row.closest<HTMLElement>('.pagedjs_page_content');
      if (!page) continue;
      const box = page.getBoundingClientRect(), rect = row.getBoundingClientRect();
      if (rect.left < box.left - 2 || rect.right > box.right + 2 || rect.bottom > box.bottom + 2) {
        errors.push('分栏内容越出版心，未导出裁切文件。'); break;
      }
    }
    document.body.dataset.bookReady = 'true'; document.body.dataset.bookPages = String(totalPages);
    status.textContent = ''; return { pages: totalPages, warnings: [...new Set(warnings)], errors: [...new Set(errors)] };
  } finally { source.remove(); document.querySelector('[data-book-source-style]')?.remove(); }
}

window.renderJuanyeBook = (book, chapterId) => {
  const request = ++serial;
  const next = work.catch(() => {}).then(async () => {
    // Keep only the newest queued chapter input, never build an old backlog
    // while continuous typing generates newer previews.
    if (request !== serial) return { pages: Number(document.body.dataset.bookPages || 0), warnings: [], errors: [] };
    return render(book, chapterId);
  });
  work = next; return next;
};

window.addEventListener('message', event => {
  if (event.source !== window.parent || window.parent === window) return;
  const value = event.data;
  if (value?.type === 'juanye-book-handshake') { window.parent.postMessage({ type: 'juanye-book-ready' }, '*'); return; }
  if (value?.type === 'juanye-book-motion') { document.body.dataset.bookMotion = value.rich === true ? 'full' : 'reduced'; return; }
  if (value?.type === 'juanye-book-drawing-result' && typeof value.id === 'string') {
    const pending = drawingRequests.get(value.id); if (!pending) return;
    clearTimeout(pending.timer); drawingRequests.delete(value.id);
    if (value.error) pending.reject(Error(String(value.error))); else pending.resolve(value.result);
  }
  if (value?.type !== 'juanye-book-render' || typeof value.id !== 'string') return;
  void window.renderJuanyeBook(value.book, value.chapterId).then(result => window.parent.postMessage({ type: 'juanye-book-result', id: value.id, ...result }, '*'), error => {
    const message = error instanceof Error ? error.message : String(error); status.textContent = message;
    window.parent.postMessage({ type: 'juanye-book-result', id: value.id, pages: 0, warnings: [], error: message }, '*');
  });
});
if (window.parent !== window) window.parent.postMessage({ type: 'juanye-book-ready' }, '*');
