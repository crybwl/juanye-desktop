import { AnimatePresence, motion } from "motion/react";
import { createContext, forwardRef, memo, useCallback, useContext, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Minus,
  Plus,
  ScanText,
  Sigma,
  SquareRadical,
  Trash2,
  Underline,
  Divide,
  Sparkles,
  MousePointerClick,
  Copy,
  Table2,
  FileText,
  Image,
  SlidersHorizontal,
  ListChecks,
} from "lucide-react";
import type { Question, Section, QType, Layout } from "../types";
import { CN_NUM, LETTERS, TYPE_META } from "../data";
import { MathText, highlightTex } from "../math";
import { Button, IconButton, cx, spring, softSpring, inputCls } from "../ui";
import { PlotSvg } from "./Paper";
import { FigureEditor } from "./FigureEditor";
import { DrawingEditor } from "./DrawingEditor";
import { FormulaEditor } from "./FormulaEditor";
import { SourceOcr } from "./SourceOcr";
import { Select } from "./Select";
import { changeQuestionType } from "../structure";
import { hasOptions, isLongAnswer } from "../figures";
import { Switch } from "../ui";
import { fillQuestionOptions } from "../question-options";
import { useExperimentalWorkbench } from "../experimental-workbench";
import { questionFigures } from "../figures";
import "./editor-workbench.css";

const QuestionDrawingEditor = memo(DrawingEditor);

/* ---------- 带语法高亮的 LaTeX 编辑器（透明 textarea 叠在高亮层上） ---------- */
export type TexHandle = { insert: (snippet: string, caretBack?: number) => void };
export const TexEditor = forwardRef<TexHandle, { value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; placeholder?: string; minH?: number }>(
  function TexEditor({ value, onChange, onCommit, placeholder, minH = 92 }, ref) {
    const ta = useRef<HTMLTextAreaElement>(null);
    const [formula, setFormula] = useState(false);
    const [initial, setInitial] = useState("");
    const highlighted = useMemo(() => highlightTex(value), [value]);
    const selection = useRef({ start: 0, end: 0 });
    const insert = (snippet: string, caretBack = 0) => {
      const el = ta.current!;
      const s = el.selectionStart ?? value.length;
      const e = el.selectionEnd ?? value.length;
      onChange(value.slice(0, s) + snippet + value.slice(e));
      requestAnimationFrame(() => { el.focus(); const pos = s + snippet.length - caretBack; el.setSelectionRange(pos, pos); });
    };
    useImperativeHandle(
      ref,
      () => ({
        insert,
      }),
      [value, onChange],
    );
    return (
      <div
        className="relative rounded-xl border border-line-strong bg-[#0a0c11] transition-[border-color,box-shadow] duration-200 hover:border-white/[0.16] focus-within:border-accent/55 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
        style={{ minHeight: minH }}
      >
        <pre
          aria-hidden
          className="tex-editor m-0 px-4 py-3 text-fg/80"
          style={{ minHeight: minH }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <textarea
          ref={ta}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.currentTarget.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (!onCommit || !text) return;
            e.preventDefault();
            const start = e.currentTarget.selectionStart, end = e.currentTarget.selectionEnd;
            onCommit(value.slice(0, start) + text + value.slice(end));
            requestAnimationFrame(() => {
              const el = ta.current;
              if (el) { const position = Math.min(start + text.length, el.value.length); el.setSelectionRange(position, position); }
            });
          }}
          className="tex-editor absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent px-4 py-3 text-transparent caret-accent outline-none placeholder:text-faint"
        />
        <button type="button" aria-label="打开公式编辑器" title="公式编辑器" className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded bg-panel text-faint hover:text-accent" onMouseDown={event => event.preventDefault()} onClick={() => { const el = ta.current!; selection.current = { start: el.selectionStart, end: el.selectionEnd }; setInitial(value.slice(el.selectionStart, el.selectionEnd)); setFormula(true); }}><Sigma size={13} /></button>
        <FormulaEditor open={formula} initial={initial} onClose={() => setFormula(false)} onInsert={snippet => { ta.current!.setSelectionRange(selection.current.start, selection.current.end); insert(snippet); }} />
      </div>
    );
  },
);

/* ---------- 小部件 ---------- */
const item = {
  enter: { opacity: 0, y: 10 },
  center: { opacity: 1, y: 0, transition: softSpring },
  exit: { opacity: 0 },
};

type WorkbenchGroup = "question" | "answers" | "figures" | "properties";
const WorkbenchContext = createContext<{ enabled: boolean; group: WorkbenchGroup }>({ enabled: false, group: "question" });
const WORKBENCH_GROUPS = [
  { id: "question", label: "题目", icon: FileText },
  { id: "answers", label: "答案解析", icon: ListChecks },
  { id: "figures", label: "题图与绘图", icon: Image },
  { id: "properties", label: "属性", icon: SlidersHorizontal },
] as const;

function Card({ title, right, children, className, group = "question" }: { title?: string; right?: ReactNode; children: ReactNode; className?: string; group?: WorkbenchGroup }) {
  const workbench = useContext(WorkbenchContext);
  return (
    <motion.section variants={item} data-workbench-group={group} hidden={workbench.enabled && workbench.group !== group} className={cx(workbench.enabled ? "workbench-section" : "rounded-2xl border border-line bg-white/[0.018] p-5", className)}>
      {title && <div className="workbench-section-header mb-3.5 flex min-h-8 items-center gap-3">
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        <div className="workbench-section-tools ml-auto flex items-center gap-1">{right}</div>
      </div>}
      {children}
    </motion.section>
  );
}

const LivePreview = memo(function LivePreview({ text, image }: { text: string; image?: boolean }) {
  const deferredText = useDeferredValue(text);
  return (
    <div className="workbench-live-preview mt-3 rounded-xl bg-white/[0.025] px-4 py-3.5 ring-1 ring-inset ring-white/[0.04]">
      <div className="mb-2 flex items-center gap-2 text-[11.5px] text-faint">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
        </span>
        预览
      </div>
      <div className="font-serif text-[15.5px] leading-[1.9] text-fg/95">
        <MathText text={deferredText} placeholder="在上方输入题干…" />
      </div>
      {image && (
        <div className="mt-3 flex justify-center">
          <PlotSvg ink="#c9cddb" accent="var(--color-accent)" width={250} />
        </div>
      )}
    </div>
  );
});

function ScoreStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-9 items-center rounded-[10px] bg-white/[0.05] ring-1 ring-inset ring-white/[0.06]">
      <motion.button whileTap={{ scale: 0.8 }} aria-label="减少分值" onClick={() => onChange(Math.max(1, value - 1))} className="grid h-9 w-8 place-items-center text-muted hover:text-fg">
        <Minus size={14} />
      </motion.button>
      <div className="flex min-w-[46px] items-center justify-center gap-0.5 text-[14px] font-semibold">
        <input aria-label="本题分值" type="number" min={0} max={200} step={0.5} value={value} onChange={e => { const next = Number(e.target.value); if (Number.isFinite(next)) onChange(Math.max(0, Math.min(200, next))); }} className="w-10 bg-transparent text-center text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="text-[12px] font-normal text-muted">分</span>
      </div>
      <motion.button whileTap={{ scale: 0.8 }} aria-label="增加分值" onClick={() => onChange(Math.min(30, value + 1))} className="grid h-9 w-8 place-items-center text-muted hover:text-fg">
        <Plus size={14} />
      </motion.button>
    </div>
  );
}

function OptionCard({
  letter,
  text,
  correct,
  onToggle,
  onChange,
  onRemove,
}: {
  letter: string;
  text: string;
  correct: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <motion.div
      layout
      transition={spring}
      className={cx(
        "workbench-option group relative flex min-h-[58px] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-200",
        correct ? "border-ok/40 bg-ok/[0.07]" : "border-line-strong bg-white/[0.015] hover:border-white/[0.16] hover:bg-white/[0.03]",
      )}
    >
      <motion.button
        whileTap={{ scale: 0.86 }}
        onClick={onToggle}
        aria-label={`将 ${letter} 设为正确答案`}
        className={cx(
          "workbench-option-letter relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-semibold transition-colors duration-200",
          correct ? "bg-ok text-[#06160e]" : "bg-white/[0.07] text-muted hover:bg-white/[0.12] hover:text-fg",
        )}
      >
        {letter}
        <AnimatePresence>
          {correct && (
            <motion.span
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 600, damping: 22 }}
              className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-[#0d0f14] text-ok ring-2 ring-[#0d0f14]"
            >
              <Check size={11} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <div className="min-w-0 flex-1 cursor-text" onClick={() => setEditing(true)}>
        <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.input
              key="i"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.12 }}
              autoFocus
              value={text}
              aria-label={`选项 ${letter}`}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.target as HTMLInputElement).blur()}
              className="tex-editor h-8 w-full rounded-md bg-black/30 px-2 text-fg outline-none ring-1 ring-accent/40"
            />
          ) : (
            <motion.div
              key="v"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.12 }}
              className="workbench-option-text truncate font-serif text-[15px] text-fg/95"
            >
              <MathText text={text} placeholder="（空）点击输入" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <button type="button" aria-label={`删除选项 ${letter}`} className="shrink-0 text-faint hover:text-danger" onClick={onRemove}><Trash2 size={12} /></button>
    </motion.div>
  );
}

/* ---------- 空状态 ---------- */
function Empty({ onStart, onOcr }: { onStart: () => void; onOcr: () => void }) {
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={softSpring}
      className="flex h-full flex-col items-center justify-center px-10 pb-16 text-center"
    >
      <div className="relative mb-9 h-[150px] w-[220px]">
        {[
          { r: -9, x: -34, y: 10, d: 0 },
          { r: 7, x: 34, y: 6, d: 0.4 },
          { r: 0, x: 0, y: 0, d: 0.8 },
        ].map((c, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-0 h-[140px] w-[108px] -ml-[54px] rounded-xl border border-white/10 bg-gradient-to-b from-[#1b1f2b] to-[#12151d] p-3 shadow-2xl"
            initial={{ rotate: c.r, x: c.x, y: c.y + 20, opacity: 0 }}
            animate={{ rotate: c.r, x: c.x, y: [c.y, c.y - 6, c.y], opacity: 1 }}
            transition={{ y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: c.d }, opacity: { delay: c.d * 0.3 } }}
          >
            <div className="mb-2 h-1.5 w-12 rounded bg-white/20" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="mb-1.5 h-1 rounded bg-white/[0.07]" style={{ width: `${60 + ((j * 37) % 40)}%` }} />
            ))}
            {i === 2 && (
              <div className="mt-3 grid h-8 place-items-center rounded-md bg-accent/15 font-serif text-[13px] text-accent">
                <MathText text="$\int_0^1 x\,dx$" />
              </div>
            )}
          </motion.div>
        ))}
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight">选择一道题，开始校对</h2>
      <div className="mt-6 flex gap-2.5">
        <Button variant="primary" onClick={onStart} icon={<MousePointerClick size={15} />}>
          从第 1 题开始
        </Button>
        <Button variant="outline" onClick={onOcr} icon={<ScanText size={15} />}>
          一图多题识别
        </Button>
      </div>
    </motion.div>
  );
}

/* ---------- 编辑器主体 ---------- */
export const Editor = memo(function Editor({
  q,
  dataReady = true,
  paperMode = "questions",
  sec,
  secIndex,
  num,
  total,
  dir,
  onChange,
  onPrev,
  onNext,
  onConvert,
  onDelete,
  onStart,
  onOcr,
  neighbors,
  onDuplicate, onMove, sections,
  focusTarget,
}: {
  q: Question | null;
  dataReady?: boolean;
  paperMode?: Layout["paperMode"];
  sec: Section | null;
  secIndex: number;
  num: number;
  total: number;
  dir: number;
  onChange: (patch: Partial<Question>) => void;
  onPrev: () => void;
  onNext: () => void;
  onConvert: () => void;
  onDelete: () => void;
  onStart: () => void;
  onOcr: () => void;
  neighbors: { prev?: { num: number; stem: string }; next?: { num: number; stem: string } };
  onDuplicate?: () => void;
  onMove?: (sectionId: string) => void;
  sections?: Section[];
  /** Optional entry intent for a newly opened versioned bank draft. */
  focusTarget?: "question" | "answer" | "analysis";
}) {
  const stemRef = useRef<TexHandle>(null);
  const editorRoot = useRef<HTMLDivElement>(null);
  const [workbench] = useExperimentalWorkbench();
  const [group, setGroup] = useState<WorkbenchGroup>(focusTarget && focusTarget !== "question" ? "answers" : "question");
  const workbenchId = useId();
  const groupNav = useRef<HTMLDivElement>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const workbenchContext = useMemo(() => ({ enabled: workbench, group }), [workbench, group]);
  const changeDrawing = useCallback((drawing: string) => onChange({ drawing }), [onChange]);
  useEffect(() => {
    if (!focusTarget || !q) return;
    setGroup(focusTarget === "question" ? "question" : "answers");
    if (focusTarget === "analysis") setShowAnalysis(true);
    const root = editorRoot.current;
    if (!root) return;
    const questionId = q.id;
    let observer: MutationObserver | undefined;
    const focus = () => {
      const body = [...root.querySelectorAll<HTMLElement>("[data-editor-question]")].find(node => node.dataset.editorQuestion === questionId);
      if (!body) return;
      const selectors = focusTarget === "question" ? 'textarea[placeholder="输入题干…"]'
        : focusTarget === "analysis" ? 'textarea[placeholder="写下解题思路…"]'
        : '[aria-label^="正确选项 "], [aria-label^="将 "][aria-label$=" 设为正确答案"], textarea[placeholder="输入答案…"]';
      const target = [...body.querySelectorAll<HTMLElement>(selectors)].find(node => !node.closest("[hidden],[inert]") && node.getClientRects().length > 0);
      if (!target) return;
      target.focus({ preventScroll: true });
      if (document.activeElement !== target) return;
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      observer?.disconnect();
      return true;
    };
    // A question transition can still be showing its exiting predecessor. Wait
    // for the matching body/group rather than querying or clicking global tabs.
    if (focus()) return;
    observer = new MutationObserver(focus);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    const timeout = window.setTimeout(() => observer?.disconnect(), 2000);
    return () => { window.clearTimeout(timeout); observer?.disconnect(); };
  }, [focusTarget, q?.id, workbench]);
  const inspectedQuestion = useRef<string | null>(null);
  useEffect(() => {
    if (!dataReady || !q || inspectedQuestion.current === q.id) return;
    inspectedQuestion.current = q.id;
    const filled = fillQuestionOptions(q);
    if (filled !== q) onChange({ stem: filled.stem, options: filled.options, type: filled.type });
  }, [dataReady, q, onChange]);
  const commitStem = (stem: string) => {
    if (!q) return;
    const filled = fillQuestionOptions({ ...q, stem });
    if (filled.stem !== q.stem || filled.type !== q.type || filled.options !== q.options) onChange({ stem: filled.stem, options: filled.options, type: filled.type });
  };

  return (
    <WorkbenchContext.Provider value={workbenchContext}>
    <div ref={editorRoot} className={cx("h-full overflow-y-auto overflow-x-hidden", workbench && "experimental-workbench")} data-editor-workbench={workbench ? "experimental" : "classic"}>
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        {!q || !sec ? (
          <Empty key="empty" onStart={onStart} onOcr={onOcr} />
        ) : (
          <motion.div
            key={q.id}
            data-editor-question={q.id}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, y: d * 18, filter: "blur(3px)" }),
              center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { ...softSpring, staggerChildren: 0.035 } },
              exit: (d: number) => ({ opacity: 0, y: d * -12, filter: "blur(3px)", transition: { duration: 0.12 } }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            className="workbench-body mx-auto flex max-w-[780px] flex-col gap-4 px-10 pb-16 pt-7"
          >
            {/* 头部 */}
            <motion.div variants={item}>
              <div className="flex items-center gap-2 text-[12px] text-faint">
                <span
                  className="grid h-5 w-5 place-items-center rounded-[6px] text-[11px] font-semibold"
                  style={{ background: `color-mix(in srgb, ${TYPE_META[sec.type].hue} 16%, transparent)`, color: TYPE_META[sec.type].hue }}
                >
                  {CN_NUM[secIndex]}
                </span>
                {sec.title}
                <ChevronRight size={12} />
                <span className="text-muted">第 {num} 题</span>
                <span className="ml-auto tabular-nums">
                  {num} / {total}
                </span>
              </div>
              <div className="workbench-heading-row mt-3 flex flex-wrap items-center gap-3">
                <h1 className="workbench-heading text-[26px] font-semibold tracking-tight">第 {num} 题</h1>
                <Select aria-label="题型" className="max-w-[140px]" value={q.type} onValueChange={type => onChange(changeQuestionType(q, type as QType))} options={Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))} />
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <ScoreStepper value={q.score} onChange={(score) => onChange({ score })} />
                  <div className="ml-1 flex items-center">
                    <IconButton label="上一题" kbd="Alt ↑" onClick={onPrev} disabled={!neighbors.prev}>
                      <ChevronUp size={17} />
                    </IconButton>
                    <IconButton label="下一题" kbd="Alt ↓" onClick={onNext} disabled={!neighbors.next}>
                      <ChevronDown size={17} />
                    </IconButton>
                    <IconButton label="删除题目" onClick={onDelete} className="hover:!text-danger">
                      <Trash2 size={15} />
                    </IconButton>
                    <IconButton label="复制题目" onClick={onDuplicate} disabled={!onDuplicate}><Copy size={15} /></IconButton>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 校对提示 */}
            <AnimatePresence initial={false}>
              {q.flag && (
                <motion.div
                  key="flag"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0, marginTop: -16 }}
                  transition={softSpring}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 rounded-xl border border-warn/25 bg-warn/[0.07] px-4 py-3">
                    <AlertTriangle size={16} className="shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-warn">{q.flag}</div>
                      {!/待核对|B卷|AI/.test(q.flag) && <div className="text-[12px] text-warn/70">建议转为解答题，并从题干中提取分值。</div>}
                    </div>
                    {!/待核对|B卷|AI/.test(q.flag) && <Button size="sm" variant="secondary" icon={<ArrowRightLeft size={13} />} onClick={onConvert}>
                      转为解答题
                    </Button>}
                    <Button size="sm" variant="ghost" onClick={() => onChange({ flag: undefined })}>
                      {/待核对|B卷|AI/.test(q.flag) ? "标记已核对" : "忽略"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {workbench && <div ref={groupNav} className="workbench-nav" role="tablist" aria-label="题目编辑分组" onKeyDown={event => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const index = WORKBENCH_GROUPS.findIndex(entry => entry.id === group);
              const next = event.key === "Home" ? 0 : event.key === "End" ? WORKBENCH_GROUPS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + WORKBENCH_GROUPS.length) % WORKBENCH_GROUPS.length;
              setGroup(WORKBENCH_GROUPS[next].id);
              groupNav.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
            }}>
              {WORKBENCH_GROUPS.map(entry => {
                const selected = group === entry.id;
                const hasContent = entry.id === "answers" ? Boolean(q.analysis || q.answer.some(Boolean)) : entry.id === "figures" ? Boolean(q.sourceImage || q.image || q.drawing || questionFigures(q).length) : false;
                const Icon = entry.icon;
                return <button key={entry.id} id={`${workbenchId}-${entry.id}`} type="button" role="tab" aria-selected={selected} aria-controls={`${workbenchId}-panel`} tabIndex={selected ? 0 : -1} className="workbench-tab" onClick={() => setGroup(entry.id)}>
                  {selected && <motion.span layoutId={`${workbenchId}-pill`} transition={spring} className="workbench-tab-pill" />}
                  <Icon size={14} className="workbench-tab-icon shrink-0" />
                  <span>{entry.label}</span>
                  {hasContent && <span className="workbench-tab-dot" aria-hidden="true" />}
                </button>;
              })}
            </div>}
            <motion.div id={`${workbenchId}-panel`} role={workbench ? "tabpanel" : undefined} aria-labelledby={workbench ? `${workbenchId}-${group}` : undefined} tabIndex={workbench ? 0 : undefined} className={workbench ? "workbench-panel--experimental" : "workbench-panel--classic"}>
            {/* 题干 */}
            <Card
              title="题干"
              right={
                <>
                  <IconButton label="行内公式" onClick={() => stemRef.current?.insert("$x$", 1)}>
                    <Sigma size={15} />
                  </IconButton>
                  <IconButton label="分式" onClick={() => stemRef.current?.insert("$\\frac{}{}$", 4)}>
                    <Divide size={15} />
                  </IconButton>
                  <IconButton label="根号" onClick={() => stemRef.current?.insert("$\\sqrt{}$", 2)}>
                    <SquareRadical size={15} />
                  </IconButton>
                  <IconButton label="填空横线" onClick={() => stemRef.current?.insert("______")}>
                    <Underline size={15} />
                  </IconButton>
                  <IconButton label="插入表格" onClick={() => stemRef.current?.insert("\n\n| 项目 | 数值 | 合计 |\n| --- | --- | --- |\n| 内容 | $1$ | $1$ |\n| 内容 | $2$ | $2$ |\n\n")}>
                    <Table2 size={15} />
                  </IconButton>
                  <span className="mx-1 h-4 w-px bg-line-strong" />
                  <IconButton label="打开图片识别" onClick={onOcr}>
                    <Sparkles size={15} />
                  </IconButton>
                </>
              }
            >
              <TexEditor ref={stemRef} value={q.stem} onChange={(stem) => onChange({ stem })} onCommit={commitStem} placeholder="输入题干…" />
              <LivePreview text={q.stem} image={q.image === "plot"} />
            </Card>

            {q.sourceImage && <Card group="figures" title="原图对照"><SourceOcr key={q.id} question={q} onChange={onChange} /></Card>}
            <Card group="figures"><FigureEditor key={q.id} question={q} onChange={onChange} /></Card>
            <Card group="figures"><QuestionDrawingEditor key={q.id} value={q.drawing || ""} onChange={changeDrawing} /></Card>
            <Card group="properties" title="属性">
              <div className="space-y-3 text-[12px]">
                {onMove && sections && <label className="flex items-center gap-3"><span className="w-16 shrink-0 text-muted">所属大题</span><Select aria-label="移动到大题" value={sec.id} onValueChange={onMove} options={sections.map(section => ({ value: section.id, label: section.title }))} /></label>}
                <label className="flex items-center gap-3"><span className="w-16 shrink-0 text-muted">来源</span><input aria-label="题目来源" className={inputCls} value={q.source || ""} onChange={event => onChange({ source: event.target.value })} /></label>
                <label className="flex items-center gap-3"><span className="w-16 shrink-0 text-muted">知识点</span><input aria-label="题目知识点" className={inputCls} value={q.knowledge?.join("，") || ""} onChange={event => onChange({ knowledge: event.target.value.split(/[,，、;；]/) })} /></label>
                <label className="flex items-center gap-3"><span className="w-16 shrink-0 text-muted">难度</span><Select aria-label="题目难度" value={q.difficulty || ""} onValueChange={value => onChange({ difficulty: (value || undefined) as Question["difficulty"] })} options={[{ value: "", label: "未设置" }, { value: "easy", label: "基础" }, { value: "medium", label: "中等" }, { value: "hard", label: "较难" }]} /></label>
                {isLongAnswer(q.type) && <label className="flex items-center gap-3"><span className="w-20 shrink-0 text-muted">答题卡空间</span><Select aria-label="答题卡空间" value={q.answerSpace ?? "auto"} onValueChange={value => onChange({ answerSpace: value as Question["answerSpace"] })} options={[{ value: "auto", label: "自动" }, { value: "quarter", label: "四分之一页" }, { value: "half", label: "半页" }, { value: "full", label: "整页" }]} /></label>}
                {isLongAnswer(q.type) && paperMode === "integrated" && <label className="flex items-center gap-3"><span className="w-20 shrink-0 text-muted">卷内答题空间</span><Select aria-label="卷内答题空间" value={q.paperAnswerSpace ?? "follow"} onValueChange={value => onChange({ paperAnswerSpace: value === "follow" ? undefined : value as Question["paperAnswerSpace"] })} options={[{ value: "follow", label: "跟随答题卡" }, { value: "auto", label: "自动紧凑" }, { value: "quarter", label: "四分之一页" }, { value: "half", label: "半页" }, { value: "full", label: "整页" }]} /></label>}
                <div className="flex items-center justify-between"><span>题前分页</span><Switch label="题前分页" checked={Boolean(q.pageBreakBefore)} onChange={pageBreakBefore => onChange({ pageBreakBefore })} /></div>
              </div>
            </Card>

            {/* 题图 */}
            {q.image === "plot" && (
              <Card
                group="figures"
                title="题图"
                right={
                  <>
                    <IconButton label="删除图片" onClick={() => onChange({ image: undefined })}>
                      <Trash2 size={14} />
                    </IconButton>
                  </>
                }
              >
                <div className="flex items-center gap-4">
                  <div className="grid h-[104px] w-[150px] place-items-center rounded-lg bg-white">
                    <PlotSvg width={136} />
                  </div>
                </div>
              </Card>
            )}

            {/* 选项 */}
            {hasOptions(q.type) && (
              <Card
                title="选项"
                right={
                  <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange({ options: [...q.options, ""] })} disabled={q.options.length >= 6}>
                    添加选项
                  </Button>
                }
              >
                <div className="workbench-options grid grid-cols-2 gap-2.5">
                  {q.options.map((o, i) => {
                    const L = LETTERS[i];
                    const on = q.answer.includes(L);
                    return (
                      <OptionCard
                        key={i}
                        letter={L}
                        text={o}
                        correct={on}
                        onChange={(v) => onChange({ options: q.options.map((x, j) => (j === i ? v : x)) })}
                        onRemove={() => onChange({ options: q.options.filter((_, j) => j !== i), answer: q.answer.flatMap(answer => { const index = LETTERS.indexOf(answer); return index < 0 ? [answer] : index === i ? [] : [LETTERS[index > i ? index - 1 : index]]; }) })}
                        onToggle={() =>
                          onChange({
                            answer: q.type !== "multi" ? (on ? [] : [L]) : on ? q.answer.filter((a) => a !== L) : [...q.answer, L].sort(),
                          })
                        }
                      />
                    );
                  })}
                </div>
              </Card>
            )}

            {/* 答案 */}
            {!hasOptions(q.type) && (
              <Card group="answers" title={q.type === "blank" ? "答案" : "参考答案"}>
                <div className="space-y-3">{(q.answer.length ? q.answer : [""]).map((answer, index) => <div key={index}>
                  {q.answer.length > 1 && <div className="mb-1.5 text-[12px] text-muted">答案 {index + 1}</div>}
                  <TexEditor minH={q.type === "blank" ? 48 : 92} value={answer} onChange={value => { const answers = q.answer.length ? [...q.answer] : [""]; answers[index] = value; onChange({ answer: answers }); }} placeholder={index ? `输入第 ${index + 1} 项答案…` : "输入答案…"} />
                  {answer && <LivePreview text={answer} />}
                </div>)}</div>
              </Card>
            )}

            {/* 解析 */}
            {workbench && hasOptions(q.type) && <Card group="answers" title="答案">
              <div className="flex flex-wrap gap-2" role="group" aria-label="本题正确选项">
                {q.options.map((_, index) => {
                  const letter = LETTERS[index];
                  const selected = q.answer.includes(letter);
                  return <motion.button key={letter} type="button" whileTap={{ scale: .92 }} aria-label={`正确选项 ${letter}`} aria-pressed={selected} className={cx("grid h-9 w-9 place-items-center rounded-full border text-[13px] font-semibold transition-colors", selected ? "border-ok/40 bg-ok/10 text-ok" : "border-line-strong text-muted hover:text-fg")} onClick={() => onChange({ answer: q.type !== "multi" ? (selected ? [] : [letter]) : selected ? q.answer.filter(value => value !== letter) : [...q.answer, letter].sort() })}>{letter}</motion.button>;
                })}
              </div>
            </Card>}
            <Card
              group="answers"
              title="解析"
              right={
                <motion.button
                  onClick={() => setShowAnalysis((v) => !v)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/[0.06] hover:text-fg"
                  aria-label="展开或收起解析"
                >
                  <motion.span animate={{ rotate: showAnalysis ? 0 : -90 }} transition={spring}>
                    <ChevronDown size={15} />
                  </motion.span>
                </motion.button>
              }
            >
              <AnimatePresence initial={false}>
                {showAnalysis && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={softSpring} className="overflow-hidden">
                    <TexEditor minH={64} value={q.analysis} onChange={(analysis) => onChange({ analysis })} placeholder="写下解题思路…" />
                    {q.analysis && <LivePreview text={q.analysis} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
            </motion.div>

            {/* 上下题 */}
            <motion.div variants={item} className="workbench-footer grid grid-cols-2 gap-3 pt-2">
              {[neighbors.prev, neighbors.next].map((n, i) => (
                <motion.button
                  key={i}
                  disabled={!n}
                  onClick={i === 0 ? onPrev : onNext}
                  whileHover={n ? { y: -2 } : undefined}
                  whileTap={n ? { scale: 0.98 } : undefined}
                  transition={spring}
                  className={cx(
                    "rounded-xl border border-line px-4 py-3 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.025] disabled:opacity-0",
                    i === 1 && "text-right",
                  )}
                >
                  <div className="text-[11.5px] text-faint">{i === 0 ? "← 上一题" : "下一题 →"}</div>
                  {n && <div className="mt-1 truncate text-[13px] text-muted">第 {n.num} 题 · {n.stem}</div>}
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </WorkbenchContext.Provider>
  );
});
