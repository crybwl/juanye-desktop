import { Extension, InputRule, Mark, Node, PasteRule, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import type { MathfieldElement } from "mathlive";
import { blankNodeHtml, mathNodeHtml } from "./RichView";

let lastKey = "";
/** 正在打开（模块加载中）的公式节点所缓存的按键。 */
let opening: { typed: string } | null = null;

/** MathLive 约 800 KB：首次编辑公式时才加载，空闲时预取。 */
let mathfieldModule: Promise<typeof import("./mathfield")> | null = null;
export const loadMathfield = () => (mathfieldModule ??= import("./mathfield"));

/**
 * 行内公式：原子节点，静态时 KaTeX 渲染；选中即原位变成 MathLive 输入框（Desmos 式）。
 * 正文中输入 `$` 新建公式；粘贴的 `$x^2$` 自动转换。
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: "", parseHTML: element => element.getAttribute("data-latex") ?? "", renderHTML: attributes => ({ "data-latex": attributes.latex }) },
      /** 独立公式（$$…$$ / \[…\]）：单独成行居中。 */
      display: { default: false, parseHTML: element => element.hasAttribute("data-display"), renderHTML: attributes => attributes.display ? { "data-display": "" } : {} },
      /** 原始定界符，保证试卷字符串无损往返。 */
      delim: { default: null, rendered: false },
    };
  },
  parseHTML() { return [{ tag: "span[data-inline-math]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes({ "data-inline-math": "", class: "wb-math" }, HTMLAttributes)]; },
  renderText({ node }) { return node.attrs.display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`; },
  addProseMirrorPlugins() {
    // 记录进入方向：从左侧按 → 进入公式时光标在开头，从右侧按 ← 进入时在末尾。
    return [new Plugin({ props: {
      handleKeyDown: (_view, event) => {
        if (opening && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) { opening.typed += event.key; return true; }
        lastKey = event.key; return false;
      },
      handleTextInput: (_view, _from, _to, text) => { if (!opening) return false; opening.typed += text; return true; },
      handleClick: () => { lastKey = ""; return false; },
    } })];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("span");
      const display = Boolean(node.attrs.display);
      dom.className = display ? "wb-math is-display" : "wb-math";
      dom.dataset.inlineMath = "";
      dom.contentEditable = "false";
      let latex = String(node.attrs.latex);
      let field: MathfieldElement | null = null;
      let pendingOpen: { typed: string } | null = null;
      const paint = () => { dom.innerHTML = mathNodeHtml(latex, display); };
      paint();
      const position = () => (typeof getPos === "function" ? getPos() : undefined);
      const exit = (side: "before" | "after") => {
        const pos = position();
        if (pos == null) return;
        const current = editor.state.doc.nodeAt(pos);
        const tr = editor.state.tr;
        // 快速输入后立即离开时 input 事件可能尚未派发：以公式框当前值为准，并在同一事务写回。
        if (field && field.value !== latex) {
          latex = field.value;
          tr.setNodeMarkup(pos, undefined, { ...current?.attrs, latex });
        }
        if (!latex.trim()) tr.delete(pos, pos + (current?.nodeSize ?? 1)).setSelection(TextSelection.create(tr.doc, pos));
        else tr.setSelection(TextSelection.create(tr.doc, side === "before" ? pos : pos + (current?.nodeSize ?? 1)));
        editor.view.dispatch(tr);
        editor.view.focus();
      };
      const open = () => {
        if (field || pendingOpen || !editor.isEditable) return;
        const buffer = { typed: "" };
        pendingOpen = buffer;
        opening = buffer;
        const from = lastKey === "ArrowRight" ? "start" : "end";
        void loadMathfield().then(({ mountMathField }) => {
        if (pendingOpen !== buffer) return;
        pendingOpen = null;
        if (opening === buffer) opening = null;
        dom.classList.add("is-editing");
        dom.textContent = "";
        field = mountMathField(dom, latex, {
          display,
          from,
          typed: buffer.typed,
          onInput: value => {
            const pos = position();
            if (pos == null || value === latex) return;
            latex = value;
            // 替换原子节点会让 NodeSelection 映射失效；同一事务内重新选中，公式框保持打开。
            const current = editor.state.doc.nodeAt(pos);
            const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current?.attrs, latex: value });
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            editor.view.dispatch(tr);
          },
          onExit: exit,
          onRemove: () => { latex = ""; exit("before"); },
        });
        });
      };
      const close = () => {
        if (opening === pendingOpen) opening = null;
        pendingOpen = null;
        if (!field) return;
        field.remove();
        field = null;
        dom.classList.remove("is-editing");
        paint();
      };
      return {
        dom,
        update: next => {
          if (next.type.name !== "inlineMath" || Boolean(next.attrs.display) !== display) return false;
          const value = String(next.attrs.latex);
          if (value !== latex) { latex = value; if (field) { if (field.value !== value) field.value = value; } else paint(); }
          return true;
        },
        selectNode: () => { dom.classList.add("is-selected"); open(); },
        deselectNode: () => { dom.classList.remove("is-selected"); close(); },
        // 公式框内部的键盘/鼠标事件交给 MathLive，ProseMirror 不处理。
        stopEvent: event => Boolean(field && event.target instanceof window.Node && field.contains(event.target as globalThis.Node)),
        ignoreMutation: () => true,
        destroy: close,
      };
    };
  },
  addInputRules() {
    return [new InputRule({
      find: /(?<![\\$])\$([^$\n]+)\$$/,
      handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1].trim() })); },
    })];
  },
  addPasteRules() {
    return [new PasteRule({
      find: INLINE_MATH_GLOBAL,
      handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create({ latex: String(match[1]).trim() })); },
    })];
  },
});

const INLINE_MATH_GLOBAL = /(?<![\\$])\$([^$\n]+)\$(?!\$)/g;

/** 退出编辑时把仍以 `$…$` 形式存在的文字转换为公式节点（例如输入法一次提交整段）。 */
export function normalizeInlineMath(editor: Editor) {
  const { state } = editor;
  const type = state.schema.nodes.inlineMath;
  const hits: { from: number; to: number; latex: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const pattern = new RegExp(INLINE_MATH_GLOBAL.source, "g");
    for (let m: RegExpExecArray | null; (m = pattern.exec(node.text));) hits.push({ from: pos + m.index, to: pos + m.index + m[0].length, latex: m[1].trim() });
  });
  if (!hits.length) return;
  const tr = state.tr;
  for (const hit of hits.reverse()) tr.replaceWith(hit.from, hit.to, type.create({ latex: hit.latex }));
  editor.view.dispatch(tr);
}

/** 挖空：学生版为下划线（宽度随答案），教师版在横线上显示答案。 */
export const Blank = Node.create({
  name: "blank",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { answer: { default: "", parseHTML: element => element.getAttribute("data-answer") ?? "", renderHTML: attributes => ({ "data-answer": attributes.answer }) } };
  },
  parseHTML() { return [{ tag: "span[data-blank]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes({ "data-blank": "", class: "wb-blank" }, HTMLAttributes)]; },
  renderText() { return "____"; },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "wb-blank";
      dom.dataset.blank = "";
      dom.contentEditable = "false";
      let answer = String(node.attrs.answer);
      dom.innerHTML = blankNodeHtml(answer);
      return {
        dom,
        update: next => {
          if (next.type.name !== "blank") return false;
          if (next.attrs.answer !== answer) { answer = String(next.attrs.answer); dom.innerHTML = blankNodeHtml(answer); }
          return true;
        },
        selectNode: () => dom.classList.add("is-selected"),
        deselectNode: () => dom.classList.remove("is-selected"),
        ignoreMutation: () => true,
      };
    };
  },
});

/** 着重号（字下加点）。 */
export const Dots = Mark.create({
  name: "dots",
  parseHTML() { return [{ tag: "span[data-dots]" }]; },
  renderHTML() { return ["span", { "data-dots": "", class: "wb-dots" }, 0]; },
});

export interface FieldKeyHandlers {
  /** 返回 true 表示已处理。 */
  onEnter?: (editor: Editor) => boolean;
  onBackspaceAtStart?: (editor: Editor) => boolean;
  onArrowOut?: (direction: "up" | "down") => boolean;
  onEscape?: () => boolean;
  onTab?: (backwards: boolean) => boolean;
  /** 空段落输入 “/” 打开插入菜单。 */
  onSlash?: () => boolean;
}

export const FieldKeys = Extension.create<{ handlers: { current: FieldKeyHandlers } }>({
  name: "fieldKeys",
  addOptions() { return { handlers: { current: {} } }; },
  addKeyboardShortcuts() {
    const h = () => this.options.handlers.current;
    const atDocEdge = (editor: Editor, direction: "up" | "down") => {
      const { $from } = editor.state.selection;
      const top = $from.index(0), last = editor.state.doc.childCount - 1;
      return (direction === "up" ? top === 0 : top === last) && editor.view.endOfTextblock(direction);
    };
    return {
      Enter: ({ editor }) => h().onEnter?.(editor) ?? false,
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty || selection.$from.depth !== 1 || selection.$from.parentOffset !== 0 || selection.$from.index(0) !== 0) return false;
        return h().onBackspaceAtStart?.(editor) ?? false;
      },
      ArrowUp: ({ editor }) => atDocEdge(editor, "up") && (h().onArrowOut?.("up") ?? false),
      ArrowDown: ({ editor }) => atDocEdge(editor, "down") && (h().onArrowOut?.("down") ?? false),
      Escape: () => h().onEscape?.() ?? false,
      Tab: () => h().onTab?.(false) ?? false,
      "Shift-Tab": () => h().onTab?.(true) ?? false,
      "/": ({ editor }) => editor.isEmpty && (h().onSlash?.() ?? false),
      "$": ({ editor }) => { insertMath(editor); return true; },
      "Mod-Shift-k": ({ editor }) => { if (editor.schema.nodes.blank) toggleBlank(editor); return Boolean(editor.schema.nodes.blank); },
      "Mod-Shift-m": ({ editor }) => { insertMath(editor); return true; },
      "Mod-.": ({ editor }) => Boolean(editor.schema.marks.dots) && editor.chain().focus().toggleMark("dots").run(),
    };
  },
});

export function fieldExtensions(handlers: { current: FieldKeyHandlers }, options: { lists?: boolean; plain?: boolean } = {}) {
  // plain：试卷字段只有文字与公式（与 Markdown 字符串无损往返），不提供加粗等标记。
  if (options.plain) return [
    StarterKit.configure({
      heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false, link: false,
      trailingNode: false, dropcursor: false, gapcursor: false, bold: false, italic: false, underline: false, strike: false,
      bulletList: false, orderedList: false, listItem: false, listKeymap: false, hardBreak: false,
    }),
    InlineMath,
    FieldKeys.configure({ handlers }),
  ];
  return [
    StarterKit.configure({
      heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false, link: false,
      trailingNode: false, dropcursor: false, gapcursor: false,
      ...(options.lists ? {} : { bulletList: false, orderedList: false, listItem: false, listKeymap: false }),
    }),
    TextStyle, Color, Dots, InlineMath, Blank,
    FieldKeys.configure({ handlers }),
  ];
}

/* ---------- 编辑命令（供浮动工具栏与快捷键共用） ---------- */

export function insertMath(editor: Editor, latex = "") {
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? latex : editor.state.doc.textBetween(from, to, " ");
  const node = editor.schema.nodes.inlineMath.create({ latex: selected });
  const tr = editor.state.tr.replaceRangeWith(from, to, node);
  tr.setSelection(NodeSelection.create(tr.doc, from));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export function toggleBlank(editor: Editor) {
  const { state } = editor;
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === "blank") {
    const answer = String(selection.node.attrs.answer);
    const tr = state.tr.replaceSelectionWith(answer ? state.schema.text(answer) : state.schema.text(" "), false);
    editor.view.dispatch(tr);
    return;
  }
  const { from, to, empty } = selection;
  const answer = empty ? "" : state.doc.textBetween(from, to, " ", leaf => leaf.type.name === "inlineMath" ? `$${leaf.attrs.latex}$` : leaf.type.name === "blank" ? String(leaf.attrs.answer) : "");
  const tr = state.tr.replaceRangeWith(from, to, state.schema.nodes.blank.create({ answer: answer.trim() }));
  tr.setSelection(empty ? NodeSelection.create(tr.doc, from) : TextSelection.create(tr.doc, Math.min(tr.doc.content.size, from + 1)));
  editor.view.dispatch(tr);
  editor.view.focus();
}

export function setNodeAttr(editor: Editor, pos: number, attrs: Record<string, unknown>) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
}

/** 退出原子节点编辑，把光标放到节点之后。 */
export function caretAfterNode(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + (node?.nodeSize ?? 0)));
  editor.view.dispatch(tr);
  editor.view.focus();
}

export function deleteNodeAt(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  editor.view.focus();
}

/** Enter 拆段：返回光标后的内容（作为新块），当前编辑器保留光标前内容。 */
export function splitAtCursor(editor: Editor): unknown {
  const { state } = editor;
  const { from, to } = state.selection;
  const end = state.doc.content.size;
  const rest = state.doc.slice(to, end);
  const restJson = rest.content.toJSON() as unknown[] | null;
  editor.view.dispatch(state.tr.delete(from, end));
  return { type: "doc", content: restJson?.length ? restJson : [{ type: "paragraph" }] };
}
