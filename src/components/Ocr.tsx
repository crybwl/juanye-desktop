import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Crop, ImagePlus, Loader2, RefreshCw, ScanText, Trash2, X } from "lucide-react";
import type { Question } from "../types";
import { TYPE_META, uid } from "../data";
import { MathText } from "../math";
import { getOcrPreferences, parseOcrResponse } from "../ocr";
import { Button, Modal, Segmented, cx, spring, inputCls } from "../ui";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfOptions } from "../pdf";
import { errorMessage } from "../errors";
import { isOcrPasteTarget, OrderedOcrImports, pendingOcrPages, removeOcrPage } from "../ocr-queue";
import { OcrImageEditor } from "./OcrImageEditor";
import { Select } from "./Select";
import { Checkbox } from "./Checkbox";

type Page = { id: string; name: string; image: string; status: "ready" | "running" | "done" | "error"; questions: Question[]; error?: string; raw?: string };
const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("图片读取失败，请重新选择文件。"));
  reader.readAsDataURL(file);
});
const errorText = errorMessage;

async function readPages(files: File[], limit: number): Promise<Page[]> {
  const pages: Page[] = [];
  for (const file of files) {
    if (file.size > 80 * 1024 * 1024) throw new Error(`${file.name} 超过 80 MB，请压缩或拆分后导入。`);
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      const loadingTask = pdfjs.getDocument({ ...pdfOptions(), data: new Uint8Array(await file.arrayBuffer()) });
      const pdfDocument = await loadingTask.promise;
      try {
        if (pdfDocument.numPages + pages.length > limit) throw new Error(`还可添加 ${limit} 页，请拆分 PDF 后导入。`);
        for (let i = 1; i <= pdfDocument.numPages; i++) {
          const page = await pdfDocument.getPage(i);
          const original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / original.width, 2200 / original.height) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("无法创建 PDF 页面画布。");
          await page.render({ canvasContext: context, canvas, viewport }).promise;
          pages.push({ id: uid(), name: `${file.name} · 第 ${i} 页`, image: canvas.toDataURL("image/jpeg", 0.91), status: "ready", questions: [] });
          page.cleanup(); canvas.width = 0; canvas.height = 0;
        }
      } finally { await loadingTask.destroy(); }
    } else if (/^image\/(?:png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} 超过 20 MB，请压缩后导入。`);
      if (pages.length >= limit) throw new Error(`还可添加 ${limit} 页，请分批导入。`);
      pages.push({ id: uid(), name: file.name, image: await readImage(file), status: "ready", questions: [] });
    } else throw new Error(`暂不支持 ${file.name}，请选择 JPG、PNG、WEBP 或 PDF。`);
    if (pages.length > limit) throw new Error(`还可添加 ${limit} 页，请分批导入。`);
  }
  return pages;
}

export function OcrDialog({ open, onClose, onAdd, incomingPaste }: { open: boolean; onClose: () => void; onAdd: (qs: Question[]) => void; incomingPaste?: { id: string; files: File[] } }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [current, setCurrent] = useState<string>();
  const [multiple, setMultiple] = useState(getOcrPreferences().multiple);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string>();
  const [imageEditing, setImageEditing] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<Page[]>([]);
  const generation = useRef(0);
  const isOpen = useRef(open);
  const inFlight = useRef(false);
  const imports = useRef<OrderedOcrImports<Page>>();
  const consumedPaste = useRef<string>();
  const updatePages = (update: Page[] | ((items: Page[]) => Page[])) => {
    const next = typeof update === "function" ? update(pagesRef.current) : update;
    pagesRef.current = next;
    setPages(next);
  };
  if (!imports.current) imports.current = new OrderedOcrImports<Page>({
    limit: 30,
    count: () => pagesRef.current.length,
    append: (loaded) => {
      if (!isOpen.current) return;
      updatePages((items) => [...items, ...loaded]);
      setCurrent((previous) => previous || loaded[0]?.id);
    },
    onPending: (count) => setReading(count > 0),
  });

  useEffect(() => {
    isOpen.current = open;
    generation.current++;
    inFlight.current = false;
    imports.current?.reset();
    setBusy(false); setReading(false);
    if (open) { updatePages([]); setCurrent(undefined); setError(""); setPicked(new Set()); setEditing(undefined); setImageEditing(undefined); setMultiple(getOcrPreferences().multiple); }
    return () => { isOpen.current = false; generation.current++; imports.current?.reset(); };
  }, [open]);

  async function load(files: File[]) {
    if (!files.length || !isOpen.current) return [];
    const session = imports.current;
    setError("");
    try {
      const loaded = await session?.enqueue((remaining) => readPages(files, remaining));
      if (loaded?.length && files.some((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name))) setMultiple(true);
      return loaded ?? [];
    } catch (error) { if (isOpen.current) setError(errorText(error)); return []; }
  }

  useEffect(() => {
    if (!open || !incomingPaste || consumedPaste.current === incomingPaste.id) return;
    consumedPaste.current = incomingPaste.id;
    const run = generation.current;
    void load(incomingPaste.files).then(loaded => {
      if (loaded.length && isOpen.current && run === generation.current) void recognize(loaded.map(page => page.id));
    });
  }, [open, incomingPaste?.id]);

  useEffect(() => {
    if (!open) return;
    const paste = (event: ClipboardEvent) => {
      if (!isOcrPasteTarget(event.target) || document.querySelector("[data-ocr-image-editor]")) return;
      const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); void load(files); }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [open]);

  const cancel = () => {
    generation.current++; inFlight.current = false; setBusy(false);
    void window.juanye?.cancelRecognition().catch(() => {});
    updatePages((items) => items.map((page) => page.status === "running" ? { ...page, status: "ready" } : page));
  };
  const close = () => { cancel(); imports.current?.reset(); isOpen.current = false; onClose(); };
  const patch = (id: string, value: Partial<Page>) => updatePages((items) => items.map((page) => page.id === id ? { ...page, ...value } : page));
  const remove = (id: string) => {
    const page = pagesRef.current.find((item) => item.id === id);
    if (!page || page.status === "running") return;
    const items = removeOcrPage(pagesRef.current, id);
    updatePages(items);
    setCurrent((previous) => previous === id ? items[0]?.id : previous);
    const removed = new Set(page.questions.map((question) => question.id));
    setPicked((previous) => new Set([...previous].filter((questionId) => !removed.has(questionId))));
    setEditing((previous) => previous && removed.has(previous) ? undefined : previous);
    if (imageEditing === id) setImageEditing(undefined);
  };

  async function recognize(ids?: string[]) {
    if (inFlight.current) return;
    if (!window.juanye) { setError("请使用桌面应用打开此功能，浏览器预览不提供模型请求。"); return; }
    const todo = pendingOcrPages(pagesRef.current, ids);
    if (!todo.length) return;
    const run = ++generation.current;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const config = await window.juanye.getModel();
      if (run !== generation.current || !isOpen.current) return;
      if (!config.hasKey || !config.model || !config.baseUrl) throw new Error("请先在“设置 → 模型服务”填写并保存请求地址、模型名称和 API Key。");
      for (const page of todo) {
        if (run !== generation.current || !isOpen.current) break;
        if (!pagesRef.current.some((item) => item.id === page.id)) continue;
        setCurrent(page.id); patch(page.id, { status: "running", error: undefined });
        let raw: string | undefined;
        try {
          raw = await window.juanye.recognize({ image: page.image, multiple });
          if (run !== generation.current || !isOpen.current) break;
          const questions = parseOcrResponse(raw, { multiple, sourceImage: getOcrPreferences().keepImage ? page.image : undefined });
          patch(page.id, { status: "done", questions, raw });
          setPicked((previous) => new Set([...previous, ...questions.map((q) => q.id)]));
        } catch (error) {
          if (run !== generation.current || !isOpen.current) break;
          patch(page.id, { status: "error", error: errorText(error), raw, questions: [] });
        }
      }
    } catch (error) { if (run === generation.current && isOpen.current) setError(errorText(error)); }
    finally { if (run === generation.current && isOpen.current) { inFlight.current = false; setBusy(false); } }
  }

  const active = pages.find((page) => page.id === current) || pages[0];
  const questions = pages.flatMap((page) => page.questions);
  const chosen = questions.filter((q) => picked.has(q.id));
  const pending = pages.filter((page) => page.status !== "done").length;
  const imagePage = pages.find((page) => page.id === imageEditing);

  return (
    <Modal open={open} onClose={() => imageEditing ? setImageEditing(undefined) : close()} className="flex h-[680px] max-h-[90vh] w-[1020px] max-w-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent"><ScanText size={18} /></span>
        <div className="text-[14.5px] font-semibold">识别题目</div>
        <button onClick={close} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-white/[0.06] hover:text-fg" aria-label="关闭"><X size={17} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <Segmented size="sm" value={multiple ? "multiple" : "single"} onChange={(value) => { if (!busy) setMultiple(value === "multiple"); }} options={[{ value: "single", label: "单题识别" }, { value: "multiple", label: "多题识别" }]} />
        {reading && <Loader2 size={14} className="animate-spin text-accent" aria-label="正在读取文件" />}
        <Button className="ml-auto" size="sm" disabled={pages.length >= 30} onClick={() => input.current?.click()} icon={<ImagePlus size={14} />}>{pages.length ? "添加文件" : "选择文件"}</Button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.pdf" hidden multiple onChange={(event) => { const files = [...(event.target.files || [])]; event.target.value = ""; void load(files); }} />
      </div>
      {error && <div role="alert" className="border-b border-danger/20 bg-danger/10 px-6 py-3 text-[12.5px] text-danger">{error}</div>}
      <div className={cx("relative min-h-0 flex-1", over && "ring-2 ring-inset ring-accent")} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }} onDrop={(event) => { event.preventDefault(); setOver(false); void load([...event.dataTransfer.files]); }}>
        {!pages.length ? (
          <motion.div onClick={() => input.current?.click()} animate={{ scale: over ? 1.01 : 1 }} transition={spring} className={cx("m-6 flex h-[calc(100%-48px)] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong", over ? "bg-accent/10" : "bg-white/[0.015] hover:bg-white/[0.03]")}>
            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-accent/25 to-accent-2/10 text-accent">{reading ? <Loader2 size={28} className="animate-spin" /> : <ImagePlus size={28} />}</span>
            <div className="mt-5 text-[16px] font-medium">{reading ? "正在读取文件…" : "拖入图片或 PDF"}</div>
            <div className="mt-2 text-[12.5px] text-faint">Ctrl + V 粘贴 · 最多 30 页</div>
          </motion.div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[0.95fr_1.05fr]">
            <div className="flex min-h-0 flex-col border-r border-line bg-black/10">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4"><span className="text-[12px] text-muted">原图</span><Select aria-label="选择识别页面" className="min-w-0 flex-1" value={active?.id ?? ""} onValueChange={setCurrent} options={pages.map(page => ({ value: page.id, label: `${page.name} · ${({ ready: "待识别", running: "识别中", done: "已识别", error: "失败" })[page.status]}` }))} /><button aria-label="裁剪或旋转本页" title="裁剪 / 旋转" disabled={busy} onClick={() => setImageEditing(active?.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-white/10 hover:text-accent disabled:opacity-40"><Crop size={14} /></button><button aria-label="删除本页" title="删除本页" disabled={active?.status === "running"} onClick={() => active && remove(active.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-40"><Trash2 size={14} /></button></div>
              <div aria-label="识别页面队列" className="flex h-[85px] shrink-0 gap-2 overflow-x-auto border-b border-line p-2">
                {pages.map((page, index) => <div key={page.id} className={cx("group relative h-[67px] w-[54px] shrink-0 rounded-md border", active?.id === page.id ? "border-accent ring-1 ring-accent/30" : "border-line")}>
                  <button aria-label={`查看第 ${index + 1} 页`} aria-pressed={active?.id === page.id} onClick={() => setCurrent(page.id)} className="relative h-full w-full overflow-hidden rounded-md bg-white/5"><img src={page.image} alt="" className="h-full w-full object-contain" /><span className={cx("absolute inset-x-0 bottom-0 py-0.5 text-[10px]", page.status === "done" ? "bg-emerald-600/90 text-white" : page.status === "error" ? "bg-danger/90 text-white" : "bg-black/65 text-white")}>{page.status === "running" ? "识别中" : `${index + 1}${page.status === "done" ? " ✓" : page.status === "error" ? " !" : ""}`}</span></button>
                  <button aria-label={`删除第 ${index + 1} 页`} disabled={page.status === "running"} onClick={() => remove(page.id)} className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-bg text-muted shadow ring-1 ring-line hover:text-danger disabled:hidden"><X size={10} /></button>
                </div>)}
                <button aria-label="添加识别页面" disabled={pages.length >= 30} onClick={() => input.current?.click()} className="grid h-[67px] w-10 shrink-0 place-items-center rounded-md border border-dashed border-line-strong text-muted hover:text-accent disabled:opacity-40"><ImagePlus size={16} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">{active && <img src={active.image} className="h-auto w-full rounded-md object-contain shadow-lg" alt={active.name} />}</div>
              {active?.status === "error" && <div className="border-t border-danger/20 p-3"><p role="alert" className="select-text whitespace-pre-wrap break-words text-[12px] text-danger">{active.error}</p><Button size="sm" className="mt-2" disabled={busy} onClick={() => void recognize([active.id])} icon={<RefreshCw size={12} />}>重试本页</Button>{active.raw && <details className="mt-2 text-[11px] text-faint"><summary className="cursor-pointer">查看原始返回</summary><pre className="mt-1 max-h-32 select-text overflow-auto whitespace-pre-wrap break-words">{active.raw}</pre></details>}</div>}
            </div>
            <div className="min-h-0 overflow-y-auto p-5">
              {!questions.length && <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[12.5px] text-faint">{busy ? <><Loader2 className="animate-spin text-accent" size={26} />正在识别 {active?.name}</> : "待识别"}</div>}
              {pages.map((page) => page.questions.length > 0 && <div key={page.id} className="mb-5"><button className="mb-2 max-w-full truncate text-[11px] text-faint hover:text-accent" onClick={() => setCurrent(page.id)}>{page.name} · {page.questions.length} 道题</button>{page.questions.map((q) => <div key={q.id} className={cx("mb-3 rounded-xl border p-3 transition-colors", picked.has(q.id) ? "border-accent/35 bg-accent/[0.05]" : "border-line opacity-60")}>
                <div className="mb-2 flex items-center gap-2"><Checkbox aria-label="选择此题" checked={picked.has(q.id)} onCheckedChange={() => setPicked((previous) => { const next = new Set(previous); if (next.has(q.id)) next.delete(q.id); else next.add(q.id); return next; })} /><span className="text-[11.5px]" style={{ color: TYPE_META[q.type].hue }}>{TYPE_META[q.type].label} · {q.score} 分</span><button className="ml-auto text-[11.5px] text-accent" onClick={() => { setEditing(editing === q.id ? undefined : q.id); setCurrent(page.id); }}>{editing === q.id ? "完成" : "编辑"}</button></div>
                {editing === q.id ? <div className="space-y-2"><Select aria-label="题型" value={q.type} onValueChange={type => patch(page.id, { questions: page.questions.map((item) => item.id === q.id ? { ...item, type: type as Question["type"] } : item) })} options={Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))} /><textarea aria-label="识别题干" className={cx(inputCls, "h-36 py-2 font-mono text-[12px]")} value={q.stem} onChange={(event) => patch(page.id, { questions: page.questions.map((item) => item.id === q.id ? { ...item, stem: event.target.value } : item) })} />{q.options.map((option, index) => <input key={index} aria-label={`选项 ${String.fromCharCode(65 + index)}`} className={cx(inputCls, "h-8 text-[12px]")} value={option} onChange={(event) => patch(page.id, { questions: page.questions.map((item) => item.id === q.id ? { ...item, options: item.options.map((value, i) => i === index ? event.target.value : value) } : item) })} />)}</div> : <><MathText text={q.stem} className="select-text text-[12.5px] leading-relaxed" />{q.options.map((option, index) => <div key={index} className="mt-1 flex gap-1.5 text-[12px]"><span>{String.fromCharCode(65 + index)}.</span><MathText text={option} /></div>)}</>}
              </div>)}</div>)}
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-4">
        <div className="text-[12px] text-faint"><div>{pages.length ? `${pages.filter((page) => page.status === "done").length}/${pages.length} 页 · ${questions.length} 道题` : "未选择文件"}</div><div className="mt-1 text-[11px]">识别可能产生模型服务费用</div></div>
        {busy ? <Button variant="outline" className="ml-auto" onClick={cancel}>停止后续页</Button> : <Button variant="outline" className="ml-auto" disabled={!pending || reading} onClick={() => void recognize()} icon={<ScanText size={14} />}>{questions.length ? `继续识别 ${pending} 页` : "开始识别"}</Button>}
        <Button variant="primary" disabled={busy || reading || !chosen.length} onClick={() => { onAdd(chosen); close(); }}>添加 {chosen.length} 道题到试卷</Button>
      </div>
      {imagePage && <OcrImageEditor image={imagePage.image} onClose={() => setImageEditing(undefined)} onSave={(image) => {
        if (imagePage.questions.length && !window.confirm("更改原图将清除本页识别结果，继续？")) return;
        const removed = new Set(imagePage.questions.map((question) => question.id));
        setPicked((previous) => new Set([...previous].filter((id) => !removed.has(id))));
        setEditing((previous) => previous && removed.has(previous) ? undefined : previous);
        patch(imagePage.id, { image, status: "ready", questions: [], raw: undefined, error: undefined });
        setImageEditing(undefined);
      }} />}
    </Modal>
  );
}
