/** Physical column fragments, measured before Paged.js handles the outer pages.
 * Native CSS columns overflow horizontally when nested in Paged.js' own columns.
 * These bounded grid rows avoid that second independent fragmentation context.
 * Text identities are retained on split ancestors; final pagination still audits them.
 */
const PX_PER_MM = 96 / 25.4;
export interface BookColumnPlan { usableHeight: number; firstHeights?: ReadonlyMap<string, number> }
export interface BookColumnMaterialization { regions: number; rows: number }
const isEmpty = (node: Element) => !node.textContent?.trim() && !node.querySelector('img,svg,.katex,table,.book-answer-area');

interface Boundary { node: Node; offset: number; length: number; atomic: boolean }
function splitBoundaries(root: HTMLElement): Boundary[] {
  const result: Boundary[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.length) result.push({ node, offset: 0, length: node.textContent.length, atomic: false });
    } else if (node instanceof Element && node.matches('.katex,svg,img,br,tr,.book-answer-area,.book-drawing,.book-image')) {
      const parent = node.parentNode!;
      result.push({ node: parent, offset: [...parent.childNodes].indexOf(node as ChildNode) + 1, length: 1, atomic: true });
    } else node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return result;
}
function fragment(root: HTMLElement, points: Boundary[], position: number, prefix: boolean): HTMLElement {
  const range = document.createRange(); range.selectNodeContents(root);
  let remaining = position;
  for (const point of points) {
    if (remaining <= point.length) {
      let offset = point.atomic ? point.offset : remaining;
      if (!point.atomic && offset > 0 && offset < (point.node.textContent?.length || 0)) {
        const value = point.node.textContent!;
        if (/[\uD800-\uDBFF]/.test(value[offset - 1]) && /[\uDC00-\uDFFF]/.test(value[offset])) offset--;
      }
      if (prefix) range.setEnd(point.node, offset); else range.setStart(point.node, offset);
      break;
    }
    remaining -= point.length;
  }
  const clone = root.cloneNode(false) as HTMLElement;
  clone.append(range.cloneContents());
  if (!prefix) {
    // A continued identity is still the same text run, but an HTML anchor is unique.
    clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    const originalTables = root.matches('table') ? [root as HTMLTableElement] : [...root.querySelectorAll('table')];
    const continuedTables = clone.matches('table') ? [clone as HTMLTableElement] : [...clone.querySelectorAll('table')];
    continuedTables.forEach((table, index) => {
      const head = originalTables[index]?.tHead;
      if (head && !table.tHead && table.rows.length) {
        const repeated = head.cloneNode(true) as HTMLTableSectionElement;
        repeated.dataset.bookRepeatedHeader = 'true'; table.prepend(repeated);
      }
    });
  }
  return clone;
}
function fitPrefix(root: HTMLElement, cell: HTMLElement, limit: number): [HTMLElement, HTMLElement] | undefined {
  const points = splitBoundaries(root), size = points.reduce((total, point) => total + point.length, 0);
  if (size < 2) return;
  let low = 1, high = size - 1, best = 0;
  while (low <= high) {
    const middle = (low + high) >>> 1, part = fragment(root, points, middle, true);
    cell.append(part);
    const fits = cell.getBoundingClientRect().height <= limit + .25;
    part.remove();
    if (fits && !isEmpty(part)) { best = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (!best) return;
  const before = fragment(root, points, best, true), after = fragment(root, points, best, false);
  if (isEmpty(before) || isEmpty(after)) return;
  return [before, after];
}

/** Must run while source is attached at its physical, unzoomed content width. */
export function materializeBookColumns(source: HTMLElement, plan: BookColumnPlan): BookColumnMaterialization {
  let regions = 0, rows = 0;
  const seenChapters = new Set<Element>();
  for (const [setIndex, set] of [...source.querySelectorAll<HTMLElement>('.book-columns')].entries()) {
    const count = set.dataset.columns === '3' ? 3 : 2;
    const gap = Number(set.dataset.columnGap ?? set.dataset.gap ?? 6);
    const rule = set.dataset.columnRule === 'true' || set.dataset.rule === 'true';
    const width = set.getBoundingClientRect().width;
    const chapter = set.closest<HTMLElement>('.book-chapter:not(.book-cover)');
    const chapterStartsPage = chapter && (!chapter.previousElementSibling || getComputedStyle(chapter).breakBefore === 'page');
    const sourceOffset = chapter ? set.getBoundingClientRect().top - chapter.getBoundingClientRect().top : 0;
    const seedHeight = chapter && chapterStartsPage && !seenChapters.has(chapter) && sourceOffset >= 0 && sourceOffset < plan.usableHeight - 70
      ? plan.usableHeight - sourceOffset - 2 : undefined;
    if (chapter) seenChapters.add(chapter);
    const inherited = getComputedStyle(set);
    const typography = { fontFamily: inherited.fontFamily, fontSize: inherited.fontSize, lineHeight: inherited.lineHeight,
      fontWeight: inherited.fontWeight, fontStyle: inherited.fontStyle, letterSpacing: inherited.letterSpacing,
      wordSpacing: inherited.wordSpacing, textAlign: inherited.textAlign, color: inherited.color };
    if ((width - gap * PX_PER_MM * (count - 1)) / count < 20 * PX_PER_MM - .5) throw Error('分栏后每栏不足20毫米，请减小栏距、页边距或更换纸张。');
    const items = [...set.children] as HTMLElement[];
    const output = document.createElement('div'); output.className = 'book-column-materialized';
    // Do not repeatedly measure inside the full book flow: every item insertion
    // otherwise relayouts all later chapters. The absolute probe has identical
    // typography/width but an independent layout subtree.
    const placeholder = document.createElement('div'); set.replaceWith(placeholder);
    const probe = document.createElement('div'); probe.className = 'book-content';
    probe.style.cssText = `position:absolute;left:-100000px;top:0;width:${width}px;contain:layout style;visibility:hidden`;
    Object.assign(probe.style, typography);
    document.body.append(probe); probe.append(output);
    try {
    let batch = 0, row: HTMLElement | undefined, cells: HTMLElement[] = [], col = 0, rowLimit = 0, rowHasContent = false;
    let anchor: HTMLElement;
    const beginRegion = () => {
      const id = `columns-${setIndex}-${batch++}`;
      anchor = document.createElement('div'); anchor.dataset.bookColumnsAnchor = id;
      anchor.style.cssText = 'height:1px;clear:both;break-after:auto;margin:0;padding:0';
      output.append(anchor); regions++;
      return id;
    };
    let regionId = beginRegion(), first = true;
    const newRow = () => {
      // Seed an obvious first region from real source geometry. Without this,
      // Paged.js needlessly attempts to split a complete full-height grid after
      // every chapter title before moving it to the next page. The outer marker
      // pass still reconciles the estimate and checks every final row's bounds.
      const requested = first ? plan.firstHeights?.get(regionId) ?? (batch === 1 ? seedHeight : undefined) : undefined;
      rowLimit = Math.max(24, Math.min(plan.usableHeight - 2, requested ?? plan.usableHeight - 2));
      row = document.createElement('div'); row.className = 'book-column-row'; row.dataset.bookColumnsRegion = regionId;
      row.dataset.columns = String(count); row.dataset.columnRow = String(rows++);
      row.style.cssText = `display:grid;grid-template-columns:repeat(${count},minmax(0,1fr));column-gap:${gap}mm;align-items:start;break-inside:avoid;page-break-inside:avoid;margin:0;padding:0;position:relative;contain:layout style`;
      if (!first) row.style.breakBefore = 'page';
      cells = Array.from({ length: count }, (_, index) => {
        const cell = document.createElement('div'); cell.className = 'book-column-cell';
        cell.dataset.columnIndex = String(index + 1);
        cell.style.cssText = 'display:flow-root;min-width:0;margin:0;padding:0';
        if (rule && index) {
          const line = document.createElement('span'); line.dataset.bookColumnRule = 'true';
          line.style.cssText = `position:absolute;left:calc(${index * 100 / count}% + ${(index / count - .5) * gap}mm);top:0;bottom:0;border-left:.2mm solid #999;pointer-events:none`;
          row!.append(line);
        }
        row!.append(cell); return cell;
      });
      output.append(row); col = 0; rowHasContent = false; first = false;
    };
    const closeRow = (forceFull: boolean) => {
      if (!row) return;
      if (!rowHasContent) { row.remove(); row = undefined; return; }
      const height = Math.max(...cells.map(cell => cell.getBoundingClientRect().height));
      if (height > rowLimit + 1) throw Error('分栏内容超过当前栏高，未导出裁切的文件。');
      row.style.height = `${forceFull ? rowLimit : Math.max(1, height)}px`;
      row = undefined;
    };
    const nextColumn = () => { col++; if (col >= count) { closeRow(true); newRow(); } };
    const queue = [...items]; let iterations = 0;
    while (queue.length) {
      if (++iterations > 100000) throw Error('分栏内容过长，已停止分页以避免无响应。');
      const item = queue.shift()!;
      if (item.matches('[data-column-span="all"]')) {
        closeRow(false); output.append(item); regionId = beginRegion(); first = true; continue;
      }
      if (!row) newRow();
      if (item.matches('.book-column-break')) { nextColumn(); continue; }
      if (item.matches('.book-page-break') || item.style.breakBefore === 'page') {
        closeRow(true); newRow(); row!.style.breakBefore = 'page';
        if (item.matches('.book-page-break')) continue;
        item.style.breakBefore = 'auto';
      }
      const cell = cells[col]; const occupied = cell.childElementCount > 0;
      cell.append(item);
      if (cell.getBoundingClientRect().height <= rowLimit + .25) { rowHasContent = true; continue; }
      item.remove();
      // Keep complete questions together whenever one column can contain them.
      if (occupied) { nextColumn(); queue.unshift(item); continue; }
      const split = fitPrefix(item, cell, rowLimit);
      if (!split) {
        if (rowLimit < plan.usableHeight - 3) { closeRow(true); newRow(); queue.unshift(item); continue; }
        throw Error('存在高于整栏且无法安全拆分的题图、公式或表格行，请缩小内容后导出。');
      }
      cell.append(split[0]); rowHasContent = true; nextColumn(); queue.unshift(split[1]);
    }
    closeRow(false);
    // A terminal break must not invent an otherwise empty paper page.
    if (anchor! && !anchor.nextElementSibling && !anchor.previousElementSibling) anchor.remove();
    placeholder.replaceWith(output);
    } finally { probe.remove(); }
  }
  return { regions, rows };
}

/** Determine the remaining height at each region's logical insertion position.
 * The anchor intentionally has no keep-with-next rule: it stays before a tall row
 * moved by Paged.js, allowing a second pass to reuse the previous page's free space.
 */
export function bookColumnFirstHeights(pages: HTMLElement, usableHeight: number): Map<string, number> {
  const heights = new Map<string, number>();
  for (const marker of pages.querySelectorAll<HTMLElement>('[data-book-columns-anchor]')) {
    const content = marker.closest<HTMLElement>('.pagedjs_page_content');
    if (!content) continue;
    const available = content.getBoundingClientRect().bottom - marker.getBoundingClientRect().bottom - 1;
    // Less than three ordinary text lines is better continued on a fresh page.
    heights.set(marker.dataset.bookColumnsAnchor!, available >= 70 ? Math.min(usableHeight - 2, available) : usableHeight - 2);
  }
  return heights;
}
