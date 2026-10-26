import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpen, Check, FileCode2, FileDown, FileText, Loader2 } from "lucide-react";
import type { Exam, Layout, PreviewView } from "../types";
import { PAPER_MM } from "../data";
import { Button, Field, Modal, SharedPill, cx, inputCls, softSpring } from "../ui";
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
  const id=useId(),reduced=useReducedMotion();
  const count = exam.sections.reduce((n, s) => n + s.questions.length, 0);
  const score = exam.sections.flatMap(s => s.questions).reduce((n, q) => n + q.score, 0);
  const selected = FORMATS.find(item => item.id === format)!;
  const [w, h] = PAPER_MM[layout.paper];
  return <Modal open onClose={() => !busy && onClose()} className="export-center flex max-h-[88vh] w-[880px] max-w-full flex-col">
    <DialogHeader title="导出" icon={<FileDown size={19} />} subtitle={`${count} 题 · ${score} 分`} onClose={() => !busy && onClose()} />
    <div className="export-center-body min-h-0 overflow-auto">
      <div className="export-format-list p-6" role="group" aria-label="导出格式"><div className="export-section-label">文件格式<span>5 种方式</span></div>{FORMATS.map(item => <Button key={item.id} variant="ghost" disabled={busy} aria-pressed={format === item.id} className={cx("export-format",format===item.id&&"export-format-selected")} whileHover={reduced?undefined:{x:3}} whileTap={reduced?undefined:{scale:.985}} transition={reduced?{duration:0}:softSpring} onClick={() => setFormat(item.id)}>
        {format===item.id&&<SharedPill layoutId={`${id}-export-format`} transition={reduced?{duration:0}:softSpring} className="export-format-pill"/>}
        <span className="export-format-icon"><item.icon size={20}/></span><span className="export-format-copy"><span className="block text-[13px] font-semibold">{item.label}</span><span className="mt-1 block text-[12px] text-muted">{item.note}</span></span><AnimatePresence initial={false}>{format===item.id&&<motion.span aria-hidden initial={reduced?false:{opacity:0,scale:.7}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.7}} transition={reduced?{duration:0}:softSpring} className="export-format-check"><Check size={15}/></motion.span>}</AnimatePresence>
      </Button>)}</div>
      <aside className="export-options p-6">
        <div className="export-section-label">导出设置</div>
        <Field label="文件名"><input aria-label="导出文件名" className={inputCls} value={name} maxLength={100} disabled={busy} onChange={e => setName(e.target.value)} /></Field>
        <AnimatePresence mode="wait" initial={false}><motion.div key={format} className="export-format-options" initial={reduced?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={reduced?{opacity:1}:{opacity:0,y:-5}} transition={reduced?{duration:0}:{duration:.15,ease:[.2,.8,.2,1]}}>
          {format === "pdf" && <Field label="导出内容"><div className="export-target-switch">{([['paper', '试卷'], ['card', '答题卡']] as const).map(([value, label]) => <Button key={value} size="sm" variant="ghost" aria-pressed={target===value} disabled={busy} onClick={() => setTarget(value)}>{target===value&&<SharedPill layoutId={`${id}-export-target`} className="exam-analysis-tab-pill" transition={reduced?{duration:0}:softSpring}/>}<span>{label}</span></Button>)}</div></Field>}
          <PrintSummary layout={layout} />
          <div className="export-format-note">{format === "project" ? "项目包含题目与排版；题库和 AI 报告单独保存。" : format === "pdf" ? `${layout.orientation === "portrait" ? w : h} × ${layout.orientation === "portrait" ? h : w} mm · ${target === "card" ? "答题卡" : layout.paperMode === "integrated" ? "试题答题一体卷" : "普通试卷"}` : selected.note}</div>
        </motion.div></AnimatePresence>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </aside>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t border-line p-4"><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !name.trim()} icon={busy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} onClick={async () => { setBusy(true); setError(""); try { await onExport(format, name.trim(), target); onClose(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>导出 {selected.label}</Button></footer>
  </Modal>;
}
