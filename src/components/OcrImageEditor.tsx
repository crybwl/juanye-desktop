import { useEffect, useRef, useState } from "react";
import { Check, Crop, Loader2, RotateCcw, RotateCw, X } from "lucide-react";
import { Button, cx, Modal } from "../ui";
import { errorMessage } from "../errors";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

function imageElement(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败。"));
    image.src = source;
  });
}

export function OcrImageEditor({ image, onClose, onSave }: { image: string; onClose: () => void; onSave: (image: string) => void }) {
  const [source, setSource] = useState(image);
  const [crop, setCrop] = useState<Rect>();
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<Point>();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const point = (event: React.PointerEvent) => {
    const bounds = stage.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };
  async function transform(rotate = false) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const loaded = await imageElement(source);
      const canvas = document.createElement("canvas");
      if (rotate) {
        canvas.width = loaded.naturalHeight; canvas.height = loaded.naturalWidth;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片画布。");
        context.translate(canvas.width, 0); context.rotate(Math.PI / 2); context.drawImage(loaded, 0, 0);
      } else {
        if (!crop || crop.width < 0.01 || crop.height < 0.01) return;
        const x = Math.round(crop.x * loaded.naturalWidth), y = Math.round(crop.y * loaded.naturalHeight);
        canvas.width = Math.max(1, Math.round(crop.width * loaded.naturalWidth));
        canvas.height = Math.max(1, Math.round(crop.height * loaded.naturalHeight));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片画布。");
        context.drawImage(loaded, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      }
      if (mounted.current) { setSource(canvas.toDataURL("image/png")); setCrop(undefined); }
      canvas.width = 0; canvas.height = 0;
    } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <Modal open onClose={onClose} className="flex h-[660px] max-h-[90vh] w-[760px] max-w-full flex-col">
    <div data-ocr-image-editor className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5"><Crop size={17} className="text-accent" /><h2 className="text-[14px] font-semibold">调整图片</h2><button aria-label="关闭图片调整" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:text-fg"><X size={17} /></button></div>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void transform(true)} icon={<RotateCw size={14} />}>旋转</Button>
        <Button size="sm" variant="ghost" disabled={busy || !crop || crop.width < 0.01 || crop.height < 0.01} onClick={() => void transform()} icon={<Crop size={14} />}>裁剪选区</Button>
        <Button size="sm" variant="ghost" disabled={busy || source === image && !crop} onClick={() => { setSource(image); setCrop(undefined); }} icon={<RotateCcw size={14} />}>还原</Button>
        {busy && <Loader2 size={14} className="animate-spin text-accent" />}
      </div>
      {error && <div role="alert" className="px-5 py-2 text-[12px] text-danger">{error}</div>}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/15 p-5">
        <div ref={stage} className={cx("relative inline-flex max-h-full max-w-full select-none items-center justify-center touch-none", !busy && "cursor-crosshair")} onPointerDown={(event) => {
          if (busy || event.button !== 0) return;
          event.preventDefault(); start.current = point(event); setCrop({ ...start.current, width: 0, height: 0 }); setDrawing(true); event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event) => {
          if (!drawing || !start.current) return;
          const end = point(event), origin = start.current;
          setCrop({ x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) });
        }} onPointerUp={() => { setDrawing(false); start.current = undefined; }} onPointerCancel={() => { setDrawing(false); start.current = undefined; }}>
          <img draggable={false} src={source} alt="裁剪原图" className="block max-h-[430px] max-w-full object-contain shadow-lg" />
          {crop && <div className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}><span className="absolute inset-x-1/3 inset-y-0 border-x border-white/40" /><span className="absolute inset-y-1/3 inset-x-0 border-y border-white/40" /></div>}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || source === image && !crop} icon={<Check size={14} />} onClick={async () => {
        if (crop && crop.width >= 0.01 && crop.height >= 0.01) {
          setBusy(true);
          try {
            const loaded = await imageElement(source), canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(crop.width * loaded.naturalWidth)); canvas.height = Math.max(1, Math.round(crop.height * loaded.naturalHeight));
            const context = canvas.getContext("2d"); if (!context) throw new Error("无法创建图片画布。");
            context.drawImage(loaded, Math.round(crop.x * loaded.naturalWidth), Math.round(crop.y * loaded.naturalHeight), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
            if (mounted.current) onSave(canvas.toDataURL("image/png"));
            canvas.width = 0; canvas.height = 0;
          } catch (cause) { if (mounted.current) setError(errorMessage(cause)); }
          finally { if (mounted.current) setBusy(false); }
        } else onSave(source);
      }}>应用</Button></div>
    </div>
  </Modal>;
}
