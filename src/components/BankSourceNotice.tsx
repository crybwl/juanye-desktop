import { useEffect, useRef, useState } from "react";
import { BookOpen, GitCompareArrows } from "lucide-react";
import type { Question } from "../types";
import { bankBridge, checkedBankDocument, cloneBankEntries, latestBankEntries, type BankEntry } from "../question-bank";
import { questionFigures } from "../figures";
import { MathText } from "../math";
import { TikzDrawing } from "../TikzDrawing";
import { errorMessage } from "../errors";
import { Button, Modal } from "../ui";
import { DialogHeader } from "./DialogChrome";
import { PlotSvg } from "./Paper";

type SourceState = { key: string; latest?: BankEntry; sourcePresent: boolean; error?: string };
type Comparison = { snapshot: string; latest: BankEntry };

/** A paper owns its snapshot: a newer library revision is never applied automatically. */
export function BankSourceNotice({ question, active, onAdopt }: { question: Question; active: boolean; onAdopt: (question: Question) => void }) {
  const origin = question.bankOrigin;
  const sourceKey = origin ? JSON.stringify([question.id, origin.libraryId, origin.revisionId, origin.version]) : "";
  const snapshot = JSON.stringify(question);
  const current = useRef(question); current.current = question;
  const [source, setSource] = useState<SourceState>();
  const [comparison, setComparison] = useState<Comparison>();
  const [adoptionError, setAdoptionError] = useState("");

  useEffect(() => {
    let live = true;
    setSource(undefined); setComparison(undefined); setAdoptionError("");
    if (!active || !origin) return;
    void (async () => {
      try {
        const bank = checkedBankDocument(await bankBridge().bankLoad());
        const latest = latestBankEntries(bank.entries).find(entry => entry.libraryId === origin.libraryId);
        const sourcePresent = bank.entries.some(entry => entry.id === origin.revisionId && entry.libraryId === origin.libraryId && entry.version === origin.version);
        if (live) setSource({ key: sourceKey, latest, sourcePresent });
      } catch (error) {
        if (live) setSource({ key: sourceKey, sourcePresent: false, error: errorMessage(error) });
      }
    })();
    return () => { live = false; };
  }, [active, sourceKey]);

  useEffect(() => {
    setComparison(previous => previous && active && previous.snapshot === snapshot ? previous : undefined);
  }, [active, snapshot]);

  if (!active || !origin) return null;
  const checked = source?.key === sourceKey ? source : undefined;
  const latest = checked?.latest;
  const newer = Boolean(latest && latest.version > origin.version);
  const open = Boolean(comparison && comparison.snapshot === snapshot);
  let status = "正在检查题库版本…";
  if (checked?.error) status = "暂时无法检查题库版本";
  else if (checked && !latest) status = "本地题库中未找到来源题目";
  else if (latest) {
    if (newer) status = `题库有新版本 · v${latest.version}`;
    else if (!checked?.sourcePresent) status = latest.version < origin.version ? `来源修订已不在当前题库；题库现为 v${latest.version}，可能已恢复旧备份` : "来源修订已不在当前题库";
    else status = "已采用题库最新版本";
    if (latest.trashedAt) status += " · 来源题目在回收站";
  }

  const adopt = () => {
    if (!comparison || comparison.latest.version <= origin.version) return;
    if (JSON.stringify(current.current) !== comparison.snapshot || current.current.bankOrigin?.libraryId !== comparison.latest.libraryId) {
      setComparison(undefined); setAdoptionError("当前试题已修改，请重新比较后再采用。"); return;
    }
    try {
      onAdopt(cloneBankEntries([comparison.latest])[0]);
      setComparison(undefined); setAdoptionError("");
    } catch (error) { setAdoptionError(errorMessage(error)); }
  };

  return <>
    <div data-bank-source-notice className="mb-3 rounded-xl border border-line bg-[var(--surface-inset)] px-3 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted"><BookOpen size={13} />题库来源 v{origin.version}</span>
        <span aria-live="polite" className={newer ? "text-accent" : "text-muted"}>{status}</span>
        {latest && <Button size="sm" variant="ghost" className="ml-auto" icon={<GitCompareArrows size={13} />} onClick={() => { setAdoptionError(""); setComparison({ snapshot, latest: structuredClone(latest) }); }}>与题库比较</Button>}
      </div>
      {checked?.error && <p className="mt-1 text-danger" role="alert">{checked.error}</p>}
      {adoptionError && <p className="mt-1 text-danger" role="alert">{adoptionError}</p>}
    </div>
    <Modal open={open} onClose={() => setComparison(undefined)} label="与题库比较" className="flex max-h-[88vh] w-[1000px] max-w-full flex-col">
      <DialogHeader title="与题库比较" icon={<GitCompareArrows size={18} />} subtitle="当前试卷保留独立快照；只有手动采用才会替换题目。" onClose={() => setComparison(undefined)} />
      {comparison && <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
        <ComparisonQuestion title={`当前试卷 · 来源 v${origin.version}`} question={question} />
        <ComparisonQuestion title={`题库最新版本 · v${comparison.latest.version}`} question={comparison.latest.question} />
      </div>}
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto min-w-0 text-[12px] text-muted">{comparison && comparison.latest.version > origin.version ? "采用将替换本题完整内容，包含答案、解析、图片、分值与标签。" : "当前题库没有更高版本，不会替换本卷题目。"}</p>
        <Button variant="ghost" onClick={() => setComparison(undefined)}>保留当前试题</Button>
        {comparison && comparison.latest.version > origin.version && <Button variant="primary" disabled={comparison.snapshot !== snapshot} onClick={adopt}>采用题库新版本</Button>}
      </footer>
    </Modal>
  </>;
}

function ComparisonQuestion({ title, question }: { title: string; question: Question }) {
  const figures = questionFigures(question);
  return <section className="min-w-0 rounded-xl border border-line bg-[var(--surface-inset)] p-4 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
    <h3 className="mb-3 border-b border-line pb-2 text-[12px] font-semibold text-muted">{title} · {question.score} 分</h3>
    <MathText text={question.stem} placeholder="（空题干）" />
    {question.options.map((option, index) => <div key={index} className="mt-2 flex items-start gap-2"><span className="shrink-0 font-medium">{String.fromCharCode(65 + index)}.</span><MathText text={option} placeholder="（空选项）" /></div>)}
    {figures.map(figure => <figure key={figure.id} className="mt-3"><img src={figure.src} alt={figure.caption || "题图"} className="max-h-[280px] max-w-full rounded-lg object-contain" />{figure.caption && <figcaption className="mt-1 text-[12px] text-muted"><MathText text={figure.caption} /></figcaption>}</figure>)}
    {!figures.length && question.sourceImage && <img src={question.sourceImage} alt="题目原图" className="mt-3 max-h-[280px] max-w-full rounded-lg object-contain" />}
    {question.image === "plot" && <div className="mt-3 overflow-auto"><PlotSvg ink="var(--color-fg)" accent="var(--color-accent)" width={240} /></div>}
    {question.drawing?.trim() && <div className="mt-3 overflow-auto"><TikzDrawing code={question.drawing} /></div>}
    <h4 className="mb-1 mt-4 text-[12px] font-semibold text-muted">参考答案</h4><MathText text={question.answer.join("；")} placeholder="未设置答案" />
    <h4 className="mb-1 mt-4 text-[12px] font-semibold text-muted">解析</h4><MathText text={question.analysis} placeholder="未设置解析" />
    {(question.knowledge?.length || question.difficulty || question.source) && <p className="mt-4 border-t border-line pt-2 text-[12px] text-muted">{[question.knowledge?.join("、"), question.difficulty ? ({ easy: "基础", medium: "中等", hard: "较难" }[question.difficulty]) : "", question.source].filter(Boolean).join(" · ")}</p>}
  </section>;
}
