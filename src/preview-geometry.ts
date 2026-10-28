export const PREVIEW_PAGE_GAP = 28;
export const PREVIEW_PADDING = 32;
// Leave two CSS pixels for fractional Electron/Windows DPI rounding. Exact
// equality can create a horizontal scrollbar, reducing height and triggering
// the vertical-scrollbar / fit-to-width ResizeObserver feedback loop.
export const PREVIEW_FIT_GUARD = 2;

export function previewScale(width: number, paperWidth: number, cap: number, zoom: number): number {
  return Math.min(Math.max(0.15, (width - PREVIEW_PADDING * 2 - PREVIEW_FIT_GUARD) / paperWidth), cap) * zoom;
}

/** Pages have a fixed paper size; do not read every page's DOM on each scroll frame. */
export function previewPageAt(scrollTop: number, viewportHeight: number, paperHeight: number, scale: number, pages: number): number {
  const pitch = paperHeight * scale + PREVIEW_PAGE_GAP;
  return Math.max(1, Math.min(Math.max(1, pages), Math.floor((scrollTop + viewportHeight * 0.4 - PREVIEW_PADDING) / pitch) + 1));
}
