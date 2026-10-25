import { useEffect, useMemo, useRef, useState } from "react";
import { FileInput, Loader2, X } from "lucide-react";
import type { Exam, Question } from "../types";
import { TYPE_META } from "../data";
import { readDocumentText } from "../documents";
import { parsePaperImport, type ImportKind, type ImportPlan, type SolutionPlacement } from "../paper-import";
import { matchSolutions, type SolutionMatch } from "../import-application";
import { MathText, plain } from "../math";
import { Button, Modal, Segmented } from "../ui";
import { Checkbox } from "./Checkbox";
import { Select } from "./Select";

export type ImportCommit =
  | { kind: "questions" | "annotated"; questions: Question[] }
  | { kind: "solutions"; matches: SolutionMatch[]; selected: Set<number>; overwrite: boolean };
const titles: Record<ImportKind, string> = { questions: "导入题目文件", solutions: "导入解析文件", annotated: "导入解析版试卷" };

export function ImportDialog({ kind, exam, onClose, onCommit }: { kind: ImportKind; exam: Exam; onClose: () => void; onCommit: (value: ImportCommit) => void }) {
  const [placement, setPlacement] = useState<SolutionPlacement>("after");
  const [text, setText] = useState<string>();
  const [name, setName] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [commitError, setCommitError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const parsed = useMemo<{ plan?: ImportPlan; error?: string }>(() => {
    if (text === undefined) return {};
    try {
      const plan = parsePaperImport(text, { kind, ...(kind === "annotated" ? { placement } : {}) });
      if (/\.pdf$/i.test(name)) plan.warnings.push("PDF 文字提取：请核对公式、表格与分栏；扫描版请使用图片 OCR。");
      if (/\.docx$/i.test(name)) plan.warnings.push("请核对 Word 公式对象与图片；无法提取的公式可使用图片 OCR。");
      return { plan };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [text, kind, placement, name]);
  const plan = parsed.plan;
  const flat = useMemo(() => exam.sections.flatMap(section => section.questions), [exam]);
  const matches = useMemo(() => matchSolutions(exam, plan?.solutions ?? [], targets), [exam, plan, targets]);
  useEffect(() => {
    setTargets({}); setOverwrite(false); setCommitError("");
    const initial = kind === "solutions" ? matchSolutions(exam, plan?.solutions ?? []).filter(match => match.target && !match.reason && !match.conflicts.length).map(match => match.index) : plan?.questions.map((_, index) => index) ?? [];
    setSelected(new Set(initial));
    // A new plan resets selection; background autosave must not reset the user's matching choices.
  }, [plan, kind]);
  const choose = (index: number, value: boolean) => setSelected(previous => {
    const next = new Set(previous); value ? next.add(index) : next.delete(index); return next;
  });
  const selectedMatches = matches.filter(match => selected.has(match.index));
  const conflictCount = selectedMatches.filter(match => match.conflicts.length).length;
  const blocked = kind === "solutions" && (selectedMatches.some(match => !match.target || match.reason) || conflictCount > 0 && !overwrite);
  const count = kind === "solutions" ? selectedMatches.length : plan?.questions.filter((_, index) => selected.has(index)).length ?? 0;
  const load = async (file: File) => {
    const run = ++generation.current;
    setName(file.name); setReading(true); setReadError(""); setText(undefined); setCommitError("");
    try { const value = await readDocumentText(file); if (generation.current === run) setText(value); }
    catch (error) { if (generation.current === run) setReadError(error instanceof Error ? error.message : String(error)); }
    finally { if (generation.current === run) setReading(false); }
  };
  const commit = () => {
    if (!plan || !count || blocked) return;
    try {
      if (kind === "solutions") onCommit({ kind, matches, selected, overwrite });
      else onCommit({ kind, questions: plan.questions.filter((_, index) => selected.has(index)).map(item => item.question) });
    } catch (error) { setCommitError(error instanceof Error ? error.message : String(error)); }
  };
  return <Modal open onClose={onClose} label={titles[kind]} className="flex max-h-[88vh] w-[940px] max-w-full flex-col">
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5">
      <FileInput size={19} className="text-accent" /><h2 className="text-[15px] font-semibold">{titles[kind]}</h2>
      <button aria-label="关闭导入" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5"><X size={17} /></button>
    </div>
    <div className="space-y-3 border-b border-line px-5 py-4">
      {kind === "annotated" && <div role="group" aria-label="答案解析位置" className="flex items-center gap-4"><span className="text-[13px] text-muted">答案解析位置</span><Segmented size="sm" value={placement} onChange={setPlacement} options={[{ value: "after", label: "题后" }, { value: "end", label: "卷尾" }]} /></div>}
      <div className="flex items-center gap-3"><Button size="sm" variant="outline" disabled={reading} onClick={() => input.current?.click()} icon={reading ? <Loader2 size={14} className="animate-spin" /> : <FileInput size={14} />}>选择文件</Button><span className="min-w-0 truncate text-[12px] text-muted">{name || "TXT / Markdown / DOCX / PDF / JSON"}</span></div>
      <input ref={input} data-import-file aria-label="导入文件" type="file" accept=".txt,.md,.markdown,.docx,.pdf,.json,.juanye" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} />
      {(readError || parsed.error || commitError) && <p role="alert" className="text-[12px] text-danger">{readError || parsed.error || commitError}</p>}
      {plan?.warnings.map((warning, index) => <p key={index} role="status" className="text-[12px] text-warn">{warning}</p>)}
      {kind === "solutions" && !flat.length && <p className="text-[12px] text-warn">请先导入题目，再匹配解析。</p>}
    </div>
    <div className="min-h-[180px] flex-1 overflow-y-auto px-5 py-4">
      {!plan && !parsed.error && !readError && <div className="py-10 text-center text-[13px] text-faint">{reading ? "正在读取…" : "请选择文件"}</div>}
      {kind !== "solutions" && plan?.questions.map(({ number, question }, index) => <section key={question.id} data-import-number={number} className="mb-3 rounded-xl border border-line p-3 text-[12.5px]">
        <div className="flex items-center gap-2"><Checkbox aria-label={`导入第 ${number} 题`} checked={selected.has(index)} onCheckedChange={value => choose(index, value === true)} /><b>第 {number} 题</b><span className="text-muted">{TYPE_META[question.type].label} · {question.score} 分</span></div>
        <p className="mt-2 line-clamp-2 text-muted">{plain(question.stem)}</p>
        <details className="mt-2"><summary className="cursor-pointer text-accent">查看内容</summary><div className="mt-3 space-y-2 leading-relaxed"><MathText text={question.stem} />{question.options.map((option, i) => <div key={i}>{String.fromCharCode(65 + i)}. <MathText text={option} /></div>)}{question.answer.length > 0 && <div><b>答案：</b><MathText text={question.answer.join("；")} /></div>}{question.analysis && <div><b>解析：</b><MathText text={question.analysis} /></div>}{question.source && <p>来源：{question.source}</p>}{question.knowledge?.length ? <p>知识点：{question.knowledge.join("、")}</p> : null}{question.figures?.length ? <p>题图：{question.figures.length} 张</p> : null}</div></details>
      </section>)}
      {kind === "solutions" && matches.map(match => <section key={match.index} data-import-number={match.entry.number} className="mb-3 rounded-xl border border-line p-3 text-[12.5px]">
        <div className="flex items-center gap-2"><Checkbox aria-label={`应用第 ${match.entry.number} 题解析`} checked={selected.has(match.index)} disabled={!match.target || !!match.reason} onCheckedChange={value => choose(match.index, value === true)} /><b>原第 {match.entry.number} 题</b><span className="ml-auto text-muted">{match.targetNumber ? `当前第 ${match.targetNumber} 题` : "未匹配"}</span></div>
        <Select aria-label={`第 ${match.entry.number} 题的匹配目标`} className="mt-2 w-full" value={targets[match.index] ?? match.target?.id ?? ""} onValueChange={id => { setTargets(previous => ({ ...previous, [match.index]: id })); choose(match.index, !!id); }} options={[{ value: "", label: "不匹配" }, ...flat.map((q, i) => ({ value: q.id, label: `第 ${i + 1} 题${q.importNumber ? `（原 ${q.importNumber}）` : ""} · ${plain(q.stem).slice(0, 55) || "空题干"}` }))]} />
        {match.reason && <p className="mt-2 text-warn">{match.reason}</p>}
        {match.conflicts.length > 0 && <p className="mt-2 text-warn">已有内容与导入内容不同，需确认覆盖。</p>}
        {match.entry.answer?.length ? <div className="mt-2"><b>答案：</b><MathText text={match.entry.answer.join("；")} /></div> : null}
        {match.entry.analysis && <details className="mt-2"><summary className="cursor-pointer text-accent">查看解析</summary><div className="mt-2 leading-relaxed"><MathText text={match.entry.analysis} /></div></details>}
      </section>)}
      {plan && !(kind === "solutions" ? matches.length : plan.questions.length) && <p className="py-8 text-center text-[13px] text-faint">没有可导入的内容</p>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 py-4">
      {kind === "solutions" && <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px] text-muted"><Checkbox aria-label="允许覆盖已有内容" checked={overwrite} onCheckedChange={value => {
        const allowed = value === true; setOverwrite(allowed);
        setSelected(previous => {
          const next = new Set(previous);
          matches.filter(match => match.target && !match.reason && match.conflicts.length).forEach(match => allowed ? next.add(match.index) : next.delete(match.index));
          return next;
        });
      }} />允许覆盖已有内容</label>}
      {kind !== "solutions" && <span className="mr-auto text-[12px] text-muted">已选 {count} 道题</span>}
      <Button variant="outline" onClick={onClose}>取消</Button><Button variant="primary" disabled={reading || !count || !!blocked} onClick={commit}>{kind === "solutions" ? `应用 ${count} 道解析` : `导入 ${count} 道题`}</Button>
    </div>
  </Modal>;
}
