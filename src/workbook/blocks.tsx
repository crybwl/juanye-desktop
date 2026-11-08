import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { ImagePlus } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { hasBlankNode, type BlockApi } from "./api";
import { formulaHtml } from "./formula";
import { loadMathfield } from "./extensions";
import { EXAMPLE_LABEL, type Block, type Edition, type FigureBlock, type FormulaBlock, type HeadingBlock, type NoteBlock, type QuestionBlock, type TextBlock } from "./model";
import { mmToPx } from "./pagination";
import { RichField, type CaretIntent } from "./RichField";
import { RichView } from "./RichView";
import { isRichEmpty } from "./rich";

export interface BlockViewProps {
  block: Block;
  edition: Edition;
  /** 当前激活的字段；块被选中但未编辑时为 null，未选中为 undefined。 */
  activeField: string | null | undefined;
  intent?: CaretIntent;
  number?: number;
  readOnly: boolean;
  api: BlockApi;
  contentWidth: number;
}

const OPTION_LETTERS = "ABCDEFGH";

/** 题号变化时上下翻动（插入、删除、拖动排序后题号自愈）。 */
function RollingNumber({ value }: { value: number }) {
  const previous = useRef(value);
  const up = value >= previous.current;
  previous.current = value;
  return <span className="wb-num"><AnimatePresence mode="popLayout" initial={false}>
    <motion.span key={value} initial={{ y: up ? "70%" : "-70%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: up ? "-70%" : "70%", opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 35 }}>{value}</motion.span>
  </AnimatePresence></span>;
}

function useField(props: BlockViewProps, field: string) {
  const { block, activeField, intent, readOnly, api } = props;
  const keys = useMemo(() => api.keys(block.id, field), [api, block.id, field]);
  return { blockId: block.id, field, active: activeField === field, intent: activeField === field ? intent : undefined, readOnly, keys, onActivate: api.activate, onChange: api.change };
}

const HeadingView = memo(function HeadingView(props: BlockViewProps & { block: HeadingBlock }) {
  const f = useField(props, "text");
  return <div className={`wb-h wb-h${props.block.level}`}>
    <RichField {...f} doc={props.block.text} placeholder={props.block.level === 1 ? "章标题" : props.block.level === 2 ? "节标题" : "栏目名"} />
    {props.block.level === 1 && <span className="wb-h1-rule" aria-hidden="true" />}
    {props.block.level === 3 && <span className="wb-h3-rule" aria-hidden="true" />}
  </div>;
});

const TextView = memo(function TextView(props: BlockViewProps & { block: TextBlock }) {
  const f = useField(props, "text");
  return <div className="wb-text"><RichField {...f} lists doc={props.block.text} placeholder="输入正文，按 / 插入题目、公式或版块" /></div>;
});

const NoteView = memo(function NoteView(props: BlockViewProps & { block: NoteBlock }) {
  const { block, api, readOnly, activeField } = props;
  const f = useField(props, "text");
  const editingTitle = activeField !== undefined && !readOnly;
  return <div className="wb-note" data-tone={block.tone}>
    <div className="wb-note-title">
      {editingTitle
        ? <input className="wb-note-title-input" value={block.title} style={{ width: `${Math.max(2, [...block.title].length) + 0.2}em` }} aria-label="版块标题" spellCheck={false}
            onMouseDown={event => event.stopPropagation()}
            onChange={event => { const title = event.target.value; api.update(block.id, b => ({ ...b, title }) as NoteBlock, `title:${block.id}`); }} />
        : <span>{block.title || " "}</span>}
      {block.teacherOnly && <span className="wb-note-flag" data-screen-only>教师版</span>}
    </div>
    <RichField {...f} lists doc={block.text} placeholder="写下要点…" />
  </div>;
});

/** 公式块编辑：原位显示 MathLive 输入框，写完按 Enter / 方向键离开。 */
function FormulaInput({ block, api }: { block: FormulaBlock; api: BlockApi }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const keys = api.keys(block.id, "latex");
    let value = block.latex;
    let field: { remove(): void; value: string } | null = null, alive = true;
    void loadMathfield().then(({ mountMathField }) => {
    if (!alive) return;
    field = mountMathField(element, block.latex, {
      display: true,
      onInput: next => { value = next; api.update(block.id, b => ({ ...b, latex: next }) as FormulaBlock, `formula:${block.id}`); },
      onExit: (side, key) => {
        // 以公式框当前值为准（input 事件可能晚于离开按键）。
        if (field && field.value !== value) { value = field.value; const latest = value; api.update(block.id, b => ({ ...b, latex: latest }) as FormulaBlock, `formula:${block.id}`); }
        if (!value.trim()) { api.remove(block.id); return; }
        if (key === "Escape") { keys.onEscape?.(); return; }
        if (!keys.onArrowOut?.(side === "before" ? "up" : "down")) api.select(block.id);
      },
      onRemove: () => api.remove(block.id),
    });
    });
    return () => { alive = false; field?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="wb-formula-edit" />;
}

const FormulaView = memo(function FormulaView({ block, activeField, readOnly, api }: BlockViewProps & { block: FormulaBlock }) {
  const html = useMemo(() => block.latex.trim() ? formulaHtml(block.latex, true) : "", [block.latex]);
  if (activeField === "latex" && !readOnly) return <div className="wb-formula" data-formula-block=""><FormulaInput block={block} api={api} /></div>;
  return <div className="wb-formula" data-formula-block="" onMouseDown={event => { if (readOnly || event.button !== 0) return; event.preventDefault(); api.activate(block.id, "latex", "end"); }}>
    {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <div className="wb-formula-empty" data-screen-only>点击输入公式</div>}
  </div>;
});

const FigureView = memo(function FigureView(props: BlockViewProps & { block: FigureBlock }) {
  const { block, api, readOnly } = props;
  const f = useField(props, "caption");
  const file = useRef<HTMLInputElement>(null);
  const choose = () => file.current?.click();
  const load = (blob: Blob | undefined) => {
    if (!blob || !blob.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => api.update(block.id, b => ({ ...b, src: String(reader.result) }) as FigureBlock);
    reader.readAsDataURL(blob);
  };
  return <div className="wb-figure">
    {block.src
      ? <img src={block.src} alt="" style={{ width: `${block.width}%` }} draggable={false} />
      : <button type="button" className="wb-figure-empty" data-screen-only disabled={readOnly} onClick={choose}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); load(event.dataTransfer.files[0]); }}>
          <ImagePlus size={18} /><span>选择图片，或拖入此处</span>
        </button>}
    {block.src && <RichField {...f} className="wb-figure-caption" doc={block.caption} placeholder="图注（可留空）" />}
    <input ref={file} type="file" accept="image/*" hidden onChange={event => { load(event.target.files?.[0]); event.target.value = ""; }} />
  </div>;
});

/** 选项列数：按最宽选项的实际渲染宽度选择 4 / 2 / 1 列。 */
function useOptionColumns(contentWidth: number) {
  const measurer = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const root = measurer.current;
    if (!root) return;
    let widest = 0;
    for (const child of Array.from(root.children)) widest = Math.max(widest, (child as HTMLElement).offsetWidth);
    const label = 26, gap = 14, available = contentWidth - 24;
    const need = widest + label + gap;
    const next = need * 4 <= available ? 4 : need * 2 <= available ? 2 : 1;
    setCols(current => current === next ? current : next);
  });
  return { cols, measurer };
}

/**
 * 列数变化时的过渡：按选项相对网格的偏移做 FLIP。
 * 不用 Motion layout——块整体在页面上移动时，布局投影会把选项的视口位移误当成需要动画。
 */
function useColumnFlip(cols: number) {
  const grid = useRef<HTMLDivElement>(null);
  const last = useRef(new Map<string, { x: number; y: number }>());
  const lastCols = useRef(cols);
  const reduced = useReducedMotionConfig();
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(":scope > .wb-option"));
    const now = new Map(items.map(el => [el.dataset.optionId ?? "", { x: el.offsetLeft, y: el.offsetTop }]));
    if (lastCols.current !== cols && !reduced) {
      for (const el of items) {
        const from = last.current.get(el.dataset.optionId ?? ""), to = now.get(el.dataset.optionId ?? "");
        if (from && to && (from.x !== to.x || from.y !== to.y)) {
          el.animate([{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: "none" }], { duration: 340, easing: "cubic-bezier(.22,.9,.24,1)" });
        }
      }
    }
    lastCols.current = cols;
    last.current = now;
  });
  return grid;
}

function OptionsGrid(props: BlockViewProps & { block: QuestionBlock }) {
  const { block, edition, api, readOnly, activeField, intent, contentWidth } = props;
  const { cols, measurer } = useOptionColumns(contentWidth);
  const grid = useColumnFlip(cols);
  const toggleCorrect = (id: string) => {
    if (readOnly || edition !== "teacher") return;
    api.update(block.id, b => {
      const q = b as QuestionBlock;
      const on = q.correct.includes(id);
      return { ...q, correct: q.qtype === "single" ? (on ? [] : [id]) : on ? q.correct.filter(x => x !== id) : [...q.correct, id] };
    });
  };
  return <div ref={grid} className="wb-options" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
    {block.options.map((option, index) => {
      const field = `opt:${option.id}`;
      const correct = block.correct.includes(option.id);
      return <div key={option.id} className="wb-option" data-option-id={option.id} data-correct={correct || undefined}>
        <button type="button" tabIndex={-1} className="wb-option-label" disabled={readOnly || edition !== "teacher"} title={edition === "teacher" ? "标记为正确答案" : undefined}
          onMouseDown={event => event.preventDefault()} onClick={() => toggleCorrect(option.id)}>
          <span>{OPTION_LETTERS[index]}</span>.
        </button>
        <RichField blockId={block.id} field={field} active={activeField === field} intent={activeField === field ? intent : undefined} readOnly={readOnly}
          keys={api.keys(block.id, field)} onActivate={api.activate} onChange={api.change} doc={option.text} placeholder="选项" />
      </div>;
    })}
    <div ref={measurer} className="wb-options-measure" aria-hidden="true">
      {block.options.map(option => <div key={option.id} className="wb-flow"><RichView doc={option.text} /></div>)}
    </div>
  </div>;
}

/** 学生版作答留白：悬停显示标尺，上下拖动调整高度。 */
function AnswerSpace({ block, api, readOnly }: { block: QuestionBlock; api: BlockApi; readOnly: boolean }) {
  const [dragging, setDragging] = useState(false);
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const originY = event.clientY, origin = block.space;
    const zoom = Number(getComputedStyle(target.closest(".wb-content") as HTMLElement).zoom) || 1;
    setDragging(true);
    const move = (e: PointerEvent) => {
      const raw = origin + (e.clientY - originY) / zoom / mmToPx(1);
      const mm = raw < 3 ? 0 : Math.round(Math.min(200, raw));
      api.update(block.id, b => ({ ...b, space: mm }) as QuestionBlock, `space:${block.id}:${originY}`);
    };
    const up = () => { setDragging(false); target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
  };
  return <div className="wb-space" data-dragging={dragging || undefined} style={{ height: mmToPx(block.space) }}>
    {!readOnly && <div className="wb-space-handle" data-screen-only onPointerDown={start} onMouseDown={event => event.stopPropagation()}>
      <span>{block.space ? `留白 ${block.space} mm` : "向下拖动添加留白"}</span>
    </div>}
  </div>;
}

const QuestionView = memo(function QuestionView(props: BlockViewProps & { block: QuestionBlock }) {
  const { block, edition, number } = props;
  const stem = useField(props, "stem");
  const answer = useField(props, "answer");
  const analysis = useField(props, "analysis");
  const choice = block.qtype === "single" || block.qtype === "multi";
  const teacher = edition === "teacher";
  const letters = block.options.flatMap((o, i) => block.correct.includes(o.id) ? [OPTION_LETTERS[i]] : []).join("");
  const showAnswerField = block.qtype === "essay" || (block.qtype === "blank" && !hasBlankNode(block.stem));
  return <div className="wb-q" data-qtype={block.qtype}>
    <div className="wb-q-stem">
      <span className="wb-q-num" data-example={block.label === EXAMPLE_LABEL || undefined}>
        {block.label === EXAMPLE_LABEL ? <>例<RollingNumber value={number ?? 0} /></> : block.label ? block.label : <><RollingNumber value={number ?? 0} />.</>}
      </span>
      <RichField {...stem} doc={block.stem} placeholder={block.qtype === "blank" ? "题干，选中文字设为填空" : "题干"} />
    </div>
    {choice && <OptionsGrid {...props} />}
    {!teacher && (block.space > 0 || (block.qtype === "essay" && !props.readOnly)) && <AnswerSpace block={block} api={props.api} readOnly={props.readOnly} />}
    {teacher && <motion.div className="wb-key" initial={props.readOnly ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: 0.06 }}>
      {choice && <div className="wb-key-row"><span className="wb-key-label">答案</span><span className="wb-key-letters">{letters || "未设置"}</span></div>}
      {showAnswerField && !(props.readOnly && isRichEmpty(block.answer)) && <div className="wb-key-row"><span className="wb-key-label">答案</span><RichField {...answer} lists doc={block.answer} placeholder="参考答案" /></div>}
      {!(props.readOnly && isRichEmpty(block.analysis)) && <div className="wb-key-row"><span className="wb-key-label">解析</span><RichField {...analysis} lists doc={block.analysis} placeholder="解析" /></div>}
    </motion.div>}
  </div>;
});

export const BlockView = memo(function BlockView(props: BlockViewProps) {
  const { block } = props;
  switch (block.kind) {
    case "heading": return <HeadingView {...props} block={block} />;
    case "text": return <TextView {...props} block={block} />;
    case "note": return <NoteView {...props} block={block} />;
    case "question": return <QuestionView {...props} block={block} />;
    case "formula": return <FormulaView {...props} block={block} />;
    case "figure": return <FigureView {...props} block={block} />;
    case "divider": return <div className="wb-divider"><hr /></div>;
    case "pagebreak": return <div className="wb-pagebreak" data-screen-only><span>分页</span></div>;
  }
});
