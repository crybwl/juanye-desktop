/**
 * 整块分页：块不在页间截断（题目 = 题干 + 选项 + 留白始终同页），标题与下文粘连。
 * 思路参考 Typst/CSS Fragmentation 的 keep-with-next；块高度由 DOM 实测后传入。
 */
export interface FlowItem { id: string; height: number; keepWithNext?: boolean; pageBreak?: boolean }
export interface Placement { page: number; top: number }
export interface FlowResult { placements: Placement[]; pages: number }

/** 标题后至少要跟随的下文高度（约两行正文），否则整组推到下一页。 */
export const KEEP_WITH_NEXT_MIN = 44;

export function paginate(items: readonly FlowItem[], bodyHeight: number): FlowResult {
  const placements: Placement[] = [];
  let page = 0, cursor = 0, forceBreak = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (forceBreak && cursor > 0) { page++; cursor = 0; }
    forceBreak = false;
    let need = item.height;
    if (item.keepWithNext) {
      // 连续标题（章 → 节 → 小节）作为一组，与第一块正文的开头一起放置。
      for (let j = i + 1; j < items.length; j++) {
        const next = items[j];
        if (next.pageBreak) break;
        if (next.keepWithNext) { need += next.height; continue; }
        need += Math.min(next.height, KEEP_WITH_NEXT_MIN);
        break;
      }
    }
    if (cursor > 0 && cursor + need > bodyHeight + 0.5) { page++; cursor = 0; }
    placements.push({ page, top: cursor });
    cursor += item.height;
    if (item.pageBreak) forceBreak = true;
  }
  return { placements, pages: page + 1 };
}

export const MM = 96 / 25.4;
export const mmToPx = (mm: number) => mm * MM;
