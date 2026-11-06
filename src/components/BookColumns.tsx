import { Node, mergeAttributes, type CommandProps } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Fragment, type Node as ProseNode, type ResolvedPos } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Columns2, Columns3, Maximize2, Minimize2, Rows3 } from 'lucide-react';
import type { BookSettings } from '../book-model';
import {
  BOOK_COLUMN_BREAK, BOOK_COLUMN_SET, BOOK_FLOW_GROUP, COLUMN_GAP_RANGE, DEFAULT_COLUMN_SET, PT_TO_MM,
  bookColumnWidthMm, bookContentWidthMm, bookLayoutEnabled, bookOptionColumnsDefault, clampColumnCount, clampColumnGap, normalizeColumnSetAttrs,
  type BookColumnSetAttrs, type BookOptionColumns,
} from '../book-layout-contract';
import './book-columns.css';

/* ── 版式快照：章节编辑器内所有 NodeView 共享，设置变化时才通知 ── */

export interface BookLayoutSnapshot {
  contentWidthMm: number; fontSizePt: number; fontFamily: string; optionColumns: BookOptionColumns;
  features: { columnSet: boolean; optionColumns: boolean };
}
export class BookLayoutStore {
  private value: BookLayoutSnapshot = BookLayoutStore.from(undefined);
  private listeners = new Set<() => void>();
  static from(settings: BookSettings | undefined): BookLayoutSnapshot {
    return {
      contentWidthMm: bookContentWidthMm(settings), fontSizePt: settings?.fontSize ?? 10.5, fontFamily: settings?.fontFamily ?? 'serif', optionColumns: bookOptionColumnsDefault(settings),
      features: { columnSet: bookLayoutEnabled('columnSet'), optionColumns: bookLayoutEnabled('optionColumns') },
    };
  }
  set(settings: BookSettings | undefined) {
    const next = BookLayoutStore.from(settings), prev = this.value;
    if (prev.contentWidthMm === next.contentWidthMm && prev.fontSizePt === next.fontSizePt && prev.fontFamily === next.fontFamily && prev.optionColumns === next.optionColumns
      && prev.features.columnSet === next.features.columnSet && prev.features.optionColumns === next.features.optionColumns) return;
    this.value = next; this.listeners.forEach(notify => notify());
  }
  get = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
}
export const useBookLayout = (store: BookLayoutStore) => useSyncExternalStore(store.subscribe, store.get, store.get);

/* ── 位置工具 ─────────────────────────────────────────────────── */

export interface FoundColumnSet { node: ProseNode; pos: number }
export function columnSetAround($pos: ResolvedPos): FoundColumnSet | undefined {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === BOOK_COLUMN_SET) return { node, pos: $pos.before(depth) };
  }
}
export function columnSetInSelection(state: EditorState): FoundColumnSet | undefined {
  const selection = state.selection as EditorState['selection'] & { node?: ProseNode };
  if (selection.node?.type.name === BOOK_COLUMN_SET) return { node: selection.node, pos: selection.from };
  return columnSetAround(selection.$from);
}
/** 某个位置所在的“流”：分栏区内返回栏数与栏距，否则为通栏。 */
export function flowAt(doc: ProseNode, pos: number): { count: number; gap: number } {
  try {
    const found = columnSetAround(doc.resolve(pos));
    return found ? { count: clampColumnCount(found.node.attrs.count), gap: clampColumnGap(found.node.attrs.gap) } : { count: 1, gap: 0 };
  } catch { return { count: 1, gap: 0 }; }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookColumns: {
      /** 光标在分栏区内：修改属性；否则把所选的顶层块包成分栏区。 */
      setColumnSet: (attrs?: Partial<BookColumnSetAttrs>) => ReturnType;
      /** 取消分栏，保留内容（换栏标记一并移除）。pos 为分栏区起点，缺省取光标所在分栏区。 */
      unsetColumnSet: (pos?: number) => ReturnType;
      insertColumnBreak: () => ReturnType;
    };
  }
}

function unwrapColumnSet({ state, tr, dispatch }: CommandProps, at?: number) {
  const found = typeof at === 'number' ? (() => { const node = state.doc.nodeAt(at); return node?.type.name === BOOK_COLUMN_SET ? { node, pos: at } : undefined; })() : columnSetInSelection(state);
  if (!found) return false;
  if (dispatch) {
    const children: ProseNode[] = [];
    found.node.forEach(child => { if (child.type.name !== BOOK_COLUMN_BREAK) children.push(child); });
    if (!children.length) children.push(state.schema.nodes.paragraph.create());
    tr.replaceWith(found.pos, found.pos + found.node.nodeSize, Fragment.fromArray(children));
  }
  return true;
}

/* ── Schema ───────────────────────────────────────────────────── */

/** 章节文档：允许顶层出现分栏区；分栏区不属于 block 组，因此不会被嵌套。 */
export const BookDocument = Node.create({ name: 'doc', topNode: true, content: `(block | ${BOOK_FLOW_GROUP})+` });

export const ColumnBreak = Node.create({
  name: BOOK_COLUMN_BREAK, atom: true, selectable: true,
  parseHTML() { return [{ tag: 'div[data-book-column-break]' }]; },
  renderHTML() { return ['div', { 'data-book-column-break': '', class: 'book-editor-column-break' }, '换栏']; },
});

export const ColumnSet = Node.create<{ layout: BookLayoutStore }>({
  name: BOOK_COLUMN_SET, group: BOOK_FLOW_GROUP, content: `(block | ${BOOK_COLUMN_BREAK})+`, defining: true, isolating: true,
  addOptions() { return { layout: new BookLayoutStore() }; },
  addAttributes() {
    return {
      count: { default: DEFAULT_COLUMN_SET.count, parseHTML: element => clampColumnCount(element.getAttribute('data-columns')), renderHTML: attrs => ({ 'data-columns': clampColumnCount(attrs.count) }) },
      gap: { default: DEFAULT_COLUMN_SET.gap, parseHTML: element => clampColumnGap(element.getAttribute('data-column-gap')), renderHTML: attrs => ({ 'data-column-gap': clampColumnGap(attrs.gap) }) },
      rule: { default: DEFAULT_COLUMN_SET.rule, parseHTML: element => element.getAttribute('data-column-rule') === 'true', renderHTML: attrs => ({ 'data-column-rule': String(attrs.rule === true) }) },
    };
  },
  parseHTML() { return [{ tag: 'section[data-book-columns]' }]; },
  renderHTML({ HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-book-columns': '' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(ColumnSetView); },
  addCommands() {
    return {
      setColumnSet: (attrs = {}) => ({ state, tr, dispatch }) => {
        const found = columnSetInSelection(state);
        if (found) {
          if (dispatch) tr.setNodeMarkup(found.pos, undefined, normalizeColumnSetAttrs({ ...found.node.attrs, ...attrs }));
          return true;
        }
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to, node => node.type.name === 'doc');
        const type = state.schema.nodes[BOOK_COLUMN_SET];
        const wrapping = range && findWrapping(range, type, normalizeColumnSetAttrs({ ...DEFAULT_COLUMN_SET, ...attrs }));
        if (!range || !wrapping) return false;
        if (dispatch) {
          tr.wrap(range, wrapping);
          // 分栏区落在章末时补一个段落，保证可以在分栏区之后继续输入通栏内容。
          const after = tr.mapping.map(range.end);
          if (after >= tr.doc.content.size) tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
        }
        return true;
      },
      unsetColumnSet: pos => props => unwrapColumnSet(props, pos),
      insertColumnBreak: () => ({ state, chain }) => {
        if (!columnSetAround(state.selection.$from)) return false;
        return chain().insertContent({ type: BOOK_COLUMN_BREAK }).run();
      },
    };
  },
  addKeyboardShortcuts() { return { 'Mod-Shift-Enter': () => this.editor.commands.insertColumnBreak() }; },
});

/* ── 编辑视图：按印刷栏宽显示，右侧为自动续排的占位栏 ─────────── */

function ColumnSetView({ node, updateAttributes, editor, getPos, extension, selected }: NodeViewProps) {
  const layout = useBookLayout((extension.options as { layout: BookLayoutStore }).layout);
  const { count, gap, rule } = normalizeColumnSetAttrs(node.attrs);
  const [expanded, setExpanded] = useState(false);
  const editable = editor.isEditable;
  const emMm = Math.max(1, layout.fontSizePt * PT_TO_MM);
  const columnMm = bookColumnWidthMm(layout.contentWidthMm, count, gap);
  const style = { '--book-col-em': columnMm / emMm, '--book-gap-em': gap / emMm, '--book-total-em': layout.contentWidthMm / emMm } as CSSProperties;
  const charsPerLine = Math.floor(columnMm / emMm);
  const unset = () => { const pos = getPos(); if (typeof pos === 'number') editor.chain().focus().unsetColumnSet(pos).run(); };
  return <NodeViewWrapper as="section" className={`book-column-set${selected ? ' is-selected' : ''}`} data-columns={count} data-rule={rule || undefined} data-expanded={expanded || undefined} style={style}>
    <div className="book-column-bar" contentEditable={false}>
      <span className="book-column-badge">{count === 3 ? <Columns3 size={13}/> : <Columns2 size={13}/>}分栏区</span>
      <div className="book-column-segment" role="radiogroup" aria-label="分栏区栏数">
        {([2, 3] as const).map(value => <button key={value} type="button" role="radio" aria-checked={count === value} disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={() => updateAttributes({ count: value })}>{value} 栏</button>)}
      </div>
      <label className="book-column-field">栏距<input aria-label="分栏区栏距（毫米）" type="number" min={COLUMN_GAP_RANGE.min} max={COLUMN_GAP_RANGE.max} step={COLUMN_GAP_RANGE.step} value={gap} disabled={!editable} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= COLUMN_GAP_RANGE.min && value <= COLUMN_GAP_RANGE.max) updateAttributes({ gap: clampColumnGap(value) }); }}/>mm</label>
      <label className="book-column-field"><input type="checkbox" aria-label="分栏区分隔线" checked={rule} disabled={!editable} onChange={event => updateAttributes({ rule: event.target.checked })}/>分隔线</label>
      <span className="book-column-measure" title="按当前纸张、页边距和正文字号计算">每栏 {columnMm.toFixed(0)} mm · 约 {charsPerLine} 字/行</span>
      <span className="book-column-spacer"/>
      <button type="button" className="book-column-action" aria-pressed={expanded} title={expanded ? '恢复按印刷栏宽显示' : '临时展开到全宽编辑，不影响排版'} onMouseDown={event => event.preventDefault()} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={13}/> : <Maximize2 size={13}/>}<span>{expanded ? '按栏宽' : '展开编辑'}</span></button>
      <button type="button" className="book-column-action" title="取消分栏，保留其中的内容" disabled={!editable} onMouseDown={event => event.preventDefault()} onClick={unset}><Rows3 size={13}/><span>取消分栏</span></button>
    </div>
    <div className="book-column-body">
      <NodeViewContent className="book-column-flow"/>
      {Array.from({ length: count - 1 }, (_, index) => <div key={index} className="book-column-ghost" contentEditable={false} aria-hidden="true"><span>第 {index + 2} 栏 · 自动续排</span></div>)}
    </div>
  </NodeViewWrapper>;
}
