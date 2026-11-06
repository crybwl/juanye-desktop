import { renderMathText } from './math';
import { StringLruCache } from './string-lru';

export const BOOK_CSS_PX_PER_MM = 96 / 25.4;
export type MeasuredOptionColumns = 1 | 2 | 4;

/** Widths include option labels. All values are unscaled CSS pixels. */
export function pickMeasuredOptionColumns(input: {
  longestPx: number; availablePx: number; gapPx: number; sideFigure?: boolean; multiline?: boolean;
}): MeasuredOptionColumns {
  if (input.multiline || !Number.isFinite(input.longestPx) || input.longestPx <= 0 ||
      !Number.isFinite(input.availablePx) || input.availablePx <= 0 || !Number.isFinite(input.gapPx) || input.gapPx < 0) return 1;
  for (const columns of input.sideFigure ? [2] as const : [4, 2] as const) {
    // Leave a subpixel guard so rounding at the final PDF scale cannot cause a wrap.
    if (input.longestPx + .5 <= (input.availablePx - input.gapPx * (columns - 1)) / columns) return columns;
  }
  return 1;
}

// Bounds both entry count and source payload. A whole book cannot retain unbounded probes.
const rawWidths = new StringLruCache(2048, 2 * 1024 * 1024);
let fontEpoch = 0;
const registeredDocuments = new WeakSet<Document>();
function registerFontInvalidation(doc: Document) {
  if (registeredDocuments.has(doc)) return;
  registeredDocuments.add(doc);
  doc.fonts?.addEventListener('loadingdone', () => { fontEpoch++; });
}
function probeHost(doc: Document): HTMLDivElement {
  const host = doc.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.dataset.bookOptionProbe = '';
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:max-content;max-width:none;contain:layout style;transform:none;zoom:1;';
  doc.body.appendChild(host);
  return host;
}

/**
 * Synchronous editor decision using the same local KaTeX markup as the PDF. No network,
 * canvas font approximation or hidden UI mutation. An unavailable DOM returns undefined
 * so the contract can retain its deterministic server-side approximation.
 */
export function measureRawBookOptions(options: readonly string[], fontSizePt: number,
  fontFamily = 'Noto Serif SC, SimSun, serif'): number[] | undefined {
  if (typeof document === 'undefined' || !document.body || !Number.isFinite(fontSizePt) || fontSizePt <= 0) return;
  registerFontInvalidation(document);
  const keyPrefix = `${fontEpoch}:${fontSizePt}:${fontFamily}:`;
  const widths: number[] = [];
  const misses: { key: string; node: HTMLElement; index: number }[] = [];
  let host: HTMLElement | undefined;
  try {
    for (let index = 0; index < options.length; index++) {
      const option = options[index], key = keyPrefix + index + ':' + option;
      const cached = document.fonts?.status === 'loaded' ? rawWidths.get(key) : undefined;
      if (cached !== undefined) { widths[index] = Number(cached); continue; }
      host ??= probeHost(document);
      const node = document.createElement('div');
      node.style.cssText = 'display:block;width:max-content;max-width:none;min-width:0;white-space:nowrap;padding:0;margin:0;border:0;';
      node.style.fontSize = `${fontSizePt}pt`; node.style.fontFamily = fontFamily;
      node.innerHTML = `<b>${String.fromCharCode(65 + index)}.</b> ${renderMathText(option)}`;
      host.appendChild(node); misses.push({ key, node, index });
    }
    // One write batch then one measurement batch, not layout per option.
    for (const { key, node, index } of misses) {
      widths[index] = node.getBoundingClientRect().width;
      if (widths[index] <= 0) return;
      if (document.fonts?.status === 'loaded') rawWidths.set(key, String(widths[index]));
    }
    return widths;
  } finally { host?.remove(); }
}

export interface BookOptionMeasureResult { measured: number; auto: number; manual: number; counts: Record<MeasuredOptionColumns, number> }

/**
 * Call after source font/image readiness, before column/page measurement. Source attributes:
 * .book-options[data-choice="auto|1|2|4"][data-available-mm][data-side-figure="true"];
 * direct .book-option children contain the actual label and rendered text/KaTeX.
 * Semantic width describes the final column, not the temporary full-page measurement DOM.
 */
export async function measureBookOptions(root: HTMLElement): Promise<BookOptionMeasureResult> {
  const doc = root.ownerDocument, win = doc.defaultView;
  const result: BookOptionMeasureResult = { measured: 0, auto: 0, manual: 0, counts: { 1: 0, 2: 0, 4: 0 } };
  if (!win || !doc.body) return result;
  registerFontInvalidation(doc);
  await doc.fonts?.ready;
  const groups = Array.from(root.querySelectorAll<HTMLElement>('.book-options'));
  if (!groups.length) return result;
  const host = probeHost(doc);
  const jobs: { group: HTMLElement; copies: HTMLElement[]; available: number; gap: number; side: boolean; multiline: boolean; manual?: MeasuredOptionColumns }[] = [];
  try {
    for (const group of groups) {
      const computed = win.getComputedStyle(group);
      const choice = group.dataset.choice ?? group.dataset.optionColumns ?? 'auto';
      const side = group.dataset.sideFigure === 'true';
      const manualChoice = Number(choice);
      const manual = [1, 2, 4].includes(manualChoice) ? (side ? Math.min(2, manualChoice) : manualChoice) as MeasuredOptionColumns : undefined;
      const mm = Number(group.dataset.availableMm);
      const available = Number.isFinite(mm) && mm > 0 ? mm * BOOK_CSS_PX_PER_MM : group.clientWidth;
      const gap = Number.parseFloat(computed.columnGap) || 0;
      const children = Array.from(group.children).filter((node): node is HTMLElement => node instanceof win.HTMLElement);
      const copies: HTMLElement[] = [];
      let multiline = !children.length;
      if (!manual) for (const child of children) {
        // KaTeX radicals/accents contain inline SVG: those are intrinsic inline math,
        // not a question illustration or a reason to force a whole option row.
        if (child.querySelector('.katex-display') || Array.from(child.querySelectorAll('br,table,img,svg')).some(node => !node.closest('.katex')) || child.textContent?.includes('\n')) multiline = true;
        const style = win.getComputedStyle(child), clone = child.cloneNode(true) as HTMLElement;
        clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        clone.style.cssText = 'display:block;width:max-content;max-width:none;min-width:0;white-space:nowrap;padding:0;margin:0;border:0;float:none;transform:none;zoom:1;';
        clone.style.font = style.font; clone.style.fontFamily = style.fontFamily;
        clone.style.fontSize = style.fontSize; clone.style.fontWeight = style.fontWeight;
        clone.style.fontStyle = style.fontStyle; clone.style.letterSpacing = style.letterSpacing;
        // Inherit the same inline math scale; the class remains on the cloning root.
        host.appendChild(clone); copies.push(clone);
      }
      jobs.push({ group, copies, available, gap, side, multiline, manual });
    }
    // Fonts newly referenced by KaTeX probes must be ready before intrinsic width reads.
    await doc.fonts?.ready;
    const decisions = jobs.map(job => ({ group: job.group, columns: job.manual ?? pickMeasuredOptionColumns({
      longestPx: Math.max(0, ...job.copies.map(node => node.getBoundingClientRect().width)),
      availablePx: job.available, gapPx: job.gap, sideFigure: job.side, multiline: job.multiline,
    }), manual: !!job.manual }));
    // Grid writes come only after all widths have been read, avoiding read/write thrashing.
    for (const { group, columns, manual } of decisions) {
      group.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      group.dataset.measuredColumns = String(columns);
      group.dataset.optionMeasured = 'true';
      result.measured++; result.counts[columns]++; if (manual) result.manual++; else result.auto++;
    }
  } finally { host.remove(); }
  return result;
}
