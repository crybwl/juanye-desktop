import { AnimatePresence, motion } from "motion/react";
import { Eye, FileDown, ListTree, PenLine, Redo2, SlidersHorizontal, Undo2 } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, Segmented, Switch, cx, useToast } from "../ui";
import { SaveBadge } from "../components/TitleBar";
import { fieldsOf, type BlockApi, type Selection } from "./api";
import { BlockView } from "./blocks";
import { PageChrome, WorkbookCanvas, canvasVars, pageGeometry, visibleBlocks, type CanvasGeometry } from "./Canvas";
import { splitAtCursor, type FieldKeyHandlers } from "./extensions";
import { ACCENTS, PAPER_SIZE, createBlock, questionNumbers, uid, type Block, type BlockKind, type Edition, type Workbook, type WorkbookAccent, type WorkbookPaper } from "./model";
import { FloatingToolbar, InsertMenu, MathHelper, NodePanels, type InsertChoice, type ToolbarOps } from "./Overlays";
import { Outline } from "./Outline";
import { concatRich, isRichEmpty, type RichDoc, type RichNode } from "./rich";
import type { CaretIntent } from "./RichField";
import { loadWorkbook, saveWorkbook } from "./storage";
import "./workbook.css";

export interface WorkbookHandle { exportPdf(edition?: Edition): void }
export interface WorkbookMeta { title: string; saving: boolean; error?: string }

/* ---------- ProseMirror 位置换算（Backspace 合并段落后定位光标） ---------- */
function nodeSize(node: RichNode): number {
  if (node.type === "text") return (node.text ?? "").length;
  if (!node.content) return node.type === "paragraph" ? 2 : 1;
  return 2 + node.content.reduce((sum, child) => sum + nodeSize(child), 0);
}
function endOfDoc(doc: RichDoc): number {
  const all = doc.content.reduce((sum, node) => sum + nodeSize(node), 0);
  return Math.max(1, all - 1);
}

function writeField(block: Block, field: string, doc: RichDoc): Block {
  if (field.startsWith("opt:")) {
    if (block.kind !== "question") return block;
    const id = field.slice(4);
    return { ...block, options: block.options.map(o => o.id === id ? { ...o, text: doc } : o) };
  }
  return { ...block, [field]: doc } as Block;
}
function cloneBlock(block: Block): Block {
  const copy = JSON.parse(JSON.stringify(block)) as Block;
  copy.id = uid();
  if (copy.kind === "question") {
    const map = new Map<string, string>();
    copy.options = copy.options.map(o => { const id = uid("o"); map.set(o.id, id); return { ...o, id }; });
    copy.correct = copy.correct.map(id => map.get(id) ?? id);
  }
  return copy;
}

const PAPERS: WorkbookPaper[] = ["A4", "16K", "B5", "A5"];
const FONT_SIZES = [9, 10, 10.5, 11, 12];
const LINE_HEIGHTS = [1.6, 1.8, 2];

export function WorkbookWorkspace({ active, handle, onMeta }: { active: boolean; handle?: Ref<WorkbookHandle>; onMeta?: (meta: WorkbookMeta) => void }) {
  const toast = useToast();
  const [book, setBook] = useState<Workbook | null>(null);
  const [edition, setEdition] = useState<Edition>("student");
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState<{ anchor: { x: number; y: number }; target: string | null; replace: boolean } | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [printing, setPrinting] = useState<{ edition: Edition; restore: Edition; ready: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(() => { try { return localStorage.getItem(OUTLINE_KEY) !== "false"; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(OUTLINE_KEY, String(outlineOpen)); } catch { /* 偏好仅本机便利 */ } }, [outlineOpen]);
  const [geometry, setGeometry] = useState<CanvasGeometry | null>(null);

  const bookRef = useRef<Workbook | null>(null);
  bookRef.current = book;
  const selectionRef = useRef<Selection | null>(null);
  selectionRef.current = selection;
  const editionRef = useRef(edition);
  editionRef.current = edition;
  const geometryRef = useRef<CanvasGeometry | null>(null);
  const history = useRef<{ past: Workbook[]; future: Workbook[]; key: string | null; at: number }>({ past: [], future: [], key: null, at: 0 });
  const serial = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  /* ---------- 载入与自动保存 ---------- */
  useEffect(() => {
    let alive = true;
    loadWorkbook().then(loaded => { if (alive) setBook(loaded); }).catch(error => { if (alive) { setSaveError(error instanceof Error ? error.message : String(error)); } });
    return () => { alive = false; };
  }, []);
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!book) return;
    if (!loadedOnce.current) { loadedOnce.current = true; return; }
    setSaving(true);
    const timer = setTimeout(() => {
      saveWorkbook(book).then(() => setSaveError(undefined)).catch(error => setSaveError(error instanceof Error ? error.message : String(error))).finally(() => setSaving(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [book]);
  useEffect(() => { if (book) onMeta?.({ title: book.title, saving, error: saveError }); }, [book?.title, saving, saveError, onMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 状态更新与撤销 ---------- */
  const setSelection = useCallback((next: Selection | null | ((current: Selection | null) => Selection | null)) => {
    setSelectionState(current => {
      const value = typeof next === "function" ? next(current) : next;
      selectionRef.current = value;
      return value;
    });
  }, []);
  const commit = useCallback((recipe: (current: Workbook) => Workbook, coalesce?: string) => {
    const previous = bookRef.current;
    if (!previous) return;
    const next = recipe(previous);
    if (next === previous) return;
    const h = history.current, now = Date.now();
    if (!(coalesce && h.key === coalesce && now - h.at < 1500)) { h.past.push(previous); if (h.past.length > 200) h.past.shift(); }
    h.key = coalesce ?? null; h.at = now; h.future = [];
    const stamped = { ...next, updatedAt: now };
    bookRef.current = stamped;
    setBook(stamped);
  }, []);
  const restore = useCallback((direction: "undo" | "redo") => {
    const h = history.current, current = bookRef.current;
    const source = direction === "undo" ? h.past : h.future;
    const target = source.pop();
    if (!target || !current) return;
    (direction === "undo" ? h.future : h.past).push(current);
    h.key = null;
    bookRef.current = target;
    setBook(target);
    setSelection(sel => sel && target.blocks.some(b => b.id === sel.blockId) ? { ...sel, field: null, serial: ++serial.current } : null);
  }, [setSelection]);
  const updateBlocks = useCallback((recipe: (blocks: Block[]) => Block[], coalesce?: string) => commit(book => {
    const blocks = recipe(book.blocks);
    return blocks === book.blocks ? book : { ...book, blocks };
  }, coalesce), [commit]);

  const activate = useCallback((blockId: string, field: string | null, intent?: CaretIntent) => {
    setMenu(null);
    setSelection({ blockId, field, intent, serial: ++serial.current });
  }, [setSelection]);

  /** 进入相邻块：有可编辑字段则把光标放入，否则仅选中。 */
  const focusBlock = useCallback((block: Block | undefined, where: "start" | "end") => {
    if (!block) return false;
    const fields = fieldsOf(block, editionRef.current);
    activate(block.id, fields.length ? (where === "start" ? fields[0] : fields[fields.length - 1]) : null, where);
    return true;
  }, [activate]);

  const neighbours = useCallback((blockId: string) => {
    const current = bookRef.current;
    if (!current) return { list: [] as Block[], index: -1 };
    const list = visibleBlocks(current.blocks, editionRef.current);
    return { list, index: list.findIndex(b => b.id === blockId) };
  }, []);

  const insertAfter = useCallback((blockId: string | null, kind: BlockKind, variant?: string) => {
    const block = createBlock(kind, variant);
    updateBlocks(blocks => {
      const index = blockId ? blocks.findIndex(b => b.id === blockId) : blocks.length - 1;
      return [...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)];
    });
    const fields = fieldsOf(block, editionRef.current);
    activate(block.id, fields[0] ?? null, "start");
  }, [updateBlocks, activate]);

  const remove = useCallback((blockId: string) => {
    const { list, index } = neighbours(blockId);
    updateBlocks(blocks => blocks.filter(b => b.id !== blockId));
    const next = list[index + 1] ?? list[index - 1];
    setSelection(next ? { blockId: next.id, field: null, serial: ++serial.current } : null);
  }, [neighbours, updateBlocks, setSelection]);

  const replace = useCallback((blockId: string, kind: BlockKind, variant?: string) => {
    const fresh = createBlock(kind, variant);
    updateBlocks(blocks => blocks.map(b => {
      if (b.id !== blockId) return b;
      const carried = "text" in b && "text" in fresh ? { text: b.text } : {};
      return { ...fresh, ...carried, id: b.id } as Block;
    }));
    const fields = fieldsOf(fresh, editionRef.current);
    activate(blockId, fields[0] ?? null, "end");
  }, [updateBlocks, activate]);

  const duplicate = useCallback((blockId: string) => {
    let copy: Block | undefined;
    updateBlocks(blocks => {
      const index = blocks.findIndex(b => b.id === blockId);
      if (index < 0) return blocks;
      copy = cloneBlock(blocks[index]);
      return [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)];
    });
    if (copy) setSelection({ blockId: copy.id, field: null, serial: ++serial.current });
  }, [updateBlocks, setSelection]);

  const move = useCallback((blockId: string, beforeId: string | null, coalesce?: string) => updateBlocks(blocks => {
    const block = blocks.find(b => b.id === blockId);
    if (!block || beforeId === blockId) return blocks;
    const rest = blocks.filter(b => b.id !== blockId);
    const at = beforeId ? rest.findIndex(b => b.id === beforeId) : rest.length;
    return [...rest.slice(0, at < 0 ? rest.length : at), block, ...rest.slice(at < 0 ? rest.length : at)];
  }, coalesce), [updateBlocks]);

  /* ---------- 字段快捷键：Enter 拆段、Backspace 合并、方向键跨块 ---------- */
  const keyCache = useRef(new Map<string, FieldKeyHandlers>());
  const keysFor = useCallback((blockId: string, field: string): FieldKeyHandlers => {
    const cacheKey = `${blockId}\u0000${field}`;
    const hit = keyCache.current.get(cacheKey);
    if (hit) return hit;
    const find = () => bookRef.current?.blocks.find(b => b.id === blockId);
    const navigate = (direction: "up" | "down") => {
      const block = find();
      if (!block) return false;
      const fields = fieldsOf(block, editionRef.current);
      const at = fields.indexOf(field);
      const target = fields[at + (direction === "down" ? 1 : -1)];
      if (target) { activate(blockId, target, direction === "down" ? "start" : "end"); return true; }
      const { list, index } = neighbours(blockId);
      return focusBlock(list[index + (direction === "down" ? 1 : -1)], direction === "down" ? "start" : "end");
    };
    const handlers: FieldKeyHandlers = {
      onEnter: editor => {
        const block = find();
        if (!block) return false;
        if ((block.kind === "text" || block.kind === "heading") && field === "text") {
          if (editor.state.selection.$from.depth > 1) return false;
          const rest = splitAtCursor(editor) as RichDoc;
          const fresh = { ...createBlock("text"), text: rest } as Block;
          updateBlocks(blocks => { const i = blocks.findIndex(b => b.id === blockId); return [...blocks.slice(0, i + 1), fresh, ...blocks.slice(i + 1)]; });
          activate(fresh.id, "text", "start");
          return true;
        }
        if (block.kind === "question" && field.startsWith("opt:")) {
          if (block.options.length >= 8) return navigate("down");
          const option = { id: uid("o"), text: { type: "doc", content: [{ type: "paragraph" }] } as RichDoc };
          updateBlocks(blocks => blocks.map(b => {
            if (b.id !== blockId || b.kind !== "question") return b;
            const i = b.options.findIndex(o => `opt:${o.id}` === field);
            return { ...b, options: [...b.options.slice(0, i + 1), option, ...b.options.slice(i + 1)] };
          }));
          activate(blockId, `opt:${option.id}`, "start");
          return true;
        }
        return false;
      },
      onBackspaceAtStart: editor => {
        const block = find();
        if (!block) return false;
        const { list, index } = neighbours(blockId);
        const previous = list[index - 1];
        const doc = editor.getJSON() as RichDoc;
        if (block.kind === "text" && previous?.kind === "text") {
          const junction = endOfDoc(previous.text);
          updateBlocks(blocks => blocks.flatMap(b => b.id === blockId ? [] : b.id === previous.id ? [{ ...previous, text: concatRich(previous.text, doc) }] : [b]));
          activate(previous.id, "text", { pos: junction });
          return true;
        }
        if ((block.kind === "text" || block.kind === "heading") && isRichEmpty(doc)) {
          updateBlocks(blocks => blocks.filter(b => b.id !== blockId));
          if (!focusBlock(previous, "end")) setSelection(null);
          return true;
        }
        if (block.kind === "heading") { replace(blockId, "text"); return true; }
        if (block.kind === "question" && field.startsWith("opt:") && isRichEmpty(doc) && block.options.length > 2) {
          const i = block.options.findIndex(o => `opt:${o.id}` === field);
          updateBlocks(blocks => blocks.map(b => b.id === blockId && b.kind === "question" ? { ...b, options: b.options.filter(o => `opt:${o.id}` !== field), correct: b.correct.filter(id => `opt:${id}` !== field) } : b));
          activate(blockId, i > 0 ? `opt:${block.options[i - 1].id}` : "stem", "end");
          return true;
        }
        return false;
      },
      onArrowOut: navigate,
      onTab: backwards => navigate(backwards ? "up" : "down"),
      onEscape: () => { setSelection(sel => sel ? { ...sel, field: null, serial: ++serial.current } : null); return true; },
      onSlash: () => {
        const block = find();
        if (block?.kind !== "text") return false;
        const rect = geometryRef.current?.rect(blockId);
        if (!rect) return false;
        setMenu({ anchor: { x: rect.x, y: rect.y + rect.h + 4 }, target: blockId, replace: true });
        return true;
      },
    };
    keyCache.current.set(cacheKey, handlers);
    return handlers;
  }, [activate, focusBlock, neighbours, updateBlocks, replace, setSelection]);

  const api = useMemo<BlockApi>(() => ({
    activate: (blockId, field, intent) => activate(blockId, field, intent),
    change: (blockId, field, doc) => updateBlocks(blocks => blocks.map(b => b.id === blockId ? writeField(b, field, doc) : b), `${blockId}:${field}:${selectionRef.current?.serial ?? 0}`),
    update: (blockId, recipe, coalesce) => updateBlocks(blocks => blocks.map(b => b.id === blockId ? recipe(b) : b), coalesce),
    select: blockId => { if (selectionRef.current?.blockId !== blockId || selectionRef.current.field) activate(blockId, null); },
    keys: keysFor,
    insertAfter,
    remove,
  }), [activate, updateBlocks, keysFor, insertAfter, remove]);

  const ops = useMemo<ToolbarOps>(() => ({ duplicate, replace, setEdition: next => { setSelection(sel => sel ? { ...sel, field: null } : null); setEdition(next); } }), [duplicate, replace, setSelection]);

  /* ---------- 全局键盘：撤销、块选择态操作 ---------- */
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || printing) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input,textarea,select,[contenteditable='true']"));
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z" && !typing) { event.preventDefault(); restore(event.shiftKey ? "redo" : "undo"); return; }
      if (mod && key === "y" && !typing) { event.preventDefault(); restore("redo"); return; }
      const sel = selectionRef.current;
      if (mod && key === "d" && sel) { event.preventDefault(); duplicate(sel.blockId); return; }
      if (typing || !sel || sel.field) return;
      const { list, index } = neighbours(sel.blockId);
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(sel.blockId); }
      else if (event.key === "Escape") { event.preventDefault(); setSelection(null); }
      else if (event.key === "Enter") { event.preventDefault(); const block = list[index]; if (block) focusBlock(block, "end"); }
      else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const neighbour = list[index + (event.key === "ArrowUp" ? -1 : 2)];
        move(sel.blockId, event.key === "ArrowUp" ? list[index - 1]?.id ?? list[0].id : neighbour?.id ?? null);
      }
      else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = list[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (next) activate(next.id, null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, printing, restore, duplicate, neighbours, remove, setSelection, focusBlock, move, activate]);

  /* ---------- 点击空白处退出编辑 ---------- */
  useEffect(() => {
    if (!active) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // 纸面空白由画布自身处理（续写或取消选中）。
      if (!target || target.closest(".wb-block, .wb-page, .wb-popover, .wb-keep, [data-wb-keep]")) return;
      if (target.closest(".wb-workspace")) { setSelection(null); setMenu(null); setLayoutOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, setSelection]);

  /* ---------- 适应窗口宽度的缩放 ---------- */
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !book) return;
    const pageW = pageGeometry(book).pageW;
    const fit = () => setZoom(Math.max(0.55, Math.min(1.1, (element.clientWidth - 160) / pageW)));
    fit();
    // 目录展开/收起期间宽度逐帧变化，等动画结束再统一缩放，避免逐帧重排。
    let timer = 0;
    const observer = new ResizeObserver(() => { clearTimeout(timer); timer = window.setTimeout(fit, 180); });
    observer.observe(element);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [book?.layout.paper]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 选中块滚入视野 ---------- */
  useEffect(() => {
    const sel = selection, element = scroller.current;
    if (!sel || !element) return;
    const frame = requestAnimationFrame(() => {
      const rect = geometryRef.current?.rect(sel.blockId), root = contentRoot(content).current;
      if (!rect || !root) return;
      const top = root.offsetTop + rect.y * zoom, bottom = top + rect.h * zoom;
      if (top < element.scrollTop + 60) element.scrollTo({ top: top - 90, behavior: "smooth" });
      else if (bottom > element.scrollTop + element.clientHeight - 40) element.scrollTo({ top: Math.min(top - 90, bottom - element.clientHeight + 80), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selection?.blockId, selection?.serial]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGeometry = useCallback((geo: CanvasGeometry) => { geometryRef.current = geo; setGeometry(geo); }, []);
  const contentTop = useCallback(() => contentRoot(content).current?.offsetTop ?? 0, []);

  /** 目录跳转：平滑滚到标题，并在纸面上轻闪一下提示位置。 */
  const jumpTo = useCallback((blockId: string) => {
    const element = scroller.current, rect = geometryRef.current?.rect(blockId);
    if (!element || !rect) return;
    element.scrollTo({ top: Math.max(0, contentTop() + rect.y * zoom - 28), behavior: "smooth" });
    const block = contentRoot(content).current?.querySelector<HTMLElement>(`.wb-block[data-block-id="${blockId}"]`);
    if (block) { block.removeAttribute("data-flash"); void block.offsetWidth; block.setAttribute("data-flash", ""); window.setTimeout(() => block.removeAttribute("data-flash"), 1200); }
  }, [contentTop, zoom]);

  const onBackground = useCallback((_page: number, _y: number, _last: boolean, belowLast: boolean) => {
    const current = bookRef.current;
    if (!current) return;
    if (!belowLast) { setSelection(null); setMenu(null); return; }
    const list = visibleBlocks(current.blocks, editionRef.current);
    const last = list[list.length - 1];
    if (last?.kind === "text" && isRichEmpty(last.text)) activate(last.id, "text", "end");
    else insertAfter(last?.id ?? null, "text");
  }, [activate, insertAfter, setSelection]);

  const onPlus = useCallback((blockId: string, anchor: HTMLElement) => {
    const root = contentRoot(content).current;
    if (!root) return;
    const a = anchor.getBoundingClientRect(), b = root.getBoundingClientRect();
    setSelection({ blockId, field: null, serial: ++serial.current });
    setMenu({ anchor: { x: (a.right - b.left) / zoom + 6, y: (a.top - b.top) / zoom - 6 }, target: blockId, replace: false });
  }, [zoom, setSelection]);

  const chooseInsert = useCallback((choice: InsertChoice) => {
    const target = menu;
    setMenu(null);
    if (!target) return;
    if (target.replace && target.target) replace(target.target, choice.kind, choice.variant);
    else insertAfter(target.target, choice.kind, choice.variant);
  }, [menu, replace, insertAfter]);

  // 空文档保持一个可直接书写的段落。
  useEffect(() => {
    if (book && !book.blocks.length) commit(current => current.blocks.length ? current : { ...current, blocks: [createBlock("text")] });
  }, [book, commit]);

  /* ---------- 导出 PDF：按所选版本完成分页后打印独立页面树 ---------- */
  const exportPdf = useCallback((target: Edition = editionRef.current) => {
    if (printing) return;
    setSelection(null); setMenu(null); setLayoutOpen(false);
    setPrinting({ edition: target, restore: editionRef.current, ready: false });
    setEdition(target);
  }, [printing, setSelection]);
  useImperativeHandle(handle, () => ({ exportPdf }), [exportPdf]);

  useEffect(() => {
    if (!printing || printing.ready || edition !== printing.edition) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setPrinting(p => p && { ...p, ready: true })); });
    return () => cancelAnimationFrame(frame);
  }, [printing, edition]);
  useEffect(() => {
    if (!printing?.ready || !book) return;
    const [w, h] = PAPER_SIZE[book.layout.paper];
    const style = document.createElement("style");
    style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0 }`;
    document.head.appendChild(style);
    let canceled = false;
    const run = async () => {
      try {
        await document.fonts.ready;
        await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#print-root img")).map(image => image.decode().catch(() => {})));
        if (canceled) return;
        const name = `${book.title}${printing.edition === "teacher" ? "（教师版）" : "（学生版）"}`;
        if (window.juanye) {
          const result = await window.juanye.exportPdf({ name, widthMm: w, heightMm: h });
          if (!result.canceled) toast({ title: "PDF 已导出", desc: result.path });
        } else window.print();
      } catch (error) {
        toast({ title: "导出失败", desc: error instanceof Error ? error.message : String(error), tone: "warn" });
      } finally {
        style.remove();
        if (!canceled) { setEdition(printing.restore); setPrinting(null); }
      }
    };
    const timer = setTimeout(() => { void run(); }, 80);
    return () => { canceled = true; clearTimeout(timer); style.remove(); };
  }, [printing?.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 渲染 ---------- */
  const setLayout = (patch: Partial<Workbook["layout"]>) => commit(current => ({ ...current, layout: { ...current.layout, ...patch } }));
  const selectedBlock = selection && book ? book.blocks.find(b => b.id === selection.blockId) : undefined;
  const readOnly = preview || Boolean(printing);

  useEffect(() => { setSlot(active ? document.getElementById("workbook-nav-slot") : null); }, [active]);
  useEffect(() => { if (preview) { setSelection(null); setMenu(null); } }, [preview, setSelection]);

  const tools = book && slot && createPortal(<div className="wb-nav-tools flex w-full min-w-0 items-center gap-1" data-wb-keep>
    <IconButton label={outlineOpen ? "收起目录" : "展开目录"} active={outlineOpen} onClick={() => setOutlineOpen(open => !open)}><ListTree size={15} /></IconButton>
    <input className="wb-title-input" value={book.title} aria-label="教辅名称" spellCheck={false} size={Math.max(6, Math.min(26, [...book.title].length + 1))}
      onChange={event => { const title = event.target.value; commit(current => ({ ...current, title }), "title"); }} />
    <SaveBadge saving={saving} error={saveError} />
    <span className="mx-2 h-4 w-px bg-line" aria-hidden="true" />
    <Segmented size="sm" value={edition} onChange={value => ops.setEdition(value)} options={[{ value: "student", label: "学生版" }, { value: "teacher", label: "教师版" }]} />
    <div className="ml-auto flex shrink-0 items-center gap-1">
    <IconButton label="撤销 Ctrl+Z" onClick={() => restore("undo")}><Undo2 size={15} /></IconButton>
    <IconButton label="重做 Ctrl+Shift+Z" onClick={() => restore("redo")}><Redo2 size={15} /></IconButton>
    <div className="relative">
      <Button variant="ghost" size="sm" icon={<SlidersHorizontal size={14} />} aria-expanded={layoutOpen} onClick={() => setLayoutOpen(open => !open)}>版式</Button>
      <AnimatePresence>{layoutOpen && <LayoutPanel book={book} setLayout={setLayout} onClose={() => setLayoutOpen(false)} />}</AnimatePresence>
    </div>
    <Button variant="ghost" size="sm" icon={preview ? <PenLine size={14} /> : <Eye size={14} />} onClick={() => setPreview(value => !value)}>{preview ? "继续编辑" : "预览"}</Button>
    <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
    <Button variant="primary" size="sm" icon={<FileDown size={14} />} disabled={Boolean(printing)} onClick={() => exportPdf(edition)}>{printing ? "正在导出…" : `导出${edition === "teacher" ? "教师版" : "学生版"}`}</Button>
    </div>
  </div>, slot);

  if (!book) return <div className="wb-workspace grid h-full w-full place-items-center text-[13px] text-muted">{saveError ? `教辅无法读取：${saveError}` : "正在打开教辅…"}</div>;

  return <div className="wb-workspace relative flex h-full w-full min-w-0">
    {tools}
    <motion.aside className="wb-outline" initial={false} animate={{ width: outlineOpen ? OUTLINE_WIDTH : 0, opacity: outlineOpen ? 1 : 0 }}
      transition={{ width: { type: "spring", stiffness: 380, damping: 36 }, opacity: { duration: 0.18 } }} aria-hidden={!outlineOpen}>
      <div style={{ width: OUTLINE_WIDTH }} className="h-full">
        <Outline book={book} edition={edition} geometry={geometry} zoom={zoom} scroller={scroller} contentTop={contentTop} selectedId={selection?.blockId} onJump={jumpTo} />
      </div>
    </motion.aside>
    <div ref={scroller} className="wb-scroller" data-preview={preview || undefined}>
      <div ref={content} className="wb-stage" style={{ paddingTop: 36, paddingBottom: 96 }}>
        <WorkbookCanvas book={book} edition={edition} selection={readOnly ? null : selection} readOnly={readOnly} zoom={zoom} api={api}
          onGeometry={onGeometry} onBackground={onBackground} onMove={move} onPlus={onPlus}
          overlay={geo => !readOnly && <>
            <FloatingToolbar geometry={geo} selection={selection} book={book} edition={edition} zoom={zoom} api={api} ops={ops} contentRef={contentRoot(content)} />
            <NodePanels selection={selection} zoom={zoom} contentRef={contentRoot(content)} pageWidth={geo.pageW} />
            <AnimatePresence>
              {selectedBlock?.kind === "formula" && selection?.field === "latex" && geo.rect(selectedBlock.id) && <MathHelper key={`f${selectedBlock.id}`} anchor={geo.rect(selectedBlock.id)!} width={geo.pageW} />}
              {menu && <InsertMenu key="insert" anchor={menu.anchor} title={menu.replace ? "把这一段换成…" : "插入"} onChoose={chooseInsert} onClose={() => setMenu(null)} />}
            </AnimatePresence>
          </>} />
      </div>
    </div>
    {printing?.ready && geometry && createPortal(<PrintPages book={book} edition={printing.edition} geometry={geometry} />, document.body)}
  </div>;
}

const OUTLINE_KEY = "juanye.workbook-outline.v1";
const OUTLINE_WIDTH = 228;

/** 浮层坐标以 .wb-content（缩放根）为准。 */
function contentRoot(stage: React.RefObject<HTMLDivElement>): React.RefObject<HTMLDivElement> {
  return { get current() { return stage.current?.querySelector<HTMLDivElement>(".wb-content") ?? null; } } as React.RefObject<HTMLDivElement>;
}

function LayoutPanel({ book, setLayout, onClose }: { book: Workbook; setLayout: (patch: Partial<Workbook["layout"]>) => void; onClose: () => void }) {
  const l = book.layout;
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const row = (label: string, control: React.ReactNode) => <div className="wb-layout-row"><span>{label}</span>{control}</div>;
  return <motion.div className="wb-layout-panel wb-popover" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
    transition={{ opacity: { duration: 0.15 }, default: { type: "spring", stiffness: 500, damping: 35 } }}>
    {row("纸张", <Segmented size="sm" value={l.paper} onChange={paper => setLayout({ paper })} options={PAPERS.map(p => ({ value: p, label: p }))} />)}
    {row("字号", <Segmented size="sm" value={l.fontSize} onChange={fontSize => setLayout({ fontSize })} options={FONT_SIZES.map(s => ({ value: s, label: s === 10.5 ? "五号" : `${s}` }))} />)}
    {row("行距", <Segmented size="sm" value={l.lineHeight} onChange={lineHeight => setLayout({ lineHeight })} options={LINE_HEIGHTS.map(v => ({ value: v, label: v.toFixed(1) }))} />)}
    {row("正文", <Segmented size="sm" value={l.font} onChange={font => setLayout({ font })} options={[{ value: "serif", label: "宋体" }, { value: "sans", label: "黑体" }]} />)}
    {row("主题色", <div className="flex gap-1.5">{(Object.keys(ACCENTS) as WorkbookAccent[]).map(accent => <button key={accent} type="button" aria-label={accent} className={cx("wb-accent-dot", l.accent === accent && "is-active")} style={{ "--dot": ACCENTS[accent] } as CSSProperties} onClick={() => setLayout({ accent })} />)}</div>)}
    {row("页眉", <Switch checked={l.header} onChange={header => setLayout({ header })} label="页眉" />)}
    {row("页码", <Switch checked={l.pageNumber} onChange={pageNumber => setLayout({ pageNumber })} label="页码" />)}
  </motion.div>;
}

/** 打印页面树：1:1 尺寸，沿用屏幕测得的分页位置。 */
function PrintPages({ book, edition, geometry }: { book: Workbook; edition: Edition; geometry: CanvasGeometry }) {
  const geo = pageGeometry(book);
  const blocks = visibleBlocks(book.blocks, edition);
  const numbers = useMemo(() => questionNumbers(book.blocks), [book.blocks]);
  const noop = useMemo<BlockApi>(() => ({ activate() {}, change() {}, update() {}, select() {}, keys: () => ({}), insertAfter() {}, remove() {} }), []);
  const pages = Array.from({ length: geometry.pages }, (_, page) => blocks.filter(b => geometry.placements.get(b.id)?.page === page));
  return <div id="print-root" aria-hidden="true" className="wb-print" style={{ position: "fixed", left: -100000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
    {pages.map((items, page) => <div key={page} className="print-page wb-content" data-edition={edition} data-readonly="" style={{ ...canvasVars(book), position: "relative", width: geo.pageW, height: geo.pageH, overflow: "hidden" } as CSSProperties}>
      <PageChrome book={book} page={page} firstBlock={items[0]} />
      {items.map(block => <div key={block.id} className="wb-block" data-kind={block.kind} style={{ position: "absolute", left: geo.marginLeft, top: geo.marginTop + (geometry.placements.get(block.id)?.top ?? 0), width: geo.contentW }}>
        <BlockView block={block} edition={edition} activeField={undefined} number={numbers.get(block.id)} readOnly api={noop} contentWidth={geo.contentW} />
      </div>)}
    </div>)}
  </div>;
}
