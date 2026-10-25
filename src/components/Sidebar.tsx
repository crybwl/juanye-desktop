import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { AlertTriangle, ChevronDown, GripVertical, Image as ImageIcon, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, ScanText, FolderTree, Undo2, Redo2 } from "lucide-react";
import type { Exam, QType, Question } from "../types";
import { TYPE_META } from "../data";
import { MathText } from "../math";
import { AnimatedNumber, Button, SharedPill, IconButton, cx, spring, softSpring } from "../ui";
import { QuestionTypeIcon } from "./QuestionTypeIcon";
import { CheckboxIndicator } from "./Checkbox";

const ExamCard = memo(function ExamCard({ exam, score, count, flags, onJump }: { exam: Exam; score: number; count: number; flags: number; onJump: () => void }) {
  return (
    <div className="sidebar-summary relative overflow-hidden rounded-2xl border border-white/[0.08] p-4">
      {/* 缓慢流动的品牌色光斑 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.16] via-accent-2/[0.08] to-transparent" />
      <motion.div
        className="pointer-events-none absolute -left-10 -top-14 h-40 w-40 rounded-full bg-accent/30 blur-3xl"
        animate={{ x: [0, 60, 10, 0], y: [0, 20, 40, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-accent-2/25 blur-3xl"
        animate={{ x: [0, -50, -10, 0], y: [0, -30, 10, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative">
        <div className="text-[15px] font-semibold leading-snug tracking-tight">{exam.title}</div>
        <div className="mt-1 text-[12px] text-muted">
          {exam.subtitle} · {exam.duration} 分钟
        </div>
        <div className="mt-4 grid grid-cols-3 rounded-xl bg-black/25 py-2.5 ring-1 ring-inset ring-white/[0.06]">
          {(
            [
              [exam.sections.length, "大题"],
              [count, "小题"],
              [score, "总分"],
            ] as const
          ).map(([v, l], i) => (
            <div key={l} className={cx("text-center", i > 0 && "border-l border-white/[0.07]")}>
              <AnimatedNumber value={v} className="text-[18px] font-semibold" />
              <div className="text-[11px] text-muted">{l}</div>
            </div>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {flags > 0 && (
            <motion.button
              key="warn"
              onClick={onJump}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-3 flex w-full items-center gap-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn transition-colors hover:bg-warn/15"
            >
              <AlertTriangle size={13} />
              {flags} 处需要校对
              <span className="ml-auto text-warn/70">定位 →</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

const Row = memo(function Row({
  q,
  num,
  active,
  batch,
  checked,
  sectionId,
  onActivate,
}: {
  q: Question;
  num: number;
  active: boolean;
  batch: boolean;
  checked: boolean;
  sectionId: string;
  onActivate: (sectionId: string, id: string) => void;
}) {
  const controls = useDragControls();
  const onClick = () => onActivate(sectionId, q.id);
  return (
    <Reorder.Item
      value={q}
      as="div"
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      whileDrag={{ scale: 1.025, zIndex: 30 }}
      transition={spring}
      className="group relative"
      data-question-id={q.id}
    >
      <div
        onClick={onClick}
        role={batch ? "checkbox" : "button"}
        tabIndex={0}
        aria-label={batch ? `第 ${num} 题，${checked ? "已选择" : "未选择"}` : `编辑第 ${num} 题`}
        aria-pressed={batch ? undefined : active}
        aria-checked={batch ? checked : undefined}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onClick(); }
        }}
        className={cx(
          "relative flex cursor-pointer items-start gap-2.5 rounded-[10px] py-2 pl-2 pr-7 transition-colors",
          !active && "hover:bg-white/[0.035]",
        )}
      >
        {active && (
          <SharedPill layoutId="outline-active" transition={spring} className="absolute inset-0 rounded-[10px] bg-accent/[0.1] ring-1 ring-inset ring-accent/20">
            <span className="absolute bottom-2.5 left-0 top-2.5 w-[2.5px] rounded-full bg-accent" />
          </SharedPill>
        )}
        <AnimatePresence initial={false}>
          {batch && (
            <motion.span
              initial={{ width: 0, opacity: 0, marginRight: -10 }}
              animate={{ width: 18, opacity: 1, marginRight: 0 }}
              exit={{ width: 0, opacity: 0, marginRight: -10 }}
              transition={spring}
              className="relative mt-[2px] shrink-0 overflow-hidden"
            >
              <CheckboxIndicator checked={checked} />
            </motion.span>
          )}
        </AnimatePresence>
        <span
          className={cx(
            "relative mt-[1px] grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors duration-300",
            active ? "bg-accent text-[#0b0d18]" : "bg-white/[0.06] text-muted",
          )}
        >
          {num}
        </span>
        <div className="relative min-w-0 flex-1">
          <MathText text={q.stem || "（空题干）"} className={cx("line-clamp-2 text-[12.5px] leading-[1.6]", active ? "text-fg" : "text-fg/80")} />
          <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
            <span>{q.score} 分</span>
            {q.image && <ImageIcon size={11} />}
            {q.flag && (
              <span className="flex items-center gap-1 text-warn">
                <AlertTriangle size={11} />
                待校对
              </span>
            )}
          </div>
        </div>
      </div>
        <button
          type="button"
          aria-label={`拖动第 ${num} 题`}
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-1.5 top-2.5 cursor-grab touch-none rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-fg focus:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          title="拖动排序"
        >
          <GripVertical size={14} />
        </button>
    </Reorder.Item>
  );
});

// Isolate unchanged projection/presence subtrees from unrelated parent updates.
const QuestionRows = memo(function QuestionRows({ questions, sectionId, start, activeId, batch, selected, onActivate, onReorder }: {
  questions: Question[]; sectionId: string; start: number; activeId: string | null; batch: boolean;
  selected: Set<string>; onActivate: (sectionId: string, id: string) => void;
  onReorder: (questions: Question[]) => void;
}) {
  return <Reorder.Group axis="y" as="div" values={questions} onReorder={onReorder} className="pb-1 pl-1">
    <AnimatePresence initial={false}>
      {questions.map((q, qi) => <Row key={q.id} q={q} num={start + qi + 1} active={!batch && q.id === activeId}
        batch={batch} checked={selected.has(q.id)} sectionId={sectionId} onActivate={onActivate} />)}
    </AnimatePresence>
    {questions.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">暂无题目</div>}
  </Reorder.Group>;
});

export function Sidebar({
  exam,
  activeId,
  onSelect,
  onReorder,
  batch,
  setBatch,
  selected,
  toggleSelect,
  score,
  count,
  onAdd,
  onOcr,
  onJumpFlag,
  expanded,
  onExpandedChange,
  requestedSectionId,
  onManageSections, onSelectSection, onUndo, onRedo, canUndo, canRedo,
}: {
  exam: Exam;
  activeId: string | null;
  onSelect: (id: string) => void;
  onReorder: (secId: string, qs: Question[]) => void;
  batch: boolean;
  setBatch: (v: boolean) => void;
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  score: number;
  count: number;
  onAdd: (sectionId?: string) => void;
  onOcr: () => void;
  onJumpFlag: () => void;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
  requestedSectionId?: string;
  onManageSections: () => void;
  onSelectSection: (sectionId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [focusedSectionId, setFocusedSectionId] = useState<string>();
  const [pendingSectionId, setPendingSectionId] = useState<string>();
  const sectionElements = useRef(new Map<string, HTMLDivElement>());
  const requestExpansion = useRef(onExpandedChange);
  requestExpansion.current = onExpandedChange;
  const actions = useRef({ onSelect, toggleSelect, onReorder, batch });
  actions.current = { onSelect, toggleSelect, onReorder, batch };
  const activate = useCallback((sectionId: string, id: string) => {
    setFocusedSectionId(sectionId);
    const current = actions.current;
    if (current.batch) current.toggleSelect(id); else current.onSelect(id);
  }, []);
  const reorderHandlers = useRef(new Map<string, (questions: Question[]) => void>());
  const reorderFor = (sectionId: string) => {
    let handler = reorderHandlers.current.get(sectionId);
    if (!handler) {
      handler = questions => actions.current.onReorder(sectionId, questions);
      reorderHandlers.current.set(sectionId, handler);
    }
    return handler;
  };
  useEffect(() => {
    const ids = new Set(exam.sections.map(section => section.id));
    for (const id of reorderHandlers.current.keys()) if (!ids.has(id)) reorderHandlers.current.delete(id);
  }, [exam.sections]);
  const requestedSectionExists = exam.sections.some((section) => section.id === requestedSectionId);
  useEffect(() => {
    if (!requestedSectionId || !requestedSectionExists) return;
    setClosed((previous) => { const next = new Set(previous); next.delete(requestedSectionId); return next; });
    setFocusedSectionId(requestedSectionId); setPendingSectionId(requestedSectionId);
    requestExpansion.current(true);
  }, [requestedSectionId, requestedSectionExists]);
  useEffect(() => {
    if (!expanded || !pendingSectionId) return;
    const frame = requestAnimationFrame(() => {
      sectionElements.current.get(pendingSectionId)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      setPendingSectionId(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, pendingSectionId]);
  const activeSectionId = exam.sections.find((section) => section.questions.some((question) => question.id === activeId))?.id;
  useEffect(() => {
    if (activeSectionId) setFocusedSectionId(activeSectionId);
  }, [activeId, activeSectionId]);
  const contextSectionId = exam.sections.some((section) => section.id === focusedSectionId) ? focusedSectionId : activeSectionId;
  const toggleSection = (sectionId: string) => {
    setFocusedSectionId(sectionId);
    setClosed((previous) => {
      const next = new Set(previous);
      if (!expanded || next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
      return next;
    });
    setPendingSectionId(sectionId);
    if (!expanded) onExpandedChange(true);
  };
  const clickBackground = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onExpandedChange(!expanded);
  };
  const types: QType[] = (["single", "multi", "blank", "essay"] as QType[]).concat((["judge", "material", "custom"] as QType[]).filter(type => exam.sections.some(section => section.type === type)));
  const railSections = types.flatMap((type) => {
    const sections = exam.sections.filter((section) => section.type === type);
    return sections.length ? sections.map((section) => ({ id: section.id as string | undefined, type, title: section.title, count: sections.length })) : [{ id: undefined, type, title: TYPE_META[type].label, count: 0 }];
  });
  const flags = exam.sections.reduce((a, s) => a + s.questions.filter((q) => q.flag).length, 0);
  let n = 0;
  return (
    <aside aria-label="试卷目录" data-sidebar-state={expanded ? "expanded" : "collapsed"} className="question-sidebar flex h-full w-full overflow-hidden" onClick={clickBackground}>
      <div className="sidebar-rail flex h-full w-[76px] shrink-0 flex-col items-center gap-4 border-r border-line px-3 pt-3" onClick={clickBackground}>
        <button type="button" aria-label={expanded ? "收起试卷目录" : "展开目录面板"} aria-expanded={expanded} title={expanded ? "收起试卷目录" : "展开试卷目录"} onClick={() => onExpandedChange(!expanded)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted outline-none transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50">
          {expanded ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
        </button>
        <div className="flex min-h-0 w-full shrink flex-col items-center gap-3 overflow-y-auto py-1" onClick={clickBackground}>
          {railSections.map((section, index) => {
            const meta = TYPE_META[section.type];
            const sectionOpen = expanded && Boolean(section.id) && !closed.has(section.id!);
            const label = `${sectionOpen ? "收起" : "展开"}${meta.label}${section.count > 1 ? ` · ${section.title}` : ""}`;
            return <button key={section.id || section.type} type="button" aria-label={label} title={section.count > 1 ? `${label}（第 ${index + 1} 大题）` : label} aria-expanded={sectionOpen} aria-pressed={Boolean(section.id && contextSectionId === section.id)} aria-controls={section.id ? `sidebar-section-${section.id}` : undefined} data-question-type={section.type} data-section-target={section.id} onClick={() => { if (section.id) toggleSection(section.id); else onExpandedChange(true); }} className={cx("question-type-button relative grid h-11 w-11 shrink-0 place-items-center rounded-full border outline-none transition-[background,border-color,box-shadow] hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent/60", contextSectionId === section.id && section.id ? "border-accent/50 bg-accent/10 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_7%,transparent)]" : "border-line-strong bg-white/[0.025]")} style={{ color: meta.hue }}><QuestionTypeIcon type={section.type} /></button>;
          })}
        </div>
        <button type="button" aria-label={expanded ? "收起目录空白区域" : "展开试卷目录"} title={expanded ? "点击空白处收起目录" : "点击空白处展开目录"} onClick={() => onExpandedChange(!expanded)} className="mb-2 min-h-6 w-full flex-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40" />
      </div>
      {expanded && <div className="sidebar-drawer flex h-full shrink-0 flex-col" style={{ width: "calc(var(--sidebar-expanded-width, 364px) - 76px)" }}>
      <div className="px-3 pt-3">
        <ExamCard exam={exam} score={score} count={count} flags={flags} onJump={onJumpFlag} />
      </div>
      <div className="flex items-center justify-between gap-1 px-3 pb-1.5 pt-4">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint">试卷结构</span>
        <div className="flex items-center">
          <IconButton label="撤销" onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /></IconButton>
          <IconButton label="重做" onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /></IconButton>
          <IconButton label="管理大题" onClick={onManageSections}><FolderTree size={15} /></IconButton>
          <IconButton label={batch ? "退出批量编辑" : "批量编辑"} active={batch} onClick={() => setBatch(!batch)}>
            <ListChecks size={15} />
          </IconButton>
        </div>
      </div>
      <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" onClick={clickBackground}>
        {exam.sections.map((s) => {
          const open = !closed.has(s.id);
          const meta = TYPE_META[s.type];
          const sum = s.questions.reduce((a, q) => a + q.score, 0);
          const start = n;
          n += s.questions.length;
          return (
            <div key={s.id} id={`sidebar-section-${s.id}`} data-section-id={s.id} ref={(element) => { if (element) sectionElements.current.set(s.id, element); else sectionElements.current.delete(s.id); }} className="mb-1">
              <button
                onClick={() => toggleSection(s.id)}
                aria-label={`${open ? "收起" : "展开"}${s.title}题目列表`}
                aria-expanded={open}
                aria-controls={`sidebar-questions-${s.id}`}
                className="sidebar-section-heading group flex w-full items-center gap-2 rounded-[10px] px-2 py-2 outline-none transition-colors hover:bg-white/[0.035] focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                  style={{ background: `color-mix(in srgb, ${meta.hue} 15%, transparent)`, color: meta.hue }}
                >
                  <QuestionTypeIcon type={s.type} width={19} height={19} />
                </span>
                <span className="min-w-0 flex-1 text-left text-[12.5px] font-medium">{s.title}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-faint">
                  {s.questions.length} 题 · {sum} 分
                </span>
                <motion.span animate={{ rotate: open ? 0 : -90 }} transition={spring} className="text-faint group-hover:text-muted">
                  <ChevronDown size={14} />
                </motion.span>
              </button>
              {batch && s.questions.length > 0 && <button role="checkbox" aria-checked={s.questions.every(q => selected.has(q.id)) ? true : s.questions.some(q => selected.has(q.id)) ? "mixed" : false} className="mb-1 ml-3 flex items-center gap-2 rounded text-[11px] text-accent" onClick={() => onSelectSection(s.id)}><CheckboxIndicator checked={s.questions.every(q => selected.has(q.id)) ? true : s.questions.some(q => selected.has(q.id)) ? "mixed" : false} />{s.questions.every(q => selected.has(q.id)) ? "取消选择本大题" : "选择本大题"}</button>}
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={softSpring}
                    className="overflow-hidden"
                    id={`sidebar-questions-${s.id}`}
                  >
                    <QuestionRows questions={s.questions} sectionId={s.id} start={start} activeId={activeId} batch={batch}
                      selected={selected} onActivate={activate} onReorder={reorderFor(s.id)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </motion.div>
      <div className="sidebar-actions grid grid-cols-2 gap-2 border-t border-line p-3">
        <Button variant="secondary" className="min-w-0 px-2 text-[12px]" icon={<Plus size={14} />} onClick={() => onAdd(contextSectionId)}>
          新建题目
        </Button>
        <Button variant="outline" className="min-w-0 px-2 text-[12px]" icon={<ScanText size={14} />} onClick={onOcr}>
          图片 OCR
        </Button>
      </div>
      </div>}
    </aside>
  );
}
