import { MM, PAPER_MM } from "./data";
import type { Layout } from "./types";

/** The physical sheet and the independently measured logical columns, in CSS px. */
export function paperGeometry(layout: Layout) {
  const [width, height] = PAPER_MM[layout.paper];
  const [pwMm, phMm] = layout.orientation === "portrait" ? [width, height] : [height, width];
  const pw = pwMm * MM, ph = phMm * MM, m = layout.margin * MM;
  const columns: 1 | 2 = layout.columns === 2 ? 2 : 1;
  const seal = layout.sealLine ? Math.max(12, Math.min(30, layout.sealWidth ?? 18)) * MM : 0;
  const gutter = columns === 2 ? Math.max(3, Math.min(25, layout.columnGap ?? 8)) * MM : 0;
  const contentWidth = pw - m * 2 - seal;
  const contentHeight = ph - m * 2 - (layout.pageNumber ? 12 : 0);
  return { pw, ph, m, columns, seal, gutter, contentWidth, contentHeight, columnWidth: (contentWidth - gutter) / columns };
}

/** Consecutive measured columns form one physical sheet, left before right. */
export function physicalSheets<T>(columns: readonly T[], count: 1 | 2): T[][] {
  const sheets: T[][] = [];
  for (let index = 0; index < columns.length; index += count) sheets.push(columns.slice(index, index + count));
  return sheets;
}
