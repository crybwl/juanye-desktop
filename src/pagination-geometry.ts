/** Geometry is measured once per block, then reused by all of its continuation pages. */
export interface SplitGuard { top: number; bottom: number }
export interface PagePiece { index: number; offset: number; height: number; fullHeight: number; fillSpace?: boolean }

export function safePageCut(offset: number, target: number, guards: readonly SplitGuard[]): number {
  let cut = target;
  for (const { top, bottom } of guards) {
    if (top < cut - 0.1 && bottom > cut + 0.1 && top > offset + 1) cut = Math.min(cut, top);
  }
  return cut;
}

/** Avoid allocating two complete serialized copies of a potentially very long paper. */
export function samePages(previous: readonly (readonly PagePiece[])[], next: readonly (readonly PagePiece[])[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let page = 0; page < previous.length; page++) {
    const a = previous[page], b = next[page];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
      const x = a[index], y = b[index];
      if (x.index !== y.index || x.offset !== y.offset || x.height !== y.height || x.fullHeight !== y.fullHeight || x.fillSpace !== y.fillSpace) return false;
    }
  }
  return true;
}
