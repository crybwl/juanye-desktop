/** Structured print styling. Values are data, never raw CSS, HTML or SVG. */
export type BookOptionColumns = 'auto' | 1 | 2 | 4;
export type BookCounterReset = 'book' | 'chapter' | 'section';
export interface BookCounter { format: string; reset: BookCounterReset; start: number }
export interface BookBlockStyle {
  id: string; name: string; title: string; background: string; borderColor: string;
  borderWidth: number; titleBackground: string; icon: string; counter?: BookCounter;
}
export interface BookAnswerAreaAttrs {
  kind: 'blank' | 'lines' | 'grid' | 'coordinate';
  unit: 'lines' | 'mm'; size: number; lineHeight: number; gridSize: number;
}
export const DEFAULT_BOOK_ANSWER_AREA: Readonly<BookAnswerAreaAttrs> = Object.freeze({ kind: 'lines', unit: 'lines', size: 5, lineHeight: 7, gridSize: 5 });
export const DEFAULT_BOOK_BLOCK_STYLES: readonly BookBlockStyle[] = Object.freeze([
  { id: 'lesson', name: '知识梳理', title: '知识梳理', background: '#f3f7fb', borderColor: '#b7cddd', borderWidth: .3, titleBackground: '#e3eef7', icon: 'book' },
  { id: 'example', name: '例题', title: '例题', background: '#faf7ee', borderColor: '#d8c596', borderWidth: .3, titleBackground: '#f1e8ce', icon: 'pen', counter: { format: '例{章}.{n}', reset: 'chapter', start: 1 } },
  { id: 'practice', name: '变式练习', title: '变式练习', background: '#f3f8f2', borderColor: '#b6ceb2', borderWidth: .3, titleBackground: '#e2f0df', icon: 'check', counter: { format: '{n}', reset: 'section', start: 1 } },
  { id: 'hint', name: '易错提示', title: '易错提示', background: '#fcf4f2', borderColor: '#dfbdb5', borderWidth: .3, titleBackground: '#f4e2dd', icon: 'alert' },
]);
export const BOOK_STYLE_ICONS = ['none', 'book', 'pen', 'check', 'alert', 'star', 'lightbulb', 'extension'] as const;
export const isBookOptionColumnsValue = (value: unknown): value is BookOptionColumns => ['auto', 1, 2, 4].includes(value as BookOptionColumns);
/** Shared validation for model and editor commands: no invalid geometry enters an undo transaction. */
export function validBookAnswerAreaAttrs(value: unknown): value is BookAnswerAreaAttrs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attrs = value as Record<string, unknown>;
  const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (typeof attrs.kind !== 'string' || !['blank','lines','grid','coordinate'].includes(attrs.kind) || typeof attrs.unit !== 'string' || !['lines','mm'].includes(attrs.unit)
    || !finite(attrs.size, 1, 300) || !finite(attrs.lineHeight, 3, 15) || !finite(attrs.gridSize, 2, 15)) return false;
  if (attrs.unit === 'lines' && (!Number.isInteger(attrs.size) || attrs.size > 40)) return false;
  return (attrs.unit === 'lines' ? attrs.size * attrs.lineHeight : attrs.size) <= 300;
}
export function bookAnswerAreaHeightMm(attrs: Pick<BookAnswerAreaAttrs, 'unit' | 'size' | 'lineHeight'>): number {
  return attrs.unit === 'lines' ? attrs.size * attrs.lineHeight : attrs.size;
}
