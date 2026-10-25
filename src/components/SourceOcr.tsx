import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Question } from "../types";
import { parseOcrResponse } from "../ocr";
import { MathText } from "../math";
import { Button, Modal } from "../ui";
import { errorMessage } from "../errors";

export function SourceOcr({ question, onChange }: { question: Question; onChange: (patch: Partial<Question>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Question>();
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (inFlight.current) void window.juanye?.cancelRecognition().catch(() => {}); }; }, []);
  const recognize = async () => {
    if (inFlight.current || !question.sourceImage) return;
    if (!window.confirm("重新识别这道题？模型服务可能产生费用，现有内容会保留到确认替换。")) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!window.juanye) throw new Error("请使用桌面应用");
      const raw = await window.juanye.recognize({ image: question.sourceImage, multiple: false });
      if (mounted.current) setResult(parseOcrResponse(raw, { multiple: false })[0]);
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <>
    <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" disabled={busy} onClick={() => void recognize()} icon={<RefreshCw size={13} className={busy ? "animate-spin" : undefined} />}>{busy ? "识别中…" : "重新识别"}</Button></div>
    <img src={question.sourceImage} alt="OCR 原图" className="max-h-[400px] w-full rounded-lg bg-white object-contain" />
    {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    <Modal open={Boolean(result)} onClose={() => setResult(undefined)} className="w-[820px] max-w-full p-5">
      <h2 className="mb-4 text-[15px] font-semibold">识别核对</h2>
      <div className="grid max-h-[60vh] grid-cols-2 gap-4 overflow-y-auto text-[13px] leading-relaxed">
        {[question, result].map((item, index) => <section key={index} className="min-w-0 rounded-xl border border-line p-4"><h3 className="mb-3 text-muted">{index ? "新结果" : "当前内容"}</h3>{item && <><MathText text={item.stem} />{item.options.map((option, i) => <div key={i} className="mt-1"><span>{String.fromCharCode(65 + i)}. </span><MathText text={option} /></div>)}</>}</section>)}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setResult(undefined)}>保留当前内容</Button><Button variant="primary" disabled={!result} onClick={() => {
        if (!result) return;
        const wasChoice = question.type === "single" || question.type === "multi";
        const recognizedChoice = result.options.length > 0 && (result.type === "single" || result.type === "multi");
        onChange({
          ...(!wasChoice && recognizedChoice ? { type: result.type } : {}),
          stem: result.stem, options: result.options.length ? result.options : question.options,
          answer: result.answer.length ? result.answer : question.answer, analysis: result.analysis || question.analysis,
        });
        setResult(undefined);
      }}>应用识别结果</Button></div>
    </Modal>
  </>;
}
