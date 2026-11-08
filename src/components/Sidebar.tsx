import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { AlertTriangle, ChevronDown, GripVertical, Image as ImageIcon, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, ScanText, FolderTree, Undo2, Redo2 } from "lucide-react";
import type { Exam, QType, Question } from "../types";
import { CN_NUM, TYPE_META } from "../data";
import { MathText } from "../math";
import { AnimatedNumber, Button, SharedPill, IconButton, cx, spring, softSpring } from "../ui";
import { QuestionTypeIcon } from "./QuestionTypeIcon";
import { CheckboxIndicator } from "./Checkbox";
import { SidebarRowStore } from "../sidebar-row-store";

/** 目录顶部的试卷摘要：标题 + 一行统计；校对提醒只在需要时出现。 */
const ExamSummary = memo(function ExamSummary({ exam, score, count, flags, onJump, onCollapse }: { exam: Exam; score: number; count: number; flags: number; onJump: () => void; onCollapse: () => void }) {
  return (
    <div className="sidebar-summary px-4 pb-3 pt-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={exam.title}>{exam.title}</div>
        <IconButton label="收起试卷目录" aria-expanded onClick={onCollapse} className="-mr-1.5 h-7 w-7"><PanelLeftClose size={16} /></IconButton>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
        <span><AnimatedNumber value={exam.sections.length} /> 大题</span><span aria-hidden="true">·</span>
        <span><AnimatedNumber value={count} /> 小题</span><span aria-hidden="true">·</span>
        <span><AnimatedNumber value={score} /> 分</span>
        <AnimatePresence initial={false}>
          {flags > 0 && (
            <motion.button key="warn" type="button" onClick={onJump} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }}
              className="sidebar-flag-link ml-auto inline-flex items-center gap-1 rounded-[4px] text-warn outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50" title="定位到第一处待校对题目">
              <AlertTriangle size={12} />{flags} 处待校对
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

const Row = memo(function Row({
  id,
  store,
  sectionId,
  onActivate,
}: {
  id: string;
  store: SidebarRowStore;
  sectionId: string;
  onActivate: (sectionId: string, id: string) => void;
}) {
  // 外层可拖动行只订阅“是否当前题”：打字只重渲染 RowBody，避免 Motion 对整列可拖动行重新测量布局。
  const controls = useDragControls();
  const subscribeActive = useCallback((notify: () => void) => store.subscribe(id, notify), [store, id]);
  const activeSnapshot = useCallback(() => store.get(id).active, [store, id]);
  const active = useSyncExternalStore(subscribeActive, activeSnapshot, activeSnapshot);
  return (
    <Reorder.Item
      value={id}
      as="div"
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      whileDrag={{ scale: 1.025, zIndex: 30 }}
      transition={spring}
      className="sidebar-row group relative"
      data-active={active || undefined}
      data-question-id={id}
    >
      {active && (
        <SharedPill layoutId="outline-active" transition={spring} className="sidebar-row-pill pointer-events-none absolute inset-0 rounded-[6px]" />
      )}
      <RowBody id={id} store={store} sectionId={sectionId} onActivate={onActivate} controls={controls} />
    </Reorder.Item>
  );
});

const RowBody = memo(function RowBody({ id, store, sectionId, onActivate, controls }: {
  id: string;
  store: SidebarRowStore;
  sectionId: string;
  onActivate: (sectionId: string, id: string) => void;
  controls: ReturnType<typeof useDragControls>;
}) {
  const subscribe = useCallback((notify: () => void) => store.subscribe(id, notify), [store, id]);
  const snapshot = useCallback(() => store.get(id), [store, id]);
  const { q, num, active, batch, checked } = useSyncExternalStore(subscribe, snapshot, snapshot);
  // 题干摘要延后跟随输入：连续打字时目录不逐键重排、重绘，停顿后再更新。
  const stem = useDeferredValue(q.stem);
  const onClick = () => onActivate(sectionId, q.id);
  return (
    <>
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
          "sidebar-row-body relative flex cursor-pointer items-start gap-2 rounded-[6px] py-1.5 pl-2 pr-9 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50",
          !active && "hover:bg-[var(--surface-hover)]",
        )}
      >
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
        <span className={cx("sidebar-row-num relative w-5 shrink-0 text-right text-[12px] leading-[1.65] tabular-nums transition-colors duration-200", active ? "font-semibold text-accent" : "text-faint")}>
          {num}
        </span>
        <div className="relative min-w-0 flex-1">
          <MathText text={stem || "（空题干）"} className={cx("line-clamp-2 text-[13px] leading-[1.65]", active ? "text-fg" : "text-muted")} />
          {(q.image || q.flag) && <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
            {q.image && <ImageIcon size={11} aria-label="含题图" />}
            {q.flag && (
              <span className="flex items-center gap-1 text-warn">
                <AlertTriangle size={11} />
                待校对
              </span>
            )}
          </div>}
        </div>
        <span className="sidebar-row-score absolute right-2.5 top-[7px] text-[11px] tabular-nums text-faint">{q.score}分</span>
      </div>
        <button
          type="button"
          aria-label={`拖动第 ${num} 题`}
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          onClick={(e) => e.stopPropagation()}
          className="sidebar-row-grip absolute right-1.5 top-1.5 cursor-grab touch-none rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-fg focus:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          title="拖动排序"
        >
          <GripVertical size={14} />
        </button>
    </>
  );
});

// Isolate unchanged projection/presence subtrees from unrelated parent updates.
const QuestionRows = memo(function QuestionRows({ questions, sectionId, start, activeId, batch, selected, onActivate, onReorder }: {
  questions: Question[]; sectionId: string; start: number; activeId: string | null; batch: boolean;
  selected: Set<string>; onActivate: (sectionId: string, id: string) => void;
  onReorder: (questions: Question[]) => void;
}) {
  const rows = questions.map((q, index) => ({ q, num: start + index + 1, active: !batch && q.id === activeId, batch, checked: selected.has(q.id) }));
  const [store] = useState(() => new SidebarRowStore(rows));
  store.seed(rows);
  useLayoutEffect(() => store.update(rows), [store, questions, start, activeId, batch, selected]);
  const latest = useRef({ questions, onReorder }); latest.current = { questions, onReorder };
  const signature = JSON.stringify(questions.map(q => q.id));
  const ids = useMemo<string[]>(() => JSON.parse(signature), [signature]);
  const reorder = useCallback((ids: string[]) => { const current = latest.current, byId = new Map(current.questions.map(q => [q.id, q])); if (ids.length === byId.size && new Set(ids).size === byId.size && ids.every(id => byId.has(id))) current.onReorder(ids.map(id => byId.get(id)!)); }, []);
  return <SortableQuestionRows ids={ids} store={store} sectionId={sectionId} onActivate={onActivate} onReorder={reorder} />;
});

const SortableQuestionRows = memo(function SortableQuestionRows({ ids, store, sectionId, onActivate, onReorder }: {
  ids: string[]; store: SidebarRowStore; sectionId: string;
  onActivate: (sectionId: string, id: string) => void; onReorder: (ids: string[]) => void;
}) {
  // presenceAffectsLayout=false：避免外层重渲染经 PresenceContext 级联到每一行（每行都是可拖动布局节点）。
  return <Reorder.Group axis="y" as="div" values={ids} onReorder={onReorder} className="pb-1 pl-1">
    <AnimatePresence initial={false} presenceAffectsLayout={false}>
      {ids.map(id => <Row key={id} id={id} store={store} sectionId={sectionId} onActivate={onActivate} />)}
    </AnimatePresence>
    {ids.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">暂无题目</div>}
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
      {!expanded && <div className="sidebar-rail flex h-full w-[76px] shrink-0 flex-col items-center gap-3 px-3 pt-3" onClick={clickBackground}>
        <button type="button" aria-label={expanded ? "收起试卷目录" : "展开目录面板"} aria-expanded={expanded} title={expanded ? "收起试卷目录" : "展开试卷目录"} onClick={() => onExpandedChange(!expanded)} className="grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-muted outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50">
          {expanded ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
        </button>
        <div className="flex min-h-0 w-full shrink flex-col items-center gap-3 overflow-y-auto py-1" onClick={clickBackground}>
          {railSections.map((section, index) => {
            const meta = TYPE_META[section.type];
            const sectionOpen = expanded && Boolean(section.id) && !closed.has(section.id!);
            const label = `${sectionOpen ? "收起" : "展开"}${meta.label}${section.count > 1 ? ` · ${section.title}` : ""}`;
            return <button key={section.id || section.type} type="button" aria-label={label} title={section.count > 1 ? `${label}（第 ${index + 1} 大题）` : label} aria-expanded={sectionOpen} aria-pressed={Boolean(section.id && contextSectionId === section.id)} aria-controls={section.id ? `sidebar-section-${section.id}` : undefined} data-question-type={section.type} data-section-target={section.id} onClick={() => { if (section.id) toggleSection(section.id); else onExpandedChange(true); }} className="question-type-button relative grid h-10 w-10 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60" data-active={contextSectionId === section.id && section.id ? "true" : undefined}><QuestionTypeIcon type={section.type} /></button>;
          })}
        </div>
        <button type="button" aria-label="展开试卷目录" title="点击空白处展开目录" onClick={() => onExpandedChange(true)} className="mb-2 min-h-6 w-full flex-1 rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40" />
      </div>}
      {expanded && <div className="sidebar-drawer flex h-full shrink-0 flex-col" style={{ width: "var(--sidebar-expanded-width, 304px)" }}>
      <ExamSummary exam={exam} score={score} count={count} flags={flags} onJump={onJumpFlag} onCollapse={() => onExpandedChange(false)} />
      <div className="sidebar-toolbar flex items-center justify-between gap-1 px-4 pb-1 pt-2">
        <span className="text-[12px] font-medium text-faint">目录</span>
        <div className="flex items-center">
          <IconButton label="撤销" className="h-7 w-7" onClick={onUndo} disabled={!canUndo}><Undo2 size={14} /></IconButton>
          <IconButton label="重做" className="h-7 w-7" onClick={onRedo} disabled={!canRedo}><Redo2 size={14} /></IconButton>
          <IconButton label="管理大题" className="h-7 w-7" onClick={onManageSections}><FolderTree size={14} /></IconButton>
          <IconButton label={batch ? "退出批量编辑" : "批量编辑"} className="h-7 w-7" active={batch} onClick={() => setBatch(!batch)}>
            <ListChecks size={14} />
          </IconButton>
        </div>
      </div>
      {/* 滚动容器自身不做布局动画：固定 layoutDependency，打字时不触发整树测量 */}
      <motion.div layoutScroll layoutDependency={0} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" onClick={clickBackground}>
        {exam.sections.map((s, sectionIndex) => {
          const open = !closed.has(s.id);
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
                className="sidebar-section-heading group flex w-full items-center gap-1.5 rounded-[6px] px-2 pb-1 pt-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <motion.span animate={{ rotate: open ? 0 : -90 }} transition={spring} className="-ml-0.5 text-faint opacity-60 transition-opacity group-hover:opacity-100">
                  <ChevronDown size={13} />
                </motion.span>
                <span className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-fg">{CN_NUM[sectionIndex] ?? sectionIndex + 1}、{s.title}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-faint">
                  {s.questions.length} 题 · {sum} 分
                </span>
              </button>
              {batch && s.questions.length > 0 && <button role="checkbox" aria-checked={s.questions.every(q => selected.has(q.id)) ? true : s.questions.some(q => selected.has(q.id)) ? "mixed" : false} className="mb-1 ml-2.5 flex items-center gap-2 rounded text-[12px] text-muted hover:text-fg" onClick={() => onSelectSection(s.id)}><CheckboxIndicator checked={s.questions.every(q => selected.has(q.id)) ? true : s.questions.some(q => selected.has(q.id)) ? "mixed" : false} />{s.questions.every(q => selected.has(q.id)) ? "取消选择本大题" : "选择本大题"}</button>}
              <AnimatePresence initial={false} presenceAffectsLayout={false}>
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
      <div className="sidebar-actions grid grid-cols-2 gap-1 border-t border-line px-2 py-2">
        <Button variant="ghost" className="min-w-0 justify-start px-2 text-[13px]" icon={<Plus size={15} />} onClick={() => onAdd(contextSectionId)}>
          新建题目
        </Button>
        <Button variant="ghost" className="min-w-0 justify-start px-2 text-[13px]" icon={<ScanText size={15} />} onClick={onOcr}>
          图片 OCR
        </Button>
      </div>
      </div>}
    </aside>
  );
}
