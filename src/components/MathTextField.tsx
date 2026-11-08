import type { Editor as TiptapEditor } from "@tiptap/core";
import { forwardRef, lazy, Suspense, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent } from "react";
import { canEditVisually, docToMathText, mathTextToDoc } from "../math-text-doc";
import { MathText } from "../math";
import type { RichDoc } from "../workbook/rich";
import { RichView } from "../workbook/RichView";
import type { CaretIntent } from "../workbook/RichField";
import { TexEditor, type TexHandle } from "./TexEditor";
import "./math-text-field.css";

/* ---------- 题目输入方式偏好：可视（默认）/ LaTeX 源码 ---------- */
const MODE_KEY = "juanye.editor-input.v1";
type InputMode = "visual" | "source";
const modeListeners = new Set<() => void>();
let currentMode: InputMode = (() => { try { return localStorage.getItem(MODE_KEY) === "source" ? "source" : "visual"; } catch { return "visual"; } })();
export function setEditorInputMode(mode: InputMode) {
  currentMode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* 偏好仅本机便利 */ }
  modeListeners.forEach(listener => listener());
}
export const useEditorInputMode = () => useSyncExternalStore(listener => { modeListeners.add(listener); return () => { modeListeners.delete(listener); }; }, () => currentMode);

/* ---------- 编辑器按需加载（Tiptap / ProseMirror 不进入首屏包） ---------- */
const loadRichField = () => import("../workbook/RichField");
const RichField = lazy(() => loadRichField().then(module => ({ default: module.RichField })));
const loadEditing = () => import("../workbook/extensions");
let preloaded = false;
/** 空闲时预取编辑器与公式输入，首次点击即可编辑。 */
export function preloadVisualEditing() {
  if (preloaded) return;
  preloaded = true;
  const run = () => { void loadRichField(); void loadEditing().then(module => module.loadMathfield()); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500);
}

export interface MathTextHandle {
  /** 插入行内公式；latex 为 MathLive 片段（#? 占位），源码模式下插入 snippet。 */
  insertMath(latex?: string, snippet?: string, caretBack?: number): void;
  insertText(text: string): void;
  /** 只能在源码中表达的内容（如表格）：本字段切到源码后插入。 */
  insertSource(snippet: string, caretBack?: number): void;
}

export interface MathTextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  /** 可视模式下的占位提示（默认同 placeholder）。 */
  visualPlaceholder?: string;
  label: string;
  /** 回归测试与焦点定位使用的稳定标记。 */
  field: string;
  singleLine?: boolean;
  minH?: number;
  className?: string;
}

/**
 * 试卷题目字段：静态时直接显示排版效果，点击原位编辑（Tiptap + MathLive），
 * 写入仍为原有 Markdown + $…$ 字符串；无法无损可视编辑的内容自动使用源码编辑。
 */
export const MathTextField = forwardRef<MathTextHandle, MathTextFieldProps>(function MathTextField(props, ref) {
  const { value, onChange, onCommit, placeholder, visualPlaceholder = placeholder, label, field, singleLine, minH = 92, className } = props;
  const mode = useEditorInputMode();
  const [active, setActive] = useState(false);
  const [intent, setIntent] = useState<CaretIntent>("end");
  const [forceSource, setForceSource] = useState(false);
  const visualOk = useMemo(() => canEditVisually(value), [value]);
  // 编辑中保持可视模式，避免输入过程中因临时内容切换编辑器。
  const sticky = useRef(false);
  const visual = mode === "visual" && !forceSource && (visualOk || (active && sticky.current));
  sticky.current = visual;
  const doc = useMemo(() => mathTextToDoc(value), [value]);
  const tex = useRef<TexHandle>(null);
  const editor = useRef<TiptapEditor | null>(null);
  const pending = useRef<((editor: TiptapEditor) => void) | null>(null);
  const pendingSource = useRef<{ snippet: string; caretBack?: number } | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const fieldId = useRef(`mtf-${Math.random().toString(36).slice(2)}`).current;

  const activate = useCallback((_id: string, _field: string, next: CaretIntent) => { setIntent(next); setActive(true); }, []);
  const change = useCallback((_id: string, _field: string, next: RichDoc) => {
    const text = docToMathText(next);
    if (text !== latest.current) { latest.current = text; onChange(text); }
  }, [onChange]);
  const keys = useMemo(() => ({
    onEnter: singleLine ? () => { (document.activeElement as HTMLElement | null)?.blur(); return true; } : undefined,
    onEscape: () => { (document.activeElement as HTMLElement | null)?.blur(); return true; },
  }), [singleLine]);
  const onEditor = useCallback((instance: TiptapEditor) => {
    editor.current = instance;
    const job = pending.current;
    pending.current = null;
    if (job) job(instance);
  }, []);
  const withEditor = (job: (instance: TiptapEditor) => void) => {
    if (active && editor.current && !editor.current.isDestroyed) job(editor.current);
    else { pending.current = job; setIntent("end"); setActive(true); }
  };

  useLayoutEffect(() => {
    if (visual || !pendingSource.current || !tex.current) return;
    const { snippet, caretBack } = pendingSource.current;
    pendingSource.current = null;
    tex.current.insert(snippet, caretBack);
  });

  useImperativeHandle(ref, () => ({
    insertMath(latex = "", snippet = "$x$", caretBack = 1) {
      if (!visual) { tex.current?.insert(snippet, caretBack); return; }
      withEditor(instance => {
        void loadEditing().then(async ({ insertMath, loadMathfield }) => {
          const { activeMathField, insertIntoMathField } = await loadMathfield();
          if (activeMathField() && latex) { insertIntoMathField(latex); return; }
          insertMath(instance);
          if (latex) requestAnimationFrame(() => requestAnimationFrame(() => insertIntoMathField(latex)));
        });
      });
    },
    insertText(text) {
      if (!visual) { tex.current?.insert(text); return; }
      withEditor(instance => instance.chain().focus().insertContent(text).run());
    },
    insertSource(snippet, caretBack) {
      if (!visual) { tex.current?.insert(snippet, caretBack); return; }
      pendingSource.current = { snippet, caretBack };
      setActive(false);
      setForceSource(true);
    },
  }));

  // 公式框（MathLive）在内部移动光标时可能短暂失焦且没有 relatedTarget：延后一拍再确认焦点确实离开了本字段。
  const activeRef = useRef(active);
  activeRef.current = active;
  const blur = (event: FocusEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const next = event.relatedTarget as Node | null;
    if (next && container.contains(next)) return;
    if (!activeRef.current) return;
    window.setTimeout(() => {
      const now = document.activeElement;
      if (!activeRef.current || !container.isConnected || (now && now !== document.body && container.contains(now))) return;
      setActive(false);
      editor.current = null;
      onCommit?.(latest.current);
    }, 0);
  };

  if (!visual) return <div className={className} data-exam-field={field}>
    <TexEditor ref={tex} value={value} onChange={onChange} onCommit={onCommit} placeholder={placeholder} label={singleLine ? label : undefined} minH={singleLine ? 40 : minH} />
    {!visualOk && mode === "visual" && <p className="mtf-note">含表格、绘图或特殊格式，使用源码编辑。</p>}
  </div>;

  const fallback = <div className="wb-field" data-empty={!value || undefined} data-placeholder={visualPlaceholder}><div className="wb-flow"><RichView doc={doc} /></div></div>;
  return <div className={`mtf${singleLine ? " is-inline" : ""}${className ? ` ${className}` : ""}`} data-exam-field={field} data-active={active || undefined}
    role="textbox" aria-label={label} aria-multiline={!singleLine} tabIndex={active ? -1 : 0} style={{ "--mtf-min": `${singleLine ? 0 : minH}px` } as React.CSSProperties}
    onFocus={event => { if (!active && event.target === event.currentTarget) activate(fieldId, field, "end"); }}
    onBlur={blur}>
    <Suspense fallback={fallback}>
      <RichField blockId={fieldId} field={field} doc={doc} active={active} intent={intent} plain placeholder={visualPlaceholder}
        keys={keys} onActivate={activate} onChange={change} onEditor={onEditor} />
    </Suspense>
  </div>;
});

/** 源码模式下的实时预览（可视模式不需要）。 */
export function SourcePreview({ text }: { text: string }) {
  return <div className="mtf-preview"><MathText text={text} placeholder="预览" /></div>;
}
