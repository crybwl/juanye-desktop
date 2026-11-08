import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Sigma } from "lucide-react";
import { highlightTex } from "../math";
import { FormulaEditor } from "./FormulaEditor";

/* ---------- 带语法高亮的 LaTeX 编辑器（透明 textarea 叠在高亮层上） ---------- */
export type TexHandle = { insert: (snippet: string, caretBack?: number) => void };
export const TexEditor = forwardRef<TexHandle, { value: string; onChange: (v: string) => void; onCommit?: (v: string) => void; placeholder?: string; minH?: number; label?: string }>(
  function TexEditor({ value, onChange, onCommit, placeholder, minH = 92, label }, ref) {
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
          aria-label={label}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => { if (!e.currentTarget.closest("[inert]")) onCommit?.(e.currentTarget.value); }}
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

