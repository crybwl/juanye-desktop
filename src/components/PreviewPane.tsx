import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useSpring, useTransform, type MotionValue } from "motion/react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { FileText, LayoutGrid, Maximize2, Minus, Plus, SlidersHorizontal, FileCode2 } from "lucide-react";
import type { Exam, Layout, Mode, PreviewView } from "../types";
import { AnswerCard, PaperPages, pageDims } from "./Paper";
import { IconButton, Segmented, softSpring } from "../ui";
import { previewPageAt, previewScale } from "../preview-geometry";
import "./paper-columns.css";

const ScaledPage = memo(function ScaledPage({ s, pw, ph, i, total, onPages, children }: { s: MotionValue<number>; pw: number; ph: number; i: number; total: number; onPages: (total: number) => void; children: ReactNode }) {
  const w = useTransform(s, (v) => v * pw);
  const h = useTransform(s, (v) => v * ph);
  useEffect(() => { if (i === 0) onPages(total); }, [i, total, onPages]);
  return (
    <motion.div
      data-page={i}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...softSpring, delay: 0.05 + i * 0.07 }}
      style={{ width: w, height: h }}
      className="relative shrink-0 rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,.04),0_24px_60px_-18px_rgba(0,0,0,.75),0_8px_20px_-10px_rgba(0,0,0,.5)]"
    >
      <motion.div style={{ scale: s, originX: 0, originY: 0, width: pw, height: ph, containIntrinsicSize: `${pw}px ${ph}px` }} className="preview-page-content absolute left-0 top-0 overflow-hidden rounded-[3px]">
        {children}
      </motion.div>
    </motion.div>
  );
});

function PageCounter({ canvas, scale, ph, pages }: { canvas: RefObject<HTMLDivElement>; scale: MotionValue<number>; ph: number; pages: number }) {
  const [page, setPage] = useState(1);
  const update = useCallback(() => {
    const c = canvas.current;
    if (c) {
      const next = previewPageAt(c.scrollTop, c.clientHeight, ph, scale.get(), pages);
      setPage(previous => previous === next ? previous : next);
    }
  }, [canvas, scale, ph, pages]);
  useMotionValueEvent(scale, "change", update);
  useEffect(() => {
    const c = canvas.current;
    c?.addEventListener("scroll", update, { passive: true });
    let lastHeight = -1;
    const resize = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height !== lastHeight) { lastHeight = entry.contentRect.height; update(); }
    });
    if (c) resize.observe(c);
    update();
    return () => { c?.removeEventListener("scroll", update); resize.disconnect(); };
  }, [canvas, update]);
  return <span className="inline-flex items-center overflow-hidden whitespace-nowrap px-2 text-[12px] tabular-nums text-muted">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={page} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="inline-block">{page}</motion.span>
    </AnimatePresence>
    &nbsp;/ {pages} 页
  </span>;
}

export const PreviewPane = memo(function PreviewPane({
  exam,
  layout,
  view,
  setView,
  mode,
  activeId,
  onPick,
  onLayout,
  onTex,
  score,
  count,
}: {
  exam: Exam;
  layout: Layout;
  view: PreviewView;
  setView: (v: PreviewView) => void;
  mode: Mode;
  activeId: string | null;
  onPick: (id: string) => void;
  onLayout: () => void;
  onTex: () => void;
  score: number;
  count: number;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const cw = useMotionValue(560);
  const zoom = useMotionValue(1);
  const [pages, setPages] = useState(1);
  // Only the on-screen document can lag behind typing. App's print portal and all
  // exports keep the immediate exam. Selection changes bypass this deferral so
  // new/imported questions remain available to the existing auto-scroll effect.
  const document = useMemo(() => ({ exam, score, count, activeId }), [exam, score, count, activeId]);
  const deferredDocument = useDeferredValue(document);
  const preview = deferredDocument.activeId === activeId ? deferredDocument : document;
  const { pw, ph } = pageDims(layout);
  const paperWidth = useMotionValue(pw);
  const cap = useMotionValue(mode === "preview" ? 1.05 : 1);
  useLayoutEffect(() => { paperWidth.set(pw); cap.set(mode === "preview" ? 1.05 : 1); }, [pw, mode, paperWidth, cap]);

  useLayoutEffect(() => {
    const el = canvas.current!;
    const ro = new ResizeObserver(([e]) => cw.set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [cw]);

  const target = useTransform(() => previewScale(cw.get(), paperWidth.get(), cap.get(), zoom.get()));
  const percent = useTransform(target, value => `${Math.round(value * 100)}%`);
  const s = useSpring(target, { stiffness: 260, damping: 34 });
  // Event handlers can change in App without invalidating the entire paper subtree.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((id: string) => pickRef.current(id), []);
  const renderPage = useCallback((p: ReactNode, i: number, total: number) => <ScaledPage s={s} pw={pw} ph={ph} i={i} total={total} onPages={setPages}>{p}</ScaledPage>, [s, pw, ph]);

  // 选中题目后，预览自动滚动到对应位置
  useEffect(() => {
    if (!activeId) return;
    const t = window.setTimeout(() => {
      const c = canvas.current;
      const el = c?.querySelector<HTMLElement>(`[data-sheet] [data-qid="${CSS.escape(activeId)}"]`);
      if (!c || !el) return;
      const cr = c.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (er.top < cr.top + 56 || er.bottom > cr.bottom - 72)
        c.scrollTo({ top: c.scrollTop + er.top - cr.top - cr.height * 0.28, behavior: "smooth" });
    }, 80);
    return () => clearTimeout(t);
  }, [activeId, view]);

  const paperLabel = `${layout.paper} ${layout.orientation === "portrait" ? "纵向" : "横向"}${view === "paper" && layout.columns === 2 ? " · 双栏" : ""}${layout.sealLine ? " · 密封线" : ""}`;

  return (
    <div className="relative flex h-full min-w-0 flex-col" data-preview-pending={preview.exam !== exam || undefined}>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3.5">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "paper", label: "题卷", icon: <FileText size={13} /> },
            { value: "card", label: "答题卡", icon: <LayoutGrid size={13} /> },
          ]}
        />
        <div className="min-w-0 flex-1 truncate text-[12px] text-faint">
          {paperLabel} · {count} 小题 · 满分 {score}
        </div>
        <IconButton label="导出 .tex" onClick={onTex}>
          <FileCode2 size={15} />
        </IconButton>
        <IconButton label={mode === "preview" ? "返回编辑" : "排版设置"} active={mode === "preview"} onClick={onLayout} kbd="Ctrl 2">
          <SlidersHorizontal size={15} />
        </IconButton>
      </div>

      <div ref={canvas} className="preview-canvas canvas-dots relative min-h-0 flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${view}-${layout.paper}-${layout.orientation}`}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.14 } }}
            transition={softSpring}
            className="flex min-w-fit flex-col items-center gap-7 px-8 pb-24 pt-8"
          >
            {view === "paper" ? (
              <PaperPages
                exam={preview.exam}
                layout={layout}
                totalScore={preview.score}
                qCount={preview.count}
                interactive
                activeId={activeId}
                onPick={pick}
                render={renderPage}
              />
            ) : (
              <AnswerCard exam={preview.exam} layout={layout} render={renderPage} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 悬浮缩放条 */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...softSpring, delay: 0.3 }}
        className="glass absolute bottom-4 left-1/2 flex h-10 -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line-strong px-1 shadow-2xl"
      >
        <IconButton label="缩小" side="top" onClick={() => zoom.set(Math.max(0.5, +(zoom.get() - 0.1).toFixed(2)))}>
          <Minus size={15} />
        </IconButton>
        <button
          onClick={() => zoom.set(1)}
          className="h-8 w-14 rounded-lg text-center text-[12px] font-medium tabular-nums text-muted transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <motion.span>{percent}</motion.span>
        </button>
        <IconButton label="放大" side="top" onClick={() => zoom.set(Math.min(2.5, +(zoom.get() + 0.1).toFixed(2)))}>
          <Plus size={15} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <IconButton label="适应宽度" side="top" onClick={() => zoom.set(1)}>
          <Maximize2 size={14} />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line-strong" />
        <PageCounter canvas={canvas} scale={s} ph={ph} pages={pages} />
      </motion.div>
    </div>
  );
});
