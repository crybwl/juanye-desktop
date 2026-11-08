import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { createContext, forwardRef, memo, useCallback, useContext, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
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
  Code2,
} from "lucide-react";
import type { Question, Section, QType, Layout } from "../types";
import { CN_NUM, LETTERS, TYPE_META } from "../data";
import { MathText } from "../math";
import { Button, IconButton, cx, spring, softSpring, inputCls } from "../ui";
import { PlotSvg } from "./Paper";
import { FigureEditor } from "./FigureEditor";
import { DrawingEditor } from "./DrawingEditor";
import { MathTextField, SourcePreview, preloadVisualEditing, setEditorInputMode, useEditorInputMode, type MathTextHandle } from "./MathTextField";
import { canEditVisually } from "../math-text-doc";
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

// New selections publish immediately while the previous body finishes its
// original exit animation. An exiting body must not accept stale edits/focus.
const AnimatedEditorBody = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(function AnimatedEditorBody(props, ref) {
  const present = useIsPresent();
  return <motion.div {...props} ref={ref} {...(!present ? { inert: "" } : {})} aria-hidden={present ? undefined : true} />;
});

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
    <motion.section variants={item} data-workbench-group={group} hidden={workbench.enabled && workbench.group !== group} className={cx(workbench.enabled ? "workbench-section" : "editor-section", className)}>
      {title && <div className="workbench-section-header mb-1.5 flex min-h-7 items-center gap-3">
        <h3 className="editor-section-title text-[12px] font-medium text-faint">{title}</h3>
        <div className="workbench-section-tools ml-auto flex items-center gap-1">{right}</div>
      </div>}
      {children}
    </motion.section>
  );
}

const LivePreview = memo(function LivePreview({ text, image }: { text: string; image?: boolean }) {
  const deferredText = useDeferredValue(text);
  return (
    <div className="workbench-live-preview mt-3 rounded-[6px] px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[11.5px] text-faint">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok" />
        </span>
        预览
      </div>
      <div className="font-serif text-[15px] leading-[1.9] text-fg">
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
    <div className="score-stepper flex h-7 items-center rounded-[6px]">
      <motion.button whileTap={{ scale: 0.8 }} aria-label="减少分值" onClick={() => onChange(Math.max(1, value - 1))} className="grid h-7 w-6 place-items-center text-faint hover:text-fg">
        <Minus size={14} />
      </motion.button>
      <div className="flex min-w-[40px] items-center justify-center gap-0.5 text-[13px] font-medium">
        <input aria-label="本题分值" type="number" min={0} max={200} step={0.5} value={value} onChange={e => { const next = Number(e.target.value); if (Number.isFinite(next)) onChange(Math.max(0, Math.min(200, next))); }} className="w-8 bg-transparent text-center text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="text-[12px] font-normal text-faint">分</span>
      </div>
      <motion.button whileTap={{ scale: 0.8 }} aria-label="增加分值" onClick={() => onChange(Math.min(30, value + 1))} className="grid h-7 w-6 place-items-center text-faint hover:text-fg">
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
  layoutKey,
}: {
  letter: string;
  text: string;
  correct: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  onRemove: () => void;
  layoutKey: string;
}) {
  return (
    <motion.div
      layout
      layoutDependency={layoutKey}
      transition={spring}
      data-correct={correct || undefined}
      className="workbench-option group relative flex min-h-[40px] items-center gap-2.5 rounded-[6px] px-2 py-1 transition-colors duration-150"
    >
      <motion.button
        whileTap={{ scale: 0.86 }}
        onClick={onToggle}
        aria-label={`将 ${letter} 设为正确答案`}
        aria-pressed={correct}
        title={correct ? "正确答案（点击取消）" : "设为正确答案"}
        className="workbench-option-letter relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors duration-150"
      >
        {letter}
        <AnimatePresence>
          {correct && (
            <motion.span
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 600, damping: 22 }}
              className="workbench-option-check pointer-events-none absolute grid place-items-center rounded-full"
            >
              <Check size={9} strokeWidth={4} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <MathTextField className="workbench-option-text min-w-0 flex-1" singleLine value={text} onChange={onChange} label={`选项 ${letter}`} field={`option-${letter}`} placeholder="点击输入选项" />
      <button type="button" aria-label={`删除选项 ${letter}`} className="grid h-6 w-6 shrink-0 place-items-center rounded-[4px] text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus-visible:opacity-100" onClick={onRemove}><Trash2 size={13} /></button>
    </motion.div>
  );
}

/** 题图、绘图、原图与属性：低频内容默认折叠，有内容时自动展开对应部分。 */
function ExtrasSection({ q, children, defaultOpen = false }: { q: Question; children: ReactNode; defaultOpen?: boolean }) {
  const figures = questionFigures(q).length + (q.image === "plot" ? 1 : 0);
  const hasMedia = Boolean(figures || q.drawing?.trim() || q.sourceImage);
  const [open, setOpen] = useState(hasMedia || defaultOpen);
  const difficulty = q.difficulty ? { easy: "基础", medium: "中等", hard: "较难" }[q.difficulty] : "";
  const chips = [
    figures ? `${figures} 张题图` : "", q.drawing?.trim() ? "有绘图" : "", q.sourceImage ? "有原图" : "",
    q.knowledge?.filter(Boolean).length ? q.knowledge.filter(Boolean).slice(0, 2).join("、") : "", difficulty, q.source || "",
  ].filter(Boolean);
  return <motion.section variants={item} className="editor-extras">
    <button type="button" className="editor-extras-head flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <motion.span animate={{ rotate: open ? 0 : -90 }} transition={spring} className="text-faint"><ChevronDown size={14} /></motion.span>
      <span className="text-[12px] font-medium text-muted">题图 · 绘图 · 属性</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">{chips.length ? chips.map(chip => <span key={chip} className="editor-extras-chip">{chip}</span>) : <span className="text-[12px] text-faint">题图、TikZ 绘图、来源、知识点、难度</span>}</span>
    </button>
    <AnimatePresence initial={false}>
      {open && <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={softSpring} className="overflow-hidden">
        <div className="editor-extras-body flex flex-col gap-5 px-2 pb-2 pt-2">{children}</div>
      </motion.div>}
    </AnimatePresence>
  </motion.section>;
}

/* ---------- 空状态 ---------- */
const Empty = forwardRef<HTMLDivElement, { onStart: () => void; onOcr: () => void }>(function Empty({ onStart, onOcr }, ref) {
  return (
    <motion.div
      ref={ref}
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
            className="editor-empty-sheet absolute left-1/2 top-0 h-[140px] w-[108px] -ml-[54px] rounded-[6px] p-3"
            initial={{ rotate: c.r, x: c.x, y: c.y + 20, opacity: 0 }}
            animate={{ rotate: c.r, x: c.x, y: [c.y, c.y - 6, c.y], opacity: 1 }}
            transition={{ y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: c.d }, opacity: { delay: c.d * 0.3 } }}
          >
            <div className="editor-empty-line mb-2 h-1.5 w-12 rounded" />
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="editor-empty-line mb-1.5 h-1 rounded opacity-60" style={{ width: `${60 + ((j * 37) % 40)}%` }} />
            ))}
            {i === 2 && (
              <div className="mt-3 grid h-8 place-items-center rounded-[4px] font-serif text-[13px] text-muted">
                <MathText text="$\int_0^1 x\,dx$" />
              </div>
            )}
          </motion.div>
        ))}
      </div>
      <h2 className="text-[16px] font-semibold">选择一道题，开始校对</h2>
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
});

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
  extrasOpen,
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
  /** 题图 · 绘图 · 属性默认展开（题库编辑需要直接看到来源、知识点、难度）。 */
  extrasOpen?: boolean;
}) {
  const stemRef = useRef<MathTextHandle>(null);
  const inputMode = useEditorInputMode();
  useEffect(() => { preloadVisualEditing(); }, []);
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
      const field = (name: string) => `[data-exam-field="${name}"][role="textbox"], [data-exam-field="${name}"] textarea`;
      const selectors = focusTarget === "question" ? field("stem")
        : focusTarget === "analysis" ? field("analysis")
        : `[aria-label^="正确选项 "], [aria-label^="将 "][aria-label$=" 设为正确答案"], ${field("answer-0")}`;
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
    <div ref={editorRoot} className={cx("relative h-full overflow-y-auto overflow-x-hidden", workbench && "experimental-workbench")} data-editor-workbench={workbench ? "experimental" : "classic"}>
      <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        {!q || !sec ? (
          <Empty key="empty" onStart={onStart} onOcr={onOcr} />
        ) : (
          <AnimatedEditorBody
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
            className="workbench-body mx-auto flex max-w-[760px] flex-col gap-5 px-8 pb-16 pt-5"
          >
            {/* 头部 */}
            <motion.div variants={item}>
              <div className="editor-locator flex items-center gap-1.5 text-[12px] text-faint">
                <span>{CN_NUM[secIndex]}、{sec.title}</span>
                <ChevronRight size={12} className="opacity-60" />
                <span className="tabular-nums">{num} / {total}</span>
              </div>
              <div className="workbench-heading-row editor-heading mt-1 flex flex-wrap items-center gap-2">
                <h1 className="workbench-heading text-[20px] font-semibold">第 {num} 题</h1>
                <Select aria-label="题型" className="editor-meta-select max-w-[132px]" value={q.type} onValueChange={type => onChange(changeQuestionType(q, type as QType))} options={Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))} />
                <ScoreStepper value={q.score} onChange={(score) => onChange({ score })} />
                <div className="ml-auto flex items-center gap-0.5">
                  <IconButton label={inputMode === "source" ? "改回可视编辑" : "LaTeX 源码编辑"} active={inputMode === "source"} onClick={() => setEditorInputMode(inputMode === "source" ? "visual" : "source")}><Code2 size={16} /></IconButton>
                  <IconButton label="复制题目" onClick={onDuplicate} disabled={!onDuplicate}><Copy size={16} /></IconButton>
                  <IconButton label="删除题目" onClick={onDelete} className="hover:!text-danger">
                    <Trash2 size={16} />
                  </IconButton>
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
                  <div className="editor-flag flex items-center gap-3 rounded-[8px] px-3 py-2.5">
                    <AlertTriangle size={15} className="shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-fg">{q.flag}</div>
                      {!/待核对|B卷|AI/.test(q.flag) && <div className="text-[12px] text-muted">建议转为解答题，并从题干中提取分值。</div>}
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
                  <IconButton label="行内公式（或输入 $）" onMouseDown={event => event.preventDefault()} onClick={() => stemRef.current?.insertMath("", "$x$", 1)}>
                    <Sigma size={15} />
                  </IconButton>
                  <IconButton label="分式" onMouseDown={event => event.preventDefault()} onClick={() => stemRef.current?.insertMath("\\frac{#0}{#?}", "$\\frac{}{}$", 4)}>
                    <Divide size={15} />
                  </IconButton>
                  <IconButton label="根号" onMouseDown={event => event.preventDefault()} onClick={() => stemRef.current?.insertMath("\\sqrt{#0}", "$\\sqrt{}$", 2)}>
                    <SquareRadical size={15} />
                  </IconButton>
                  <IconButton label="填空横线" onMouseDown={event => event.preventDefault()} onClick={() => stemRef.current?.insertText("______")}>
                    <Underline size={15} />
                  </IconButton>
                  <IconButton label="插入表格（源码）" onMouseDown={event => event.preventDefault()} onClick={() => stemRef.current?.insertSource("\n\n| 项目 | 数值 | 合计 |\n| --- | --- | --- |\n| 内容 | $1$ | $1$ |\n| 内容 | $2$ | $2$ |\n\n")}>
                    <Table2 size={15} />
                  </IconButton>
                  <span className="mx-1 h-4 w-px bg-line" />
                  <IconButton label="打开图片识别" onClick={onOcr}>
                    <Sparkles size={15} />
                  </IconButton>
                </>
              }
            >
              <MathTextField ref={stemRef} field="stem" label="题干" value={q.stem} onChange={stem => onChange({ stem })} onCommit={commitStem} placeholder="输入题干…" visualPlaceholder="输入题干…（输入 $ 插入公式）" />
              {(inputMode === "source" || !canEditVisually(q.stem)) ? <LivePreview text={q.stem} image={q.image === "plot"} /> : q.image === "plot" && <div className="mt-3 flex justify-center"><PlotSvg ink="#c9cddb" accent="var(--color-accent)" width={250} /></div>}
            </Card>

            {/* 选项 */}
            {hasOptions(q.type) && (
              <Card
                title="选项"
                className="editor-tools-visible"
                right={
                  <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange({ options: [...q.options, ""] })} disabled={q.options.length >= 6}>
                    添加选项
                  </Button>
                }
              >
                <div className="workbench-options -mx-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {q.options.map((o, i) => {
                    const L = LETTERS[i];
                    const on = q.answer.includes(L);
                    return (
                      <OptionCard
                        key={i}
                        letter={L}
                        layoutKey={`${q.id}:${q.options.length}`}
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
                  <MathTextField field={`answer-${index}`} label={index ? `第 ${index + 1} 项答案` : "答案"} minH={q.type === "blank" ? 48 : 92} value={answer} onChange={value => { const answers = q.answer.length ? [...q.answer] : [""]; answers[index] = value; onChange({ answer: answers }); }} placeholder={index ? `输入第 ${index + 1} 项答案…` : "输入答案…"} />
                  {answer && (inputMode === "source" || !canEditVisually(answer)) && <SourcePreview text={answer} />}
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
                  className="grid h-7 w-7 place-items-center rounded-[6px] text-faint hover:bg-[var(--surface-hover)] hover:text-fg"
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
                    <MathTextField field="analysis" label="解析" minH={64} value={q.analysis} onChange={analysis => onChange({ analysis })} placeholder="写下解题思路…" />
                    {q.analysis && (inputMode === "source" || !canEditVisually(q.analysis)) && <SourcePreview text={q.analysis} />}
            </motion.div>
                )}
              </AnimatePresence>
            </Card>
            {workbench ? <>
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

            </> : <ExtrasSection q={q} defaultOpen={extrasOpen}>
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

            </ExtrasSection>}
            </motion.div>

            {/* 上下题 */}
            <motion.div variants={item} className="workbench-footer grid grid-cols-2 gap-3 border-t border-line pt-3">
              {[neighbors.prev, neighbors.next].map((n, i) => (
                <motion.button
                  key={i}
                  disabled={!n}
                  onClick={i === 0 ? onPrev : onNext}
                  whileTap={n ? { scale: 0.98 } : undefined}
                  transition={spring}
                  className={cx(
                    "min-w-0 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-0",
                    i === 1 && "text-right",
                  )}
                >
                  <div className="text-[12px] text-faint">{i === 0 ? "← 上一题" : "下一题 →"}</div>
                  {n && <div className="mt-0.5 truncate text-[13px] text-muted">第 {n.num} 题 · {n.stem}</div>}
                </motion.button>
              ))}
            </motion.div>
          </AnimatedEditorBody>
        )}
      </AnimatePresence>
    </div>
    </WorkbenchContext.Provider>
  );
});
