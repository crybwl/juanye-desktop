import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, GripVertical, Loader2, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import type { Exam, Question, Section } from "../types";
import { TYPE_META } from "../data";
import { MathText } from "../math";
import { bankBridge, BANK_DRAG_MIME, checkedBankDocument, cloneBankQuestions, filterBankEntries, type BankDocument, type BankFilters } from "../question-bank";
import { Button, Field, inputCls, useToast } from "../ui";
import { Select } from "./Select";
import { Checkbox } from "./Checkbox";
import { WorkspaceSheet } from "./WorkspaceSheet";
import "./question-bank.css";

const DIFFICULTY = { easy: "基础", medium: "中等", hard: "较难" } as const;
const empty: BankDocument = { schema: "juanye-bank/1", revision: 0, entries: [] };
export interface QuestionBankProps {
  open: boolean;
  onClose: () => void;
  exam: Exam;
  sections: Section[];
  currentQuestion?: Question | null;
  onInsert: (questions: Question[], targetSectionId: string) => void;
}

export function QuestionBankDialog(props: QuestionBankProps) {
  return props.open ? <BankPanel {...props} /> : null;
}

function BankPanel({ onClose, exam, sections, currentQuestion, onInsert }: QuestionBankProps) {
  const toast = useToast();
  const [bank, setBank] = useState(empty);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<BankFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(sections[0]?.id ?? "");
  const [page, setPage] = useState(0);
  const [undoAvailable, setUndoAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => bankBridge().bankLoad()).then(raw => { if (alive) setBank(checkedBankDocument(raw)); }).catch(error => { if (alive) setError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, []);
  const filtered = useMemo(() => filterBankEntries(bank.entries, filters), [bank.entries, filters]);
  const knowledge = useMemo(() => [...new Set(bank.entries.flatMap(entry => (entry.question.knowledge ?? []).map(tag => tag.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, "zh")), [bank.entries]);
  const sources = useMemo(() => [...new Set(bank.entries.map(entry => entry.question.source?.trim() || entry.origin.examTitle).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")), [bank.entries]);
  const selectedEntries = bank.entries.filter(entry => selected.has(entry.id));
  const targetId = sections.some(section => section.id === target) ? target : sections[0]?.id ?? "";
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 40, currentPage * 40 + 40);
  const updateFilters = (patch: Partial<BankFilters>) => { setFilters(value => ({ ...value, ...patch })); setPage(0); };
  async function task(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const save = (questions: Question[]) => task(async () => {
    const result = await bankBridge().bankSave({ questions, origin: { examTitle: exam.title } });
    setBank(checkedBankDocument(result.bank));
    toast({ title: `已保存 ${result.added} 道题`, ...(result.duplicates ? { desc: `${result.duplicates} 道已在题库，保留原记录` } : {}) });
    if (result.added) setUndoAvailable(true);
  });
  const insert = (questions: Question[]) => {
    if (!targetId || !questions.length) return;
    onInsert(cloneBankQuestions(questions), targetId);
    setSelected(new Set());
  };
  const restore = () => task(async () => {
    if (!window.confirm("恢复上次题库备份？当前记录也会另存备份，试卷不受影响。")) return;
    setBank(checkedBankDocument(await bankBridge().bankRestore()));
    setSelected(new Set()); setUndoAvailable(false);
    toast({ title: "题库备份已恢复" });
  });
  const remove = () => task(async () => {
    if (!selectedEntries.length || !window.confirm(`从题库移除 ${selectedEntries.length} 道题？试卷中的题目不会删除，可恢复上次备份。`)) return;
    setBank(checkedBankDocument(await bankBridge().bankDelete(selectedEntries.map(entry => entry.id))));
    setSelected(new Set()); setUndoAvailable(true);
    toast({ title: "已从题库移除", desc: "可恢复上次备份" });
  });

  return <WorkspaceSheet title="本地题库" onClose={onClose} modal={false} width={510} className="question-bank-sheet">
    <div className="question-bank-panel">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={busy || !currentQuestion} onClick={() => currentQuestion && void save([currentQuestion])} icon={<Plus size={13} />}>保存当前题</Button>
        <Button size="sm" variant="outline" disabled={busy || !exam.sections.some(section => section.questions.length)} onClick={() => void save(exam.sections.flatMap(section => section.questions))}>保存整卷</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore()} icon={<RotateCcw size={13} />}>{undoAvailable ? "恢复上次备份" : "恢复备份"}</Button>
      </div>
      <div className="question-bank-search"><Search size={14} aria-hidden="true" /><input aria-label="搜索题库" placeholder="搜索题干、答案或标签" className={inputCls} value={filters.query ?? ""} onChange={event => updateFilters({ query: event.target.value })} /></div>
      <div className="question-bank-filters">
        <Select aria-label="题库题型" value={filters.type ?? ""} onValueChange={type => updateFilters({ type: type as BankFilters["type"] })} options={[{ value: "", label: "全部题型" }, ...Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label }))]} />
        <Select aria-label="题库难度" value={filters.difficulty ?? ""} onValueChange={difficulty => updateFilters({ difficulty: difficulty as BankFilters["difficulty"] })} options={[{ value: "", label: "全部难度" }, ...Object.entries(DIFFICULTY).map(([value, label]) => ({ value, label })), { value: "unset", label: "未设置" }]} />
        <Select aria-label="题库知识点" value={filters.knowledge ?? ""} onValueChange={knowledge => updateFilters({ knowledge })} options={[{ value: "", label: "全部知识点" }, ...knowledge.map(value => ({ value, label: value }))]} />
        <Select aria-label="题库来源" value={filters.source ?? ""} onValueChange={source => updateFilters({ source })} options={[{ value: "", label: "全部来源" }, ...sources.map(value => ({ value, label: value }))]} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-y border-line py-3">
        <label className="flex items-center gap-1 text-[12px] text-muted"><Checkbox aria-label="全选筛选结果" disabled={busy || !filtered.length} checked={filtered.length > 0 && filtered.every(entry => selected.has(entry.id)) ? true : filtered.some(entry => selected.has(entry.id)) ? "mixed" : false} onCheckedChange={checked => setSelected(checked ? new Set(filtered.map(entry => entry.id)) : new Set())} />{filtered.length} / {bank.entries.length} 题</label>
        {selected.size > 0 && <button className="text-[12px] text-accent" onClick={() => setSelected(new Set())}>取消选择 {selected.size}</button>}
        <Button size="sm" className="ml-auto" variant="ghost" disabled={busy || !selectedEntries.length} onClick={() => void remove()} icon={<Trash2 size={13} />}>移除</Button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger">{error}</div>}
      {busy && <div role="status" className="flex items-center gap-2 py-2 text-[12px] text-muted"><Loader2 size={14} className="animate-spin" />正在处理…</div>}
      {!busy && !filtered.length && <div className="question-bank-empty"><BookOpen size={26} /><p>{bank.entries.length ? "没有符合条件的题目" : "题库暂无题目"}</p></div>}
      <div className="question-bank-list">
        {visible.map(entry => {
          const q = entry.question;
          const chosen = selected.has(entry.id);
          return <article key={entry.id} className="question-bank-card" data-bank-id={entry.id} draggable={!busy} onDragStart={event => {
            const ids = chosen ? selectedEntries.map(item => item.id) : [entry.id];
            if (ids.length > 200) { event.preventDefault(); toast({ title: "单次最多拖入 200 道题", desc: "也可以使用下方批量加入", tone: "warn" }); return; }
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(BANK_DRAG_MIME, JSON.stringify(ids));
          }}>
            <div className="question-bank-card-top"><Checkbox aria-label={`选择题库题目 ${entry.id}`} checked={chosen} onCheckedChange={checked => setSelected(value => { const next = new Set(value); if (checked) next.add(entry.id); else next.delete(entry.id); return next; })} /><span className="text-[11px] text-muted">{TYPE_META[q.type].label} · {q.score} 分{q.difficulty ? ` · ${DIFFICULTY[q.difficulty]}` : ""}{entry.version > 1 ? ` · 版本 ${entry.version}` : ""}</span><GripVertical size={14} className="ml-auto text-faint" aria-hidden="true" /></div>
            <div className="question-bank-stem"><MathText text={q.stem} placeholder="（空题干）" /></div>
            {q.figures?.[0] && <img className="question-bank-thumbnail" src={q.figures[0].src} alt={q.figures[0].caption || "题图"} />}
            <div className="question-bank-tags">{(q.knowledge ?? []).filter(Boolean).slice(0, 5).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-faint"><span className="min-w-0 flex-1 truncate" title={q.source || entry.origin.examTitle}>{q.source || entry.origin.examTitle || "未设置来源"}</span><Button size="sm" variant="ghost" disabled={busy || !targetId} icon={<Plus size={12} />} onClick={() => insert([q])}>加入</Button></div>
          </article>;
        })}
      </div>
      {pages > 1 && <div className="flex items-center justify-center gap-3"><Button size="sm" variant="ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="text-[12px] text-muted">{currentPage + 1} / {pages}</span><Button size="sm" variant="ghost" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>}
      <div className="question-bank-insert"><Field label="目标大题"><Select aria-label="题库目标大题" value={targetId} disabled={!sections.length} onValueChange={setTarget} options={sections.map((section, index) => ({ value: section.id, label: `${index + 1}. ${section.title}` }))} /></Field><Button variant="primary" className="w-full" disabled={busy || !selectedEntries.length || !targetId} onClick={() => insert(selectedEntries.map(entry => entry.question))} icon={<Check size={14} />}>加入所选 {selectedEntries.length} 道题</Button></div>
    </div>
  </WorkspaceSheet>;
}
