import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { Question } from "../types";
import { type GenerationAction, parseGeneratedQuestion } from "../generated-question";
import { MathText } from "../math";
import { Button, Modal } from "../ui";
import { DialogHeader } from "./DialogChrome";

export function GenerateQuestionDialog({ open, onClose, source, action, onApply }: { open: boolean; onClose: () => void; source: Question; action: GenerationAction; onApply: (question: Question) => void }) {
  const [result, setResult] = useState<{ source: Question; action: GenerationAction; question: Question }>();
  const draft = result?.source === source && result.action === action ? result.question : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const ownsRequest = useRef(false);
  useEffect(() => {
    generation.current++; setResult(undefined); setBusy(false); setError("");
    return () => {
      generation.current++;
      if (ownsRequest.current) { ownsRequest.current = false; void window.juanye?.cancelRecognition().catch(() => {}); }
    };
  }, [open, source, action]);
  const cancel = () => { generation.current++; ownsRequest.current = false; setBusy(false); void window.juanye?.cancelRecognition().catch(() => {}); };
  const close = () => { if (busy) cancel(); onClose(); };
  const run = async () => {
    if (!window.juanye || busy) return;
    const token = ++generation.current; ownsRequest.current = true; setBusy(true); setError(""); setResult(undefined);
    try {
      const raw = await window.juanye.generateQuestion({ action, question: source });
      if (generation.current === token) setResult({ source, action, question: parseGeneratedQuestion(raw, source, action) });
    } catch (error) { if (generation.current === token) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (generation.current === token) { ownsRequest.current = false; setBusy(false); } }
  };
  return <Modal open={open} onClose={close} className="exam-tools-dialog flex max-h-[88vh] w-[800px] max-w-full flex-col"><DialogHeader title={action === "variant" ? "生成变式题" : "补写解析"} subtitle="调用已配置的模型，可能产生服务费用；草稿核对后才写入试卷" closeLabel="关闭生成草稿" onClose={close} />
    <div className="min-h-0 overflow-auto px-5 py-4"><div className="generate-label">原题</div><div className="generate-source rounded-[8px] border border-line p-4 font-serif leading-relaxed"><MathText text={source.stem} />{source.options.map((option, index) => <div key={index} className="mt-2">{String.fromCharCode(65 + index)}. <MathText text={option} /></div>)}</div>{error && <p role="alert" className="mt-4 text-danger">{error}</p>}
    {draft && <section className="generate-draft mt-5 rounded-[8px] border p-4"><h3 className="mb-3 text-[13px] font-semibold">草稿 · 待核对</h3>{action === "variant" && <><MathText text={draft.stem} />{draft.options.map((option, index) => <p key={index} className="mt-2">{String.fromCharCode(65 + index)}. <MathText text={option} /></p>)}<h4 className="mb-2 mt-4 font-semibold">答案</h4><MathText text={draft.answer.join("；")} /></>}<h4 className="mb-2 mt-4 font-semibold">解析</h4><MathText text={draft.analysis} /></section>}</div>
    <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{busy ? <Button variant="outline" onClick={cancel}>取消生成</Button> : <Button variant="outline" disabled={!window.juanye} icon={<Sparkles size={14} />} onClick={() => void run()}>{draft ? "重新生成" : "生成草稿"}</Button>}{busy && <Loader2 size={18} className="mr-2 self-center animate-spin text-accent" />}<Button variant="primary" disabled={!draft || busy} onClick={() => draft && onApply(draft)}>{action === "variant" ? "作为新题加入" : "写入解析草稿"}</Button></footer>
  </Modal>;
}
