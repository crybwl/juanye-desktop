import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import type { Question, QuestionFigure } from "../types";
import { appendFigures, questionFigures } from "../figures";
import { Button, IconButton, inputCls } from "../ui";
import { Select } from "./Select";

const read = (file: File) => new Promise<string>((resolve, reject) => {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) return reject(new Error("请选择 10 MB 内的 PNG、JPG 或 WebP 图片"));
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("图片读取失败"));
  reader.readAsDataURL(file);
});

export function FigureEditor({ question, onChange }: { question: Question; onChange: (patch: Partial<Question>) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ question, onChange });
  latest.current = { question, onChange };
  const alive = useRef(true);
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const figures = questionFigures(question);
  const save = (items: QuestionFigure[]) => latest.current.onChange({ figure: undefined, figures: items });
  const load = (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    queue.current = queue.current.then(async () => {
      if (!alive.current) return;
      try {
        const additions = await Promise.all(files.map(async (file) => ({ id: crypto.randomUUID(), src: await read(file), layout: "right" as const })));
        if (!alive.current) return;
        save(appendFigures(questionFigures(latest.current.question), additions));
        setError("");
        // Let the parent commit before the next queued paste reads its latest figures.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
    }).finally(() => { if (alive.current) setLoading(false); });
  };
  const patch = (id: string, value: Partial<QuestionFigure>) => save(figures.map((figure) => figure.id === id ? { ...figure, ...value } : figure));
  const move = (index: number, delta: number) => {
    const next = figures.slice();
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    save(next);
  };
  return <div className="space-y-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); load([...event.dataTransfer.files]); }} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); load(files); } }}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="mr-auto text-[13px] font-semibold">题图{figures.length ? ` · ${figures.length}` : ""}</h3>{question.sourceImage && <Button size="sm" variant="ghost" disabled={loading || figures.length >= 8} onClick={() => { try { save(appendFigures(figures, [{ id: crypto.randomUUID(), src: question.sourceImage!, layout: "right" }])); } catch (error) { setError(String(error)); } }}>使用原图</Button>}<Button size="sm" variant="outline" icon={<ImagePlus size={14} />} onClick={() => input.current?.click()}>{loading ? "导入中…" : "添加图片"}</Button></div>
    <input ref={input} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={event => { load([...(event.target.files || [])]); event.target.value = ""; }} />
    {figures.map((figure, index) => <div key={figure.id} className="rounded-xl border border-line p-3" data-editor-figure={figure.id}>
      <div className="flex items-start gap-3"><img src={figure.src} alt={figure.caption || `题图 ${index + 1}`} className="h-24 w-28 rounded bg-white object-contain" /><div className="min-w-0 flex-1 space-y-2">
        <div className="flex min-w-0 items-center gap-2"><Select aria-label={`题图 ${index + 1} 排列`} value={figure.layout} onValueChange={layout => patch(figure.id, { layout })} options={[{ value: "right", label: "右侧绕排" }, { value: "half", label: "并排半宽" }, { value: "full", label: "居中通栏" }]} /><IconButton label={`上移题图 ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></IconButton><IconButton label={`下移题图 ${index + 1}`} disabled={index === figures.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></IconButton><IconButton label={`删除题图 ${index + 1}`} onClick={() => save(figures.filter(item => item.id !== figure.id))}><Trash2 size={14} /></IconButton></div>
        <input aria-label={`题图 ${index + 1} 图注`} placeholder="图注" className={inputCls} value={figure.caption || ""} onChange={event => patch(figure.id, { caption: event.target.value })} />
        <div className="flex flex-wrap gap-3 text-[12px] text-muted"><label className="flex items-center gap-2">宽度<input aria-label={`题图 ${index + 1} 宽度`} type="number" min={15} max={100} value={figure.width ?? (figure.layout === "full" ? 75 : figure.layout === "half" ? 48 : 35)} onChange={event => patch(figure.id, { width: Math.max(15, Math.min(100, Number(event.target.value) || 35)) })} className="w-14 rounded border border-line bg-transparent px-2 py-1" />%</label><label className="flex items-center gap-2">限高<input aria-label={`题图 ${index + 1} 限高`} type="number" min={50} max={800} value={figure.maxHeight ?? 220} onChange={event => patch(figure.id, { maxHeight: Math.max(50, Math.min(800, Number(event.target.value) || 220)) })} className="w-16 rounded border border-line bg-transparent px-2 py-1" />px</label></div>
      </div></div>
    </div>)}
    {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
  </div>;
}
