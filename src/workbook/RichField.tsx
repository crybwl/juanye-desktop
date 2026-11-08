import { Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { memo, useLayoutEffect, useRef, type MouseEvent } from "react";
import { activeEditorStore } from "./editor-store";
import { fieldExtensions, normalizeInlineMath, type FieldKeyHandlers } from "./extensions";
import { isRichEmpty, type RichDoc } from "./rich";
import { RichView } from "./RichView";

/** 进入编辑时光标落点：点击坐标、首尾，或文档内位置。 */
export type CaretIntent = { x: number; y: number } | { pos: number } | "start" | "end";

function placeCaret(editor: Editor, intent: CaretIntent | undefined) {
  const { view } = editor;
  const doc = view.state.doc;
  let selection: Selection = Selection.atEnd(doc);
  if (intent === "start") selection = Selection.atStart(doc);
  else if (intent && typeof intent === "object" && "pos" in intent) selection = TextSelection.near(doc.resolve(Math.max(0, Math.min(doc.content.size, intent.pos))));
  else if (intent && typeof intent === "object") {
    const hit = view.posAtCoords({ left: intent.x, top: intent.y });
    if (hit) {
      const node = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
      selection = node && node.isInline && node.isAtom ? NodeSelection.create(doc, hit.inside) : TextSelection.near(doc.resolve(hit.pos));
    }
  }
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
}

export interface RichFieldProps {
  blockId: string;
  field: string;
  doc: RichDoc;
  active: boolean;
  intent?: CaretIntent;
  placeholder?: string;
  className?: string;
  lists?: boolean;
  readOnly?: boolean;
  keys?: FieldKeyHandlers;
  /** 只有文字与公式，不含标记（试卷字段）。 */
  plain?: boolean;
  /** 编辑器挂载后回调（用于执行排队的插入操作）。 */
  onEditor?: (editor: Editor) => void;
  onActivate: (blockId: string, field: string, intent: CaretIntent) => void;
  onChange: (blockId: string, field: string, doc: RichDoc) => void;
}

/**
 * 静默态渲染纯 DOM；点击后在同一位置同步挂载 Tiptap（useLayoutEffect，绘制前完成），
 * 全书同一时刻只存在一个编辑器实例。
 */
export const RichField = memo(function RichField(props: RichFieldProps) {
  const { blockId, field, doc, active, placeholder, className, readOnly } = props;
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const handlers = useRef<FieldKeyHandlers>({});
  handlers.current = props.keys ?? {};

  useLayoutEffect(() => {
    const element = host.current;
    if (!active || readOnly || !element) return;
    const editor = new Editor({
      element,
      extensions: fieldExtensions(handlers, { lists: latest.current.lists, plain: latest.current.plain }),
      content: latest.current.doc,
      editorProps: { attributes: { class: "wb-flow", spellcheck: "false" } },
      onUpdate: ({ editor: current }) => {
        const { onChange, blockId: id, field: name } = latest.current;
        onChange(id, name, current.getJSON() as RichDoc);
        activeEditorStore.bump();
      },
      onSelectionUpdate: () => activeEditorStore.bump(),
      onFocus: () => activeEditorStore.bump(),
    });
    activeEditorStore.set({ editor, blockId: latest.current.blockId, field: latest.current.field });
    placeCaret(editor, latest.current.intent);
    latest.current.onEditor?.(editor);
    return () => {
      if (!editor.isDestroyed) normalizeInlineMath(editor);
      activeEditorStore.release(editor);
      editor.destroy();
    };
  }, [active, readOnly]);

  const empty = isRichEmpty(doc);
  const shared = { className: `wb-field${className ? ` ${className}` : ""}`, "data-field": field, "data-empty": empty || undefined, "data-placeholder": placeholder };
  if (active && !readOnly) return <div key="edit" ref={host} {...shared} />;
  const activate = (event: MouseEvent<HTMLDivElement>) => {
    if (readOnly || event.button !== 0 || event.defaultPrevented) return;
    event.preventDefault();
    props.onActivate(blockId, field, { x: event.clientX, y: event.clientY });
  };
  return <div key="view" {...shared} onMouseDown={activate}><div className="wb-flow"><RichView doc={doc} /></div></div>;
});
