import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import {
  Bold, BookMarked, Check, Copy, FlaskConical, Heading1, Heading2, Heading3, ImagePlus, Italic, Lightbulb, ListChecks, Minus, Pilcrow, Plus,
  SeparatorHorizontal, SquareCheck, SquareRadical, TextCursorInput, Trash2, TriangleAlert, Type, Underline, PenLine, CircleDot, Sigma, Keyboard,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BlockApi, Selection } from "./api";
import type { CanvasGeometry } from "./Canvas";
import { useActiveEditor } from "./editor-store";
import { caretAfterNode, insertMath, setNodeAttr, toggleBlank } from "./extensions";
import { insertIntoMathField, toggleMathKeyboard } from "./mathfield";
import { chemistryToLatex, formulaHtml } from "./formula";
import { EXAMPLE_LABEL, convertQuestion, type Block, type BlockKind, type Edition, type FigureBlock, type NoteBlock, type NoteTone, type QuestionBlock, type QuestionKind } from "./model";

const POPOVER_SPRING = { type: "spring", stiffness: 500, damping: 35 } as const;
const stop = (event: { preventDefault(): void }) => event.preventDefault();

export const TEXT_COLORS = [{ value: null, label: "默认", swatch: "#1d2129" }, { value: "#b8322b", label: "红", swatch: "#b8322b" }, { value: "#2c5aa0", label: "蓝", swatch: "#2c5aa0" }, { value: "#2f7a4a", label: "绿", swatch: "#2f7a4a" }] as const;
export const NOTE_TONES: { value: NoteTone; label: string }[] = [{ value: "blue", label: "蓝" }, { value: "red", label: "红" }, { value: "green", label: "绿" }, { value: "purple", label: "紫" }, { value: "ink", label: "灰" }];

/** 内容坐标（未缩放）中的元素矩形。 */
function localRect(element: Element, root: HTMLElement, zoom: number) {
  const a = element.getBoundingClientRect(), b = root.getBoundingClientRect();
  return { x: (a.left - b.left) / zoom, y: (a.top - b.top) / zoom, w: a.width / zoom, h: a.height / zoom };
}

function ToolButton({ label, active, onClick, children, danger }: { label: string; active?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="wb-tool" data-active={active || undefined} data-danger={danger || undefined} aria-label={label} title={label} onMouseDown={stop} onClick={onClick}>{children}</button>;
}
const Sep = () => <span className="wb-tool-sep" aria-hidden="true" />;

export interface ToolbarOps {
  duplicate(blockId: string): void;
  replace(blockId: string, kind: BlockKind, variant?: string): void;
  setEdition(edition: Edition): void;
}

/** 单例浮动工具栏：位置用弹簧插值，在块与选区之间滑行，而不是消失再出现。 */
export function FloatingToolbar({ geometry, selection, book, edition, zoom, api, ops, contentRef }: {
  geometry: CanvasGeometry; selection: Selection | null; book: { blocks: Block[] }; edition: Edition; zoom: number; api: BlockApi; ops: ToolbarOps; contentRef: React.RefObject<HTMLDivElement>;
}) {
  const { active } = useActiveEditor();
  const block = selection ? book.blocks.find(b => b.id === selection.blockId) : undefined;
  const editor = active && block && active.blockId === block.id ? active.editor : null;
  const nodeSel = editor && editor.state.selection instanceof NodeSelection ? editor.state.selection.node.type.name : null;
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, POPOVER_SPRING), sy = useSpring(y, POPOVER_SPRING);
  // 正文/标题只有光标时不打扰书写；选中文字、或选中整块时才出现。
  const caretOnly = Boolean(editor && editor.state.selection.empty && (block?.kind === "text" || block?.kind === "heading"));
  const visible = Boolean(block) && !nodeSel && !caretOnly;
  const wasVisible = useRef(false);

  useLayoutEffect(() => {
    if (!block || !visible) { wasVisible.current = false; return; }
    const rect = geometry.rect(block.id);
    const root = contentRef.current;
    if (!rect || !root) return;
    let px = rect.x + rect.w / 2, py = rect.y - 6;
    if (editor && !editor.state.selection.empty) {
      const { from, to } = editor.state.selection;
      const base = root.getBoundingClientRect();
      const a = editor.view.coordsAtPos(from), b = editor.view.coordsAtPos(to);
      px = ((a.left + b.right) / 2 - base.left) / zoom;
      py = (Math.min(a.top, b.top) - base.top) / zoom - 6;
    }
    const width = ref.current?.offsetWidth ?? 280;
    px = Math.max(width / 2 + 8, Math.min(geometry.pageW - width / 2 - 8, px));
    if (!wasVisible.current) { sx.jump(px); sy.jump(py); }
    x.set(px); y.set(py);
    wasVisible.current = true;
  });

  if (!block || !visible) return <AnimatePresence />;
  const update = (recipe: (b: Block) => Block) => api.update(block.id, recipe);
  const marks = editor ? {
    bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline"), dots: editor.isActive("dots"),
    color: (editor.getAttributes("textStyle").color as string | undefined) ?? null,
  } : null;

  return <AnimatePresence>
    <motion.div key="toolbar" ref={ref} className="wb-toolbar wb-popover" data-screen-only style={{ x: sx, y: sy }}
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ opacity: { duration: 0.15 }, scale: POPOVER_SPRING }}
      onMouseDown={stop}>
      <motion.div className="wb-toolbar-row" layout="size" transition={POPOVER_SPRING}>
        {editor && marks && <>
          <ToolButton label="加粗 Ctrl+B" active={marks.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolButton>
          <ToolButton label="倾斜 Ctrl+I" active={marks.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolButton>
          <ToolButton label="下划线 Ctrl+U" active={marks.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><Underline size={15} /></ToolButton>
          <ToolButton label="着重号 Ctrl+." active={marks.dots} onClick={() => editor.chain().focus().toggleMark("dots").run()}><span className="wb-tool-dots">着</span></ToolButton>
          <Sep />
          <ToolButton label="设为填空 Ctrl+Shift+K" onClick={() => toggleBlank(editor)}><TextCursorInput size={15} /></ToolButton>
          <ToolButton label="插入公式（输入 $ 或 Ctrl+Shift+M）" onClick={() => insertMath(editor)}><SquareRadical size={15} /></ToolButton>
          <ToolButton label="化学方程式" onClick={() => insertMath(editor, "\\ce{}")}><FlaskConical size={15} /></ToolButton>
          <Sep />
          {TEXT_COLORS.map(color => <button key={color.label} type="button" className="wb-swatch" aria-label={`文字颜色：${color.label}`} title={color.label}
            data-active={marks.color === color.value || (!marks.color && color.value === null) || undefined} style={{ "--swatch": color.swatch } as React.CSSProperties}
            onMouseDown={stop} onClick={() => color.value ? editor.chain().focus().setColor(color.value).run() : editor.chain().focus().unsetColor().run()} />)}
          <Sep />
        </>}
        <BlockTools block={block} edition={edition} editing={Boolean(editor)} update={update} ops={ops} />
        <Sep />
        <ToolButton label="复制此块 Ctrl+D" onClick={() => ops.duplicate(block.id)}><Copy size={15} /></ToolButton>
        <ToolButton label="删除此块" danger onClick={() => api.remove(block.id)}><Trash2 size={15} /></ToolButton>
      </motion.div>
    </motion.div>
  </AnimatePresence>;
}

function BlockTools({ block, edition, editing, update, ops }: { block: Block; edition: Edition; editing: boolean; update: (recipe: (b: Block) => Block) => void; ops: ToolbarOps }) {
  switch (block.kind) {
    case "heading": return <>
      {([1, 2, 3] as const).map(level => <ToolButton key={level} label={["章标题", "节标题", "栏目标题"][level - 1]} active={block.level === level} onClick={() => update(b => ({ ...b, level }) as Block)}>
        {level === 1 ? <Heading1 size={15} /> : level === 2 ? <Heading2 size={15} /> : <Heading3 size={15} />}
      </ToolButton>)}
      <ToolButton label="转为正文" onClick={() => ops.replace(block.id, "text")}><Pilcrow size={15} /></ToolButton>
    </>;
    case "text": return <>
      <ToolButton label="转为节标题" onClick={() => ops.replace(block.id, "heading", "2")}><Type size={15} /></ToolButton>
      <ToolButton label="转为知识框" onClick={() => ops.replace(block.id, "note", "blue")}><BookMarked size={15} /></ToolButton>
    </>;
    case "note": return <>
      {!editing && NOTE_TONES.map(tone => <button key={tone.value} type="button" className="wb-swatch wb-tone" data-tone={tone.value} aria-label={`版块颜色：${tone.label}`} title={tone.label}
        data-active={block.tone === tone.value || undefined} onMouseDown={stop} onClick={() => update(b => ({ ...b, tone: tone.value }) as NoteBlock)} />)}
      {!editing && <Sep />}
      <ToolButton label={block.teacherOnly ? "改为学生版也显示" : "仅在教师版显示"} active={block.teacherOnly} onClick={() => update(b => ({ ...b, teacherOnly: !(b as NoteBlock).teacherOnly }) as NoteBlock)}>
        <span className="wb-tool-text">教师</span>
      </ToolButton>
    </>;
    case "question": {
      const kinds: { value: QuestionKind; label: string }[] = [{ value: "single", label: "单选" }, { value: "multi", label: "多选" }, { value: "blank", label: "填空" }, { value: "essay", label: "解答" }];
      const choice = block.qtype === "single" || block.qtype === "multi";
      return <>
        <div className="wb-tool-seg" role="radiogroup" aria-label="题型">
          {kinds.map(kind => <button key={kind.value} type="button" role="radio" aria-checked={block.qtype === kind.value} className="wb-tool-seg-item" onMouseDown={stop}
            onClick={() => update(b => convertQuestion(b as QuestionBlock, kind.value))}>
            {block.qtype === kind.value && <motion.span layoutId="wb-qtype-pill" className="wb-tool-seg-pill" transition={POPOVER_SPRING} />}
            <span>{kind.label}</span>
          </button>)}
        </div>
        <Sep />
        {choice && <>
          <ToolButton label="添加选项" onClick={() => update(b => { const q = b as QuestionBlock; return q.options.length >= 8 ? q : { ...q, options: [...q.options, { id: `o_${Date.now().toString(36)}`, text: { type: "doc", content: [{ type: "paragraph" }] } }] }; })}><Plus size={15} /></ToolButton>
          <ToolButton label="删除最后一个选项" onClick={() => update(b => { const q = b as QuestionBlock; if (q.options.length <= 2) return q; const last = q.options[q.options.length - 1]; return { ...q, options: q.options.slice(0, -1), correct: q.correct.filter(id => id !== last.id) }; })}><Minus size={15} /></ToolButton>
        </>}
        {!choice && edition === "student" && <>
          <ToolButton label="减少留白" onClick={() => update(b => ({ ...b, space: Math.max(0, (b as QuestionBlock).space - 8) }) as QuestionBlock)}><Minus size={15} /></ToolButton>
          <span className="wb-tool-text wb-tool-readout">{block.space} mm</span>
          <ToolButton label="增加留白" onClick={() => update(b => ({ ...b, space: Math.min(200, (b as QuestionBlock).space + 8) }) as QuestionBlock)}><Plus size={15} /></ToolButton>
        </>}
        <ToolButton label={block.label === EXAMPLE_LABEL ? "改为练习题" : "设为例题"} active={block.label === EXAMPLE_LABEL} onClick={() => update(b => ({ ...b, label: (b as QuestionBlock).label === EXAMPLE_LABEL ? undefined : EXAMPLE_LABEL }) as QuestionBlock)}>
          <span className="wb-tool-text">例题</span>
        </ToolButton>
        <ToolButton label={edition === "teacher" ? "回到学生版" : "编辑答案与解析（教师版）"} active={edition === "teacher"} onClick={() => ops.setEdition(edition === "teacher" ? "student" : "teacher")}>
          <span className="wb-tool-text">答案</span>
        </ToolButton>
      </>;
    }
    case "figure": return <>
      {[30, 45, 60, 80, 100].map(width => <ToolButton key={width} label={`宽度 ${width}%`} active={block.width === width} onClick={() => update(b => ({ ...b, width }) as FigureBlock)}>
        <span className="wb-tool-text">{width}</span>
      </ToolButton>)}
    </>;
    case "divider": case "pagebreak": return <span className="wb-tool-text wb-tool-readout">{block.kind === "divider" ? "分隔线" : "分页符"}</span>;
    default: return null;
  }
}

/* ---------------- 公式辅助条（行内公式 / 公式块共用） ---------------- */

/** MathLive 片段：#? 为待填占位，#0 为当前选中内容。 */
const SNIPPETS: { label: string; tex: string; title: string }[] = [
  { label: "a/b", tex: String.raw`\dfrac{#0}{#?}`, title: "分式（也可直接输入 /）" }, { label: "√", tex: String.raw`\sqrt{#0}`, title: "根号（也可输入 sqrt）" },
  { label: "ⁿ√", tex: String.raw`\sqrt[#?]{#0}`, title: "n 次根号" }, { label: "xⁿ", tex: "#0^{#?}", title: "上标（也可输入 ^）" }, { label: "xₙ", tex: "#0_{#?}", title: "下标（也可输入 _）" },
  { label: "→AB", tex: String.raw`\overrightarrow{#0}`, title: "向量" }, { label: "∠", tex: String.raw`\angle `, title: "角" }, { label: "△", tex: String.raw`\triangle `, title: "三角形" }, { label: "°", tex: String.raw`^{\circ}`, title: "度" },
  { label: "≤", tex: String.raw`\le `, title: "小于等于" }, { label: "≥", tex: String.raw`\ge `, title: "大于等于" }, { label: "≠", tex: String.raw`\ne `, title: "不等于" }, { label: "±", tex: String.raw`\pm `, title: "正负" },
  { label: "π", tex: String.raw`\pi `, title: "圆周率（也可输入 pi）" }, { label: "∞", tex: String.raw`\infty `, title: "无穷" }, { label: "∈", tex: String.raw`\in `, title: "属于" },
  { label: "∑", tex: String.raw`\sum_{#?}^{#?}`, title: "求和" }, { label: "∫", tex: String.raw`\int_{#?}^{#?}`, title: "积分" }, { label: "lim", tex: String.raw`\lim_{#?\to #?}`, title: "极限" },
  { label: "{ 分段", tex: String.raw`\begin{cases}#?\\#?\end{cases}`, title: "分段函数" }, { label: "→", tex: String.raw`\xrightarrow{#?}`, title: "带条件箭头" },
];

/** 贴在正在编辑的公式下方：常用符号、虚拟键盘、化学式速写。按钮不抢焦点，直接插入到公式框。 */
export function MathHelper({ anchor, width: limit }: { anchor: { x: number; y: number; w: number; h: number }; width: number }) {
  const [chem, setChem] = useState("");
  const width = 392;
  const left = Math.max(8, Math.min(limit - width - 8, anchor.x));
  return <motion.div className="wb-panel wb-math-helper wb-popover" data-screen-only style={{ left, top: anchor.y + anchor.h + 8, width }}
    initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ opacity: { duration: 0.15 }, default: POPOVER_SPRING }}
    onMouseDown={event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }}>
    <div className="wb-panel-head">
      <Sigma size={13} /><span>直接输入：/ 分式　^ 上标　sqrt 根号</span>
      <button type="button" className="wb-chip wb-chip-icon" title="虚拟数学键盘" onClick={() => toggleMathKeyboard()}><Keyboard size={13} /></button>
    </div>
    <div className="wb-chips">{SNIPPETS.map(s => <button key={s.label} type="button" className="wb-chip" title={s.title} onClick={() => insertIntoMathField(s.tex)}>{s.label}</button>)}</div>
    <div className="wb-chem">
      <FlaskConical size={13} />
      <input value={chem} placeholder="化学式速写：2H2O2 == 2H2O + O2↑，回车插入" spellCheck={false} onChange={event => setChem(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && chem.trim() && !event.nativeEvent.isComposing) { event.preventDefault(); insertIntoMathField(chemistryToLatex(chem)); setChem(""); } }} />
      {chem.trim() && <span className="wb-chem-preview" dangerouslySetInnerHTML={{ __html: formulaHtml(chemistryToLatex(chem)) }} />}
    </div>
  </motion.div>;
}

/** 行内原子节点被选中时：公式显示辅助条，填空显示答案面板。 */
export function NodePanels({ selection, zoom, contentRef, pageWidth }: { selection: Selection | null; zoom: number; contentRef: React.RefObject<HTMLDivElement>; pageWidth: number }) {
  const { active } = useActiveEditor();
  const editor = active && selection && active.blockId === selection.blockId ? active.editor : null;
  const sel = editor?.state.selection;
  const node = sel instanceof NodeSelection ? sel.node : null;
  const pos = sel instanceof NodeSelection ? sel.from : -1;
  const root = contentRef.current;
  const anchor = useMemo(() => {
    if (!editor || !node || !root) return null;
    const dom = editor.view.nodeDOM(pos);
    return dom instanceof Element ? localRect(dom, root, zoom) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, node, pos, root, zoom]);
  if (!editor || !node || !anchor) return null;
  if (node.type.name === "inlineMath") return <MathHelper key={`m${pos}`} anchor={anchor} width={pageWidth} />;
  if (node.type.name === "blank") return <BlankPanel key={`b${pos}`} editor={editor} pos={pos} answer={String(node.attrs.answer)} anchor={anchor} />;
  return null;
}

function BlankPanel({ editor, pos, answer, anchor }: { editor: Editor; pos: number; answer: string; anchor: { x: number; y: number; w: number; h: number } }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const width = 260;
  return <motion.div className="wb-panel wb-popover" data-screen-only style={{ left: anchor.x + anchor.w / 2 - width / 2, top: anchor.y + anchor.h + 8, width }}
    initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ opacity: { duration: 0.15 }, default: POPOVER_SPRING }}>
    <div className="wb-panel-head"><TextCursorInput size={13} /><span>填空答案</span><span className="wb-panel-hint">教师版显示在横线上</span></div>
    <input ref={input} className="wb-panel-input" value={answer} placeholder="答案，可含 $公式$" spellCheck={false}
      onChange={event => setNodeAttr(editor, pos, { answer: event.target.value })}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === "Escape") && !event.nativeEvent.isComposing) { event.preventDefault(); caretAfterNode(editor, pos); } }} />
    <div className="wb-panel-actions">
      <button type="button" className="wb-chip" onMouseDown={stop} onClick={() => toggleBlank(editor)}>取消挖空</button>
      <button type="button" className="wb-chip" onMouseDown={stop} onClick={() => caretAfterNode(editor, pos)}><Check size={12} />完成</button>
    </div>
  </motion.div>;
}

/* ---------------- 插入菜单（“+” 与 “/” 共用） ---------------- */

export interface InsertChoice { kind: BlockKind; variant?: string; label: string; hint: string; icon: ReactNode; group: string }
export const INSERT_CHOICES: InsertChoice[] = [
  { group: "文字", kind: "text", label: "正文", hint: "段落", icon: <Pilcrow size={15} /> },
  { group: "文字", kind: "heading", variant: "1", label: "章标题", hint: "居中大标题", icon: <Heading1 size={15} /> },
  { group: "文字", kind: "heading", variant: "2", label: "节标题", hint: "", icon: <Heading2 size={15} /> },
  { group: "文字", kind: "heading", variant: "3", label: "栏目", hint: "典例精析、课堂训练…", icon: <Heading3 size={15} /> },
  { group: "题目", kind: "question", variant: "single", label: "单选题", hint: "", icon: <CircleDot size={15} /> },
  { group: "题目", kind: "question", variant: "multi", label: "多选题", hint: "", icon: <SquareCheck size={15} /> },
  { group: "题目", kind: "question", variant: "blank", label: "填空题", hint: "选中文字设为填空", icon: <TextCursorInput size={15} /> },
  { group: "题目", kind: "question", variant: "essay", label: "解答题", hint: "带作答留白", icon: <PenLine size={15} /> },
  { group: "版块", kind: "note", variant: "blue", label: "知识梳理", hint: "", icon: <BookMarked size={15} /> },
  { group: "版块", kind: "note", variant: "green", label: "方法技巧", hint: "", icon: <Lightbulb size={15} /> },
  { group: "版块", kind: "note", variant: "red", label: "易错警示", hint: "", icon: <TriangleAlert size={15} /> },
  { group: "版块", kind: "formula", label: "公式块", hint: "居中显示", icon: <SquareRadical size={15} /> },
  { group: "版块", kind: "figure", label: "图片", hint: "", icon: <ImagePlus size={15} /> },
  { group: "版块", kind: "divider", label: "分隔线", hint: "", icon: <SeparatorHorizontal size={15} /> },
  { group: "版块", kind: "pagebreak", label: "分页", hint: "后续内容另起一页", icon: <ListChecks size={15} /> },
];

export function InsertMenu({ anchor, title, onChoose, onClose }: { anchor: { x: number; y: number }; title: string; onChoose: (choice: InsertChoice) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setIndex(i => (i + 1) % INSERT_CHOICES.length); }
      else if (event.key === "ArrowUp") { event.preventDefault(); setIndex(i => (i - 1 + INSERT_CHOICES.length) % INSERT_CHOICES.length); }
      else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onChoose(INSERT_CHOICES[index]); }
      else if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [index, onChoose, onClose]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }); }, [index]);
  let group = "";
  return <motion.div className="wb-menu wb-popover" data-screen-only style={{ left: anchor.x, top: anchor.y }}
    initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }} transition={{ opacity: { duration: 0.15 }, default: POPOVER_SPRING }}
    onMouseDown={stop}>
    <div className="wb-menu-title">{title}</div>
    <div ref={list} className="wb-menu-list" role="menu">
      {INSERT_CHOICES.map((choice, i) => {
        const header = choice.group !== group ? (group = choice.group) : null;
        return <div key={`${choice.kind}-${choice.variant ?? ""}`}>
          {header && <div className="wb-menu-group">{header}</div>}
          <button type="button" role="menuitem" data-index={i} className="wb-menu-item" data-active={i === index || undefined}
            onMouseEnter={() => setIndex(i)} onClick={() => onChoose(choice)}>
            {i === index && <motion.span layoutId="wb-menu-pill" className="wb-menu-pill" transition={POPOVER_SPRING} />}
            <span className="wb-menu-icon">{choice.icon}</span><span>{choice.label}</span>{choice.hint && <span className="wb-menu-hint">{choice.hint}</span>}
          </button>
        </div>;
      })}
    </div>
  </motion.div>;
}
