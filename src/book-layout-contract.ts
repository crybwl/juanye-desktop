/**
 * 教辅版式 v2 —— 界面与排版后端之间的契约。
 *
 * 界面（BookEditor / BookColumns / BookWorkspace）只依赖本文件中的类型与纯函数；
 * 书稿校验、分页渲染、主进程存储由后端实现，详见 docs/book-layout-api.md。
 * 校验、存储和实际 PDF 验收完成的能力，通过 BOOK_LAYOUT_CAPABILITIES 正式开放。
 */
import { BOOK_PAPER_MM, type BookSettings } from './book-model';
import { BOOK_CSS_PX_PER_MM, measureRawBookOptions, pickMeasuredOptionColumns } from './book-option-measure';

/* ── 分栏区（流式多栏） ─────────────────────────────────────────── */

export const BOOK_COLUMN_SET = 'columnSet';
export const BOOK_COLUMN_BREAK = 'columnBreak';
/** ProseMirror 分组：只允许出现在章节文档顶层，不能嵌套进分栏、讲解框或表格。 */
export const BOOK_FLOW_GROUP = 'bookFlow';

export type BookColumnCount = 2 | 3;
export interface BookColumnSetAttrs {
  /** 栏数。单栏即“取消分栏”，不以 count=1 存储。 */
  count: BookColumnCount;
  /** 栏间距，毫米。 */
  gap: number;
  /** 栏间分隔线。 */
  rule: boolean;
}
export const COLUMN_GAP_RANGE = Object.freeze({ min: 2, max: 20, step: 0.5 });
export const DEFAULT_COLUMN_SET: Readonly<BookColumnSetAttrs> = Object.freeze({ count: 2, gap: 6, rule: false });

export const clampColumnCount = (value: unknown): BookColumnCount => Number(value) === 3 ? 3 : 2;
export const clampColumnGap = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_COLUMN_SET.gap;
  return Math.round(Math.max(COLUMN_GAP_RANGE.min, Math.min(COLUMN_GAP_RANGE.max, n)) * 2) / 2;
};
export function normalizeColumnSetAttrs(raw: Partial<Record<keyof BookColumnSetAttrs, unknown>> | undefined): BookColumnSetAttrs {
  return { count: clampColumnCount(raw?.count), gap: clampColumnGap(raw?.gap ?? DEFAULT_COLUMN_SET.gap), rule: raw?.rule === true };
}

/* ── 选项排列 ──────────────────────────────────────────────────── */

/** 'auto' 按选项长度与所在栏宽自动选择；数字为每行选项个数。 */
export type BookOptionColumns = 'auto' | 1 | 2 | 4;
export const BOOK_OPTION_COLUMNS: readonly BookOptionColumns[] = ['auto', 4, 2, 1];
export const isBookOptionColumns = (value: unknown): value is BookOptionColumns => BOOK_OPTION_COLUMNS.includes(value as BookOptionColumns);

/** bookQuestion 节点新增属性。null = 跟随全书默认。 */
export interface BookQuestionLayoutAttrs { optionColumns: BookOptionColumns | null }

/** BookSettings 新增字段（后端合入 BookSettings 后可删除这里的可选读取）。 */
export interface BookLayoutSettings { optionColumns: BookOptionColumns }
export const DEFAULT_BOOK_LAYOUT_SETTINGS: Readonly<BookLayoutSettings> = Object.freeze({ optionColumns: 'auto' });

export function bookOptionColumnsDefault(settings: BookSettings | undefined): BookOptionColumns {
  const value = (settings as (BookSettings & Partial<BookLayoutSettings>) | undefined)?.optionColumns;
  return isBookOptionColumns(value) ? value : DEFAULT_BOOK_LAYOUT_SETTINGS.optionColumns;
}

/* ── 能力开关 ──────────────────────────────────────────────────── */

export interface BookLayoutCapabilities {
  /** 校验、存储、渲染均支持 columnSet / columnBreak。 */
  columnSet: boolean;
  /** 校验、存储、渲染均支持 bookQuestion.optionColumns 与 settings.optionColumns。 */
  optionColumns: boolean;
}
/** 两项能力均已通过数据往返和实际分页验证。 */
export const BOOK_LAYOUT_CAPABILITIES: Readonly<BookLayoutCapabilities> = Object.freeze({ columnSet: true, optionColumns: true });
/** 开发联调：localStorage.setItem('juanye.book.layoutPreview', '1') 后刷新，可提前看到界面。 */
export const BOOK_LAYOUT_PREVIEW_KEY = 'juanye.book.layoutPreview';
export function bookLayoutEnabled(feature: keyof BookLayoutCapabilities): boolean {
  if (BOOK_LAYOUT_CAPABILITIES[feature]) return true;
  try { return globalThis.localStorage?.getItem(BOOK_LAYOUT_PREVIEW_KEY) === '1'; } catch { return false; }
}

/* ── 几何（毫米） ──────────────────────────────────────────────── */

export const PT_TO_MM = 25.4 / 72;
export function bookContentWidthMm(settings: Pick<BookSettings, 'paper' | 'marginInner' | 'marginOuter'> | undefined): number {
  if (!settings) return 140;
  const [width] = BOOK_PAPER_MM[settings.paper] ?? BOOK_PAPER_MM.A4;
  return Math.max(40, width - settings.marginInner - settings.marginOuter);
}
export function bookColumnWidthMm(contentWidthMm: number, count: number, gapMm: number): number {
  if (count <= 1) return contentWidthMm;
  return Math.max(20, (contentWidthMm - gapMm * (count - 1)) / count);
}

/** Options establish a block formatting context beside a right float; reserve its margin too. */
export function bookOptionAvailableWidthMm(columnWidthMm: number, sideFigurePercent = 0): number {
  if (!Number.isFinite(columnWidthMm) || columnWidthMm <= 0) return 1;
  if (!Number.isFinite(sideFigurePercent) || sideFigurePercent <= 0) return columnWidthMm;
  return Math.max(1, columnWidthMm * (1 - Math.min(100, sideFigurePercent) / 100) - 4);
}

/* ── 选项列数决策（参考实现，后端可改为实测宽度） ───────────────── */

const WIDE_CHAR = /[⺀-鿿豈-﫿＀-￯　-〿]/;
const MATH_PART = /(\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/;
/** 估算一段题目文本的显示宽度，单位 em（一个汉字宽）。 */
export function estimateTextEm(source: string): number {
  let em = 0;
  for (const part of source.split(MATH_PART)) {
    if (!part) continue;
    if (MATH_PART.test(part) && /^(\$|\\\(|\\\[)/.test(part)) {
      const body = part.replace(/^\$\$?|\$\$?$/g, '').replace(/^\\[([]|\\[)\]]$/g, '');
      const fraction = /\\[dt]?frac/.test(body);
      const cleaned = body.replace(/\\(?:left|right|displaystyle|textstyle|[,;!:]|quad|qquad)/g, '').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_\s]/g, '');
      em += cleaned.length * (fraction ? 0.42 : 0.58);
    } else {
      for (const ch of part.replace(/\*\*|__|`/g, '')) em += WIDE_CHAR.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : 0.55;
    }
  }
  return em;
}

export interface OptionColumnsInput {
  options: readonly string[];
  /** 题目可用宽度（所在栏宽），毫米。 */
  availableMm: number;
  fontSizePt: number;
  /** 与预览/PDF 一致的本机字体；缺省使用全书默认宋体后备。 */
  fontFamily?: string;
  /** 选项格之间的水平间距，毫米。与 book-render 中 .book-options 的 gap 保持一致。 */
  gapMm?: number;
  /** 题图右侧绕排时最多两列。 */
  hasSideFigure?: boolean;
}
/** 选项标签“A.”及其右侧间距约占的宽度，em。 */
export const OPTION_LABEL_EM = 1.8;
export function pickOptionColumns({ options, availableMm, fontSizePt, fontFamily, gapMm = 4, hasSideFigure = false }: OptionColumnsInput): 1 | 2 | 4 {
  const list = options.filter(option => option.trim());
  if (!list.length || list.some(option => /\n|!\[/.test(option))) return 1;
  const measured = measureRawBookOptions(list, fontSizePt, fontFamily);
  if (measured) return pickMeasuredOptionColumns({ longestPx: Math.max(...measured), availablePx: availableMm * BOOK_CSS_PX_PER_MM,
    gapPx: gapMm * BOOK_CSS_PX_PER_MM, sideFigure: hasSideFigure });
  const emMm = Math.max(1, fontSizePt * PT_TO_MM);
  const need = Math.max(...list.map(estimateTextEm)) + OPTION_LABEL_EM;
  for (const n of hasSideFigure ? [2] as const : [4, 2] as const) {
    const cellEm = (availableMm - gapMm * (n - 1)) / n / emMm;
    if (need <= cellEm) return n;
  }
  return 1;
}
export function resolveOptionColumns(choice: BookOptionColumns | null | undefined, bookDefault: BookOptionColumns, input: OptionColumnsInput): { columns: 1 | 2 | 4; auto: boolean } {
  const value = isBookOptionColumns(choice) ? choice : bookDefault;
  if (value === 'auto') return { columns: pickOptionColumns(input), auto: true };
  return { columns: input.hasSideFigure ? Math.min(2, value) as 1 | 2 : value, auto: false };
}
export const optionColumnsLabel = (value: BookOptionColumns) => value === 'auto' ? '自动' : value === 1 ? '每行 1 个' : `每行 ${value} 个`;
