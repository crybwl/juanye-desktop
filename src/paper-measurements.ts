import { safePageCut, type PagePiece, type SplitGuard } from './pagination-geometry';

export interface BlockGeometry { height: number; guards: readonly SplitGuard[] }
export interface PaginationBlock {
  kind: string;
  breakBefore?: boolean;
  breakAfter?: boolean;
  pageSizedQuestion?: boolean;
  fillRemaining?: boolean;
}

/** One latest geometry per logical block. Content references are immutable;
 * cache replacement releases old question/image references instead of retaining
 * another undo history. Geometry context includes width, fonts and paper CSS. */
export class BlockGeometryCache {
  private readonly entries = new Map<string, { context: string; token: unknown; stamp?: string; geometry: BlockGeometry }>();
  get(key: string, context: string, token: unknown, stamp?: string) {
    const entry = this.entries.get(key);
    return entry && entry.context === context && entry.token === token && entry.stamp === stamp ? entry.geometry : undefined;
  }
  set(key: string, context: string, token: unknown, stamp: string | undefined, geometry: BlockGeometry) {
    this.entries.set(key, { context, token, stamp, geometry });
  }
  retain(keys: ReadonlySet<string>) { for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key); }
  get size() { return this.entries.size; }
}

/** The existing greedy page algorithm, now independent of a permanent DOM
 * copy. Split guards are captured with the same table/text/image ordering. */
export function paginateMeasuredBlocks(blocks: readonly PaginationBlock[], geometry: readonly BlockGeometry[], available: number, keepTogether: boolean, columns: 1 | 2): PagePiece[][] {
  const capacity = Math.max(30, available), out: PagePiece[][] = [];
  let current: PagePiece[] = [], used = 0;
  const flush = () => { if (current.length) out.push(current); current = []; used = 0; };
  const physicalBreak = () => { flush(); if (columns === 2 && out.length % 2) out.push([]); };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index], measured = geometry[index], height = measured.height;
    if (block.breakBefore) physicalBreak();
    const containsQuestion = () => current.some(piece => blocks[piece.index].kind === 'q' || blocks[piece.index].kind === 'space');
    if ((block.pageSizedQuestion || block.kind === 'sec' && blocks[index + 1]?.pageSizedQuestion) && containsQuestion()) flush();
    if (block.fillRemaining) {
      if (capacity - used < Math.min(80, capacity * .15) && current.length) flush();
      const remaining = capacity - used;
      current.push({ index, offset: 0, height: remaining, fullHeight: remaining, fillSpace: true });
      used += remaining; flush(); continue;
    }
    let group = height;
    if (block.kind === 'sec') group += Math.min(geometry[index + 1]?.height ?? 0, capacity * .35);
    if (keepTogether && block.kind === 'q' && blocks[index + 1]?.kind === 'space') group += geometry[index + 1].height;
    if (current.length && group <= capacity && used + group > capacity) flush();
    if (current.length && height <= capacity && used + height > capacity) flush();
    let offset = 0;
    while (offset < height - .05) {
      let room = capacity - used;
      if (room < 20 && current.length) { flush(); room = capacity; }
      let part = Math.min(height - offset, room);
      if (offset + part < height - .05 && block.kind !== 'space') {
        const cut = safePageCut(offset, offset + part, measured.guards);
        if (cut > offset + 1) part = cut - offset;
      }
      if (part < .05) { flush(); continue; }
      current.push({ index, offset, height: part, fullHeight: height });
      used += part; offset += part;
      if (offset < height - .05) flush();
    }
    if (block.breakAfter) physicalBreak();
  }
  flush();
  return out.length ? out : [[]];
}
