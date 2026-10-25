import { useEffect, useState } from "react";
import { CUBE_TIKZ, extractTikzBlocks } from "../drawing";
import { TikzDrawing } from "../TikzDrawing";
import { Button, inputCls } from "../ui";
export function DrawingEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(value); }, [value]);
  return <div className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">绘图</h3><Button size="sm" variant="outline" onClick={() => setDraft(CUBE_TIKZ)}>立体几何模板</Button></div>
    <textarea aria-label="TikZ 绘图代码" rows={draft ? 7 : 2} className={`${inputCls} h-auto resize-y py-2 font-mono text-[12px]`} value={draft} placeholder="TikZ" onChange={event => { setDraft(event.target.value); setError(""); }} />
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={!draft && !value} onClick={() => { setDraft(""); onChange(""); }}>移除绘图</Button><Button size="sm" variant="outline" disabled={!draft.trim() || draft === value} onClick={() => { if (extractTikzBlocks(draft).length !== 1) { setError("需要一段完整的 tikzpicture"); return; } onChange(draft.trim()); }}>应用绘图</Button></div>
    {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}{value && <div className="rounded-lg bg-white p-3 text-center"><TikzDrawing code={value} /></div>}
  </div>;
}
