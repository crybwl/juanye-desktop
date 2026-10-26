import { useState } from "react";
import { BookOpen, Check, FileCode2, FileDown, FileText, Loader2 } from "lucide-react";
import type { Exam, Layout, PreviewView } from "../types";
import { PAPER_MM } from "../data";
import { Button, Field, Modal, cx, inputCls } from "../ui";
import { DialogHeader } from "./DialogChrome";
import { PrintSummary } from "./PrintSummary";
import "./workspace-tools.css";

export type ExportFormat = "pdf" | "docx" | "md" | "tex" | "project";
const FORMATS = [
  { id: "pdf", label: "PDF", note: "按当前分页导出", icon: FileDown },
  { id: "docx", label: "Word", note: "可编辑文字、公式与表格", icon: FileText },
  { id: "md", label: "Markdown", note: "文本与 LaTeX 公式", icon: FileText },
  { id: "tex", label: "LaTeX", note: "可继续编辑的源文件", icon: FileCode2 },
  { id: "project", label: "卷页项目", note: "保留题目、图片和排版", icon: BookOpen },
] as const;

export function ExportCenter({ exam, layout, view, onClose, onExport }: { exam: Exam; layout: Layout; view: PreviewView; onClose: () => void; onExport: (format: ExportFormat, name: string, view: PreviewView) => Promise<void> }) {
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [name, setName] = useState(exam.title);
  const [target, setTarget] = useState<PreviewView>(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = exam.sections.reduce((n, s) => n + s.questions.length, 0);
  const score = exam.sections.flatMap(s => s.questions).reduce((n, q) => n + q.score, 0);
  const selected = FORMATS.find(item => item.id === format)!;
  const [w, h] = PAPER_MM[layout.paper];
  return <Modal open onClose={() => !busy && onClose()} className="export-center flex max-h-[88vh] w-[880px] max-w-full flex-col">
    <DialogHeader title="导出" icon={<FileDown size={18} />} subtitle={`${count} 题 · ${score} 分`} onClose={() => !busy && onClose()} />
    <div className="export-center-body min-h-0 overflow-auto">
      <div className="space-y-2 p-5" role="group" aria-label="导出格式">{FORMATS.map(item => <button key={item.id} disabled={busy} aria-pressed={format === item.id} className={cx("export-format flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors", format === item.id ? "border-accent bg-accent/8" : "border-line hover:border-line-strong")} onClick={() => setFormat(item.id)}>
        <item.icon size={21} className={format === item.id ? "text-accent" : "text-muted"} /><span className="flex-1"><span className="block text-[13px] font-semibold">{item.label}</span><span className="mt-1 block text-[12px] text-muted">{item.note}</span></span>{format === item.id && <Check size={16} className="text-accent" />}
      </button>)}</div>
      <aside className="export-options space-y-5 p-5">
        <Field label="文件名"><input aria-label="导出文件名" className={inputCls} value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)} /></Field>
        {format === "pdf" && <Field label="导出内容"><div className="flex gap-2">{([['paper', '试卷'], ['card', '答题卡']] as const).map(([value, label]) => <Button key={value} size="sm" variant={target === value ? "primary" : "outline"} disabled={busy} onClick={() => setTarget(value)}>{label}</Button>)}</div></Field>}
        <PrintSummary layout={layout} />
        <div className="rounded-xl border border-line p-3 text-[12px] leading-relaxed text-muted">{format === "project" ? "项目包含题目与排版；题库和 AI 报告单独保存。" : format === "pdf" ? `${layout.orientation === "portrait" ? w : h} × ${layout.orientation === "portrait" ? h : w} mm · ${target === "card" ? "答题卡" : layout.paperMode === "integrated" ? "试题答题一体卷" : "普通试卷"}` : selected.note}</div>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </aside>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-line p-4"><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !name.trim()} icon={busy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} onClick={async () => { setBusy(true); setError(""); try { await onExport(format, name.trim(), target); onClose(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>导出 {selected.label}</Button></footer>
  </Modal>;
}
