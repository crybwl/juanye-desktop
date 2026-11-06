import type { BookNode, BookProject } from './book-model';
import { DEFAULT_BOOK_BLOCK_STYLES, DEFAULT_BOOK_ANSWER_AREA, bookAnswerAreaHeightMm, validBookAnswerAreaAttrs, type BookBlockStyle } from './book-blocks';

/** Resolve once in whole-book order, including when only one chapter is previewed. */
export function resolveBookBlockLabels(book: BookProject): Map<BookNode, string> {
  const labels = new Map<BookNode, string>(), counters = new Map<string, number>();
  const styles = new Map((book.styles ?? DEFAULT_BOOK_BLOCK_STYLES).map(style => [style.id, style]));
  let chapterNumber = 0;
  for (const chapter of book.chapters) {
    if (chapter.kind === 'chapter') chapterNumber++;
    let section = 0;
    const visit = (node: BookNode) => {
      if (node.type === 'heading' && Number(node.attrs?.level ?? 2) <= 2) section++;
      // Legacy kind-only blocks keep their old unnumbered appearance and do not
      // consume invisible numbers before the first explicitly styled block.
      if (node.type === 'callout' && node.attrs?.styleId) {
        const styleId = String(node.attrs?.styleId || node.attrs?.kind || 'lesson');
        const style = styles.get(styleId), counter = style?.counter;
        if (counter) {
          const key = JSON.stringify([styleId, counter.reset === 'book' ? '' : chapter.id, counter.reset === 'section' ? section : '']);
          const next = (counters.get(key) ?? counter.start - 1) + 1;
          counters.set(key, next);
          labels.set(node, counter.format.replace(/\{(章|chapter|节|section|n)\}/g, (_, token: string) => String(token === 'n' ? next : token === '节' || token === 'section' ? section : chapterNumber)));
        }
      }
      node.content?.forEach(visit);
    };
    visit(chapter.content);
  }
  return labels;
}

const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color = (value: string) => /^(?:#[a-f\d]{3}|#[a-f\d]{6}|#[a-f\d]{8})$/i.test(value) ? value : '#ffffff';
/** CSS comes only from typed, restricted values, never a user CSS string. */
export function bookBlockStyleCss(style: BookBlockStyle): string[] {
  return [`background:${color(style.background)}`, `border:${Math.min(3,Math.max(0,style.borderWidth))}mm solid ${color(style.borderColor)}`, `--book-block-title-bg:${color(style.titleBackground)}`];
}
export function bookBlockIcon(icon: string): string {
  const shapes: Record<string, string> = {
    book: '<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 6v15"/>',
    pen: '<path d="m4 17 12-12 3 3L7 20H4zM14 7l3 3"/>',
    check: '<path d="m4 12 5 5L20 6"/>', alert: '<path d="M12 3 2 21h20zM12 9v5m0 3v1"/>',
    star: '<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z"/>',
    lightbulb: '<path d="M8 17v-2a7 7 0 1 1 8 0v2zM8 20h8m-6 3h4"/>',
    extension: '<path d="M3 4h7V2h4v2h7v7h-3v4h3v7H3v-7h3v-4H3z"/>',
  };
  return shapes[icon] ? `<svg class="book-block-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6">${shapes[icon]}</svg>` : '';
}

/** Vector backgrounds stay sharp in PDF. Coordinate grids use mm geometry. */
export function renderBookAnswerArea(raw: BookNode['attrs']): string {
  const merged = { ...DEFAULT_BOOK_ANSWER_AREA, ...Object.fromEntries(Object.entries(raw ?? {}).filter(([,v])=>v!=null)) };
  const attrs = validBookAnswerAreaAttrs(merged) ? merged : DEFAULT_BOOK_ANSWER_AREA;
  const height = bookAnswerAreaHeightMm(attrs), step = attrs.kind === 'lines' ? attrs.lineHeight : attrs.gridSize;
  const svg = attrs.kind === 'blank' ? '' : `<svg xmlns="http://www.w3.org/2000/svg" width="${step}mm" height="${step}mm" viewBox="0 0 ${step} ${step}"><path d="${attrs.kind==='lines'?`M0 ${step}H${step}`:`M0 ${step}V0H${step}`}" fill="none" stroke="#b4bec8" stroke-width="0.15"/></svg>`;
  const background = svg ? `;background-image:url(&quot;data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g,'%27')}&quot;)` : '';
  const axes = attrs.kind === 'coordinate' ? '<svg class="book-answer-axes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M4 50H96m-4-2 4 2-4 2M50 96V4m-2 4 2-4 2 4" fill="none" stroke="#66717c" stroke-width=".3" vector-effect="non-scaling-stroke"/></svg>' : '';
  return `<div class="book-answer-area" data-answer-kind="${escape(attrs.kind)}" data-answer-height-mm="${height}" aria-label="作答区" style="height:${height}mm${background}">${axes}</div>`;
}
