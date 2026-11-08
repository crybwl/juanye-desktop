import { AnimatePresence, animate, motion, useMotionValue, useReducedMotionConfig, type MotionValue } from "motion/react";
import { GripVertical, Plus } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { BlockApi, Selection } from "./api";
import { BlockView } from "./blocks";
import { ACCENTS, PAPER_SIZE, chapterAt, questionNumbers, type Block, type Edition, type Workbook } from "./model";
import { mmToPx, paginate, type Placement } from "./pagination";

/** 布局重排弹簧：干脆、无多余回弹。 */
export const LAYOUT_SPRING = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;
export const PAGE_GAP = 28;

export interface CanvasGeometry {
  pageW: number; pageH: number; pages: number; contentW: number; marginTop: number; marginLeft: number;
  /** 内容坐标系中的块矩形（目标位置，不含动画中间值）。 */
  rect(blockId: string): { x: number; y: number; w: number; h: number } | null;
  placements: ReadonlyMap<string, Placement>;
}

export function canvasVars(book: Workbook): CSSProperties {
  const { layout } = book;
  return {
    "--wb-fs": `${(layout.fontSize * 96) / 72}px`,
    "--wb-lh": String(layout.lineHeight),
    "--wb-accent": ACCENTS[layout.accent],
    "--wb-body-font": layout.font === "serif" ? "var(--font-serif)" : "var(--font-sans)",
  } as CSSProperties;
}

export function pageGeometry(book: Workbook) {
  const [w, h] = PAPER_SIZE[book.layout.paper];
  const [mt, mr, mb, ml] = book.layout.margin;
  const pageW = mmToPx(w), pageH = mmToPx(h);
  return { pageW, pageH, marginTop: mmToPx(mt), marginLeft: mmToPx(ml), contentW: pageW - mmToPx(ml) - mmToPx(mr), bodyH: pageH - mmToPx(mt) - mmToPx(mb), marginBottom: mmToPx(mb) };
}

export const visibleBlocks = (blocks: readonly Block[], edition: Edition) => blocks.filter(b => !(b.kind === "note" && b.teacherOnly && edition === "student"));

/** 页眉、页码。章首页不显示页眉。 */
export function PageChrome({ book, page, firstBlock }: { book: Workbook; page: number; firstBlock?: Block }) {
  const geo = pageGeometry(book);
  const index = firstBlock ? book.blocks.indexOf(firstBlock) : -1;
  const chapter = index >= 0 ? chapterAt(book.blocks, index) : "";
  const opening = firstBlock?.kind === "heading" && firstBlock.level === 1;
  return <>
    {book.layout.header && !opening && <div className="wb-header" style={{ left: geo.marginLeft, width: geo.contentW, top: geo.marginTop * 0.42 }}>
      <span>{book.title}</span><span>{chapter}</span>
    </div>}
    {book.layout.pageNumber && <div className="wb-folio" style={{ bottom: geo.marginBottom * 0.38 }}>{page + 1}</div>}
  </>;
}

interface FrameProps {
  block: Block;
  y: number;
  x: number;
  width: number;
  isNew: boolean;
  dragging: boolean;
  selected: boolean;
  activeField: string | null | undefined;
  selection?: Selection;
  number?: number;
  edition: Edition;
  readOnly: boolean;
  api: BlockApi;
  register: (id: string, element: HTMLDivElement | null, mv: MotionValue<number>) => void;
  onHandleDown: (id: string, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPlus: (id: string, anchor: HTMLElement) => void;
}

const BlockFrame = memo(function BlockFrame(props: FrameProps) {
  const { block, y, x, width, isNew, dragging, selected, activeField, selection, number, edition, readOnly, api, register, onHandleDown, onPlus } = props;
  const mv = useMotionValue(y);
  const first = useRef(true);
  const reduced = useReducedMotionConfig();
  useLayoutEffect(() => {
    if (dragging) return;
    if (first.current || reduced) { first.current = false; mv.jump(y); return; }
    const controls = animate(mv, y, LAYOUT_SPRING);
    return () => controls.stop();
  }, [y, dragging, reduced, mv]);
  const ref = useCallback((element: HTMLDivElement | null) => register(block.id, element, mv), [register, block.id, mv]);
  return <motion.div ref={ref} className="wb-block" data-block-id={block.id} data-kind={block.kind}
    data-selected={selected || undefined} data-editing={activeField ? true : undefined} data-dragging={dragging || undefined}
    style={{ y: mv, left: x, width }}
    initial={isNew ? { opacity: 0, scale: 0.985 } : false} animate={{ opacity: 1, scale: dragging ? 1.006 : 1 }}
    exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.16 } }} transition={{ opacity: { duration: 0.2 }, scale: LAYOUT_SPRING }}
    onMouseDown={event => {
      // 字段内部的点击由字段自己处理（静态字段激活编辑；已激活的编辑器交给 ProseMirror / 公式框）。
      if (readOnly || event.defaultPrevented || event.button !== 0 || (event.target as Element).closest(".wb-field, math-field")) return;
      api.select(block.id);
    }}>
    {!readOnly && <span className="wb-frame" aria-hidden="true" data-screen-only />}
    {!readOnly && <div className="wb-gutter" data-screen-only onMouseDown={event => event.preventDefault()}>
      <button type="button" className="wb-gutter-btn" aria-label="在下方插入" title="在下方插入" onClick={event => onPlus(block.id, event.currentTarget)}><Plus size={14} /></button>
      <button type="button" className="wb-gutter-btn wb-grip" aria-label="拖动排序" title="拖动排序 · 点击选中" onPointerDown={event => onHandleDown(block.id, event)}><GripVertical size={14} /></button>
    </div>}
    <BlockView block={block} edition={edition} activeField={activeField} intent={selection?.intent} number={number} readOnly={readOnly} api={api} contentWidth={width} />
  </motion.div>;
});

export interface CanvasProps {
  book: Workbook;
  edition: Edition;
  selection: Selection | null;
  readOnly: boolean;
  zoom: number;
  api: BlockApi;
  overlay?: (geometry: CanvasGeometry) => ReactNode;
  onGeometry?: (geometry: CanvasGeometry) => void;
  onBackground: (page: number, y: number, lastPage: boolean, belowLast: boolean) => void;
  onMove: (blockId: string, beforeId: string | null, coalesce: string) => void;
  onPlus: (blockId: string, anchor: HTMLElement) => void;
}

export function WorkbookCanvas({ book, edition, selection, readOnly, zoom, api, overlay, onGeometry, onBackground, onMove, onPlus }: CanvasProps) {
  const geo = pageGeometry(book);
  const blocks = useMemo(() => visibleBlocks(book.blocks, edition), [book.blocks, edition]);
  const numbers = useMemo(() => questionNumbers(book.blocks), [book.blocks]);
  const heights = useRef(new Map<string, number>());
  const elements = useRef(new Map<string, HTMLDivElement>());
  const motionValues = useRef(new Map<string, MotionValue<number>>());
  const known = useRef<Set<string> | null>(null);
  const [version, setVersion] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);

  const observer = useMemo(() => typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      const element = entry.target as HTMLDivElement;
      const id = element.dataset.blockId;
      if (!id || !element.isConnected) continue;
      const height = element.offsetHeight;
      if (Math.abs((heights.current.get(id) ?? -1) - height) > 0.5) { heights.current.set(id, height); changed = true; }
    }
    if (changed) flushSync(() => setVersion(v => v + 1));
  }), []);

  const register = useCallback((id: string, element: HTMLDivElement | null, mv: MotionValue<number>) => {
    const previous = elements.current.get(id);
    if (previous && previous !== element) observer?.unobserve(previous);
    if (element) { elements.current.set(id, element); motionValues.current.set(id, mv); observer?.observe(element); }
    else if (previous) { elements.current.delete(id); motionValues.current.delete(id); }
  }, [observer]);

  // 每次提交后同步测量（绘制前），保证新块/编辑后的位置在同一帧内确定。
  useLayoutEffect(() => {
    let changed = false;
    for (const block of blocks) {
      const element = elements.current.get(block.id);
      if (!element) continue;
      const height = element.offsetHeight;
      if (Math.abs((heights.current.get(block.id) ?? -1) - height) > 0.5) { heights.current.set(block.id, height); changed = true; }
    }
    if (changed) setVersion(v => v + 1);
  });

  const flow = useMemo(() => paginate(blocks.map(b => ({ id: b.id, height: heights.current.get(b.id) ?? 0, keepWithNext: b.kind === "heading", pageBreak: b.kind === "pagebreak" })), geo.bodyH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, version, geo.bodyH]);
  const placements = useMemo(() => new Map(blocks.map((b, i) => [b.id, flow.placements[i]])), [blocks, flow]);
  const absY = useCallback((placement: Placement) => placement.page * (geo.pageH + PAGE_GAP) + geo.marginTop + placement.top, [geo.pageH, geo.marginTop]);

  const geometry = useMemo<CanvasGeometry>(() => ({
    pageW: geo.pageW, pageH: geo.pageH, pages: flow.pages, contentW: geo.contentW, marginTop: geo.marginTop, marginLeft: geo.marginLeft, placements,
    rect: id => { const p = placements.get(id); return p ? { x: geo.marginLeft, y: absY(p), w: geo.contentW, h: heights.current.get(id) ?? 0 } : null; },
  }), [geo.pageW, geo.pageH, geo.contentW, geo.marginTop, geo.marginLeft, flow.pages, placements, absY]);
  useLayoutEffect(() => { onGeometry?.(geometry); }, [geometry, onGeometry]);

  const isFirstRender = known.current === null;
  const knownIds = known.current ?? new Set<string>();
  useLayoutEffect(() => { known.current = new Set(blocks.map(b => b.id)); }, [blocks]);

  /* ---------- 拖动排序：块跟随指针，其余块以弹簧让位 ---------- */
  const latest = useRef({ blocks, placements, absY, zoom });
  latest.current = { blocks, placements, absY, zoom };
  const startDrag = useCallback((id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    api.select(id);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const mv = motionValues.current.get(id);
    if (!mv) return;
    const originY = event.clientY, origin = mv.get(), session = `drag:${id}:${Date.now()}`;
    let moved = false;
    const move = (e: PointerEvent) => {
      const delta = (e.clientY - originY) / latest.current.zoom;
      if (!moved && Math.abs(delta) < 4) return;
      if (!moved) { moved = true; setDragId(id); }
      const y = origin + delta;
      mv.set(y);
      const center = y + (heights.current.get(id) ?? 0) / 2;
      const { blocks: list, placements: places, absY: toY } = latest.current;
      const others = list.filter(b => b.id !== id);
      const before = others.find(b => { const p = places.get(b.id); return p ? toY(p) + (heights.current.get(b.id) ?? 0) / 2 > center : false; });
      const currentIndex = list.findIndex(b => b.id === id);
      const currentNext = list[currentIndex + 1]?.id ?? null;
      const target = before?.id ?? null;
      if (target !== currentNext) onMove(id, target, session);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      setDragId(null);
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  }, [api, onMove]);

  const firstOnPage = useMemo(() => {
    const out: (Block | undefined)[] = Array.from({ length: flow.pages }, () => undefined);
    blocks.forEach((b, i) => { const p = flow.placements[i]; if (!out[p.page]) out[p.page] = b; });
    return out;
  }, [blocks, flow]);

  const totalH = flow.pages * (geo.pageH + PAGE_GAP) - PAGE_GAP;
  const lastBottom = blocks.length ? (() => { const last = blocks[blocks.length - 1]; const p = placements.get(last.id)!; return { page: p.page, y: p.top + (heights.current.get(last.id) ?? 0) }; })() : { page: 0, y: 0 };

  return <div ref={content} className="wb-content" data-edition={edition} data-readonly={readOnly || undefined}
    style={{ ...canvasVars(book), width: geo.pageW, height: totalH, zoom } as CSSProperties}>
    <AnimatePresence initial={false}>
      {Array.from({ length: flow.pages }, (_, page) => <motion.div key={page} className="wb-page"
        style={{ top: page * (geo.pageH + PAGE_GAP), width: geo.pageW, height: geo.pageH }}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} transition={LAYOUT_SPRING}
        onMouseDown={event => {
          if (event.target !== event.currentTarget || event.button !== 0) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const y = (event.clientY - rect.top) / zoom - geo.marginTop;
          const last = page === flow.pages - 1;
          onBackground(page, y, last, last && (page > lastBottom.page || y > lastBottom.y));
        }}>
        <PageChrome book={book} page={page} firstBlock={firstOnPage[page]} />
      </motion.div>)}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {blocks.map((block, index) => {
        const placement = flow.placements[index];
        const selected = selection?.blockId === block.id;
        return <BlockFrame key={block.id} block={block} y={absY(placement)} x={geo.marginLeft} width={geo.contentW}
          isNew={!isFirstRender && !knownIds.has(block.id)} dragging={dragId === block.id}
          selected={selected} activeField={selected ? selection!.field : undefined} selection={selected ? selection! : undefined}
          number={numbers.get(block.id)} edition={edition} readOnly={readOnly} api={api}
          register={register} onHandleDown={startDrag} onPlus={onPlus} />;
      })}
    </AnimatePresence>
    {overlay?.(geometry)}
  </div>;
}
