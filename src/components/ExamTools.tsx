import { useMemo, useState } from "react";
import { BarChart3, Download, Shuffle, X } from "lucide-react";
import type { Exam } from "../types";
import { TYPE_META } from "../data";
import { analyzeExam, analysisCsv, DIFFICULTY_LABELS, formatPoints } from "../exam-analysis";
import { createBPaper } from "../ab-paper";
import { Button, Modal, useToast } from "../ui";
import { saveText } from "../storage";
import "./exam-tools.css";

export function ExamAnalysisDialog({ open, onClose, exam }: { open: boolean; onClose: () => void; exam: Exam }) {
  const report = useMemo(() => analyzeExam(exam), [exam]);
  const toast = useToast();
  return <Modal open={open} onClose={onClose} className="exam-tools-dialog flex max-h-[88vh] w-[1060px] max-w-full flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-4"><BarChart3 size={18} className="text-accent" /><h2 className="text-[15px] font-semibold">试卷分析与双向细目表</h2><span className="text-[12px] text-muted">{report.count} 题 · {formatPoints(report.totalScore)} 分</span><Button className="ml-auto" size="sm" icon={<Download size={14} />} onClick={async () => { try { if (await saveText(`${exam.title}_细目表`, analysisCsv(exam), "csv")) toast({ title: "细目表已导出" }); } catch (error) { toast({ title: "导出失败", desc: String(error), tone: "warn" }); } }}>导出 CSV</Button><button aria-label="关闭试卷分析" onClick={onClose}><X size={18} /></button></header>
    <div className="exam-tools-scroll min-h-0 overflow-auto p-6">
      <div className="grid grid-cols-2 gap-6">{[["题型", report.byType], ["难度", report.byDifficulty]].map(([label, entries]) => <section key={String(label)}><h3 className="mb-2 font-semibold">{String(label)}分布</h3><table className="exam-tools-table"><thead><tr><th>{String(label)}</th><th>题数</th><th>分值</th><th>占比</th></tr></thead><tbody>{(entries as typeof report.byType).map(row => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{formatPoints(row.score)}</td><td>{formatPoints(row.percent)}%</td></tr>)}</tbody></table></section>)}</div>
      <h3 className="mb-2 mt-6 font-semibold">双向细目表 <span className="ml-2 text-[11px] font-normal text-muted">多知识点分值均分</span></h3>
      <table className="exam-tools-table"><thead><tr><th>知识点</th>{report.types.map(type => <th key={type}>{TYPE_META[type].label}</th>)}<th>分值</th><th>占比</th></tr></thead><tbody>{report.matrix.map(row => <tr key={row.name}><th>{row.name}</th>{report.types.map(type => <td key={type}>{row.cells[type].numbers.length ? <>{row.cells[type].numbers.join("、")} 题 <span className="text-muted">/ {formatPoints(row.cells[type].score)} 分</span></> : "—"}</td>)}<td>{formatPoints(row.score)}</td><td>{formatPoints(row.percent)}%</td></tr>)}</tbody></table>
      <h3 className="mb-2 mt-6 font-semibold">逐题细目</h3><table className="exam-tools-table"><thead><tr><th>题号</th><th>题型</th><th>分值</th><th>知识点</th><th>难度</th><th>来源</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.id}><td>{row.number}</td><td>{TYPE_META[row.type].label}</td><td>{row.score}</td><td>{row.knowledge.join("、") || "未设置"}</td><td>{DIFFICULTY_LABELS[row.difficulty]}</td><td>{row.source}</td></tr>)}</tbody></table>
    </div>
  </Modal>;
}

export function AbPaperDialog({ open, onClose, exam, onApply }: { open: boolean; onClose: () => void; exam: Exam; onApply: (exam: Exam) => void }) {
  const [seed, setSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const generated = useMemo(() => createBPaper(exam, seed), [exam, seed]);
  return <Modal open={open} onClose={onClose} className="exam-tools-dialog flex max-h-[85vh] w-[720px] max-w-full flex-col">
    <header className="flex items-center gap-3 border-b border-line p-5"><Shuffle size={18} className="text-accent" /><h2 className="font-semibold">生成 B 卷</h2><button className="ml-auto" aria-label="关闭AB卷" onClick={onClose}><X size={18} /></button></header>
    <div className="exam-tools-scroll min-h-0 overflow-auto p-5"><p className="mb-4 text-[12px] text-muted">原卷会保留在历史记录。答案与答题卡随选项同步；解析中的字母引用需要核对。</p><table className="exam-tools-table"><thead><tr><th>题号</th><th>A卷答案</th><th>B卷答案</th><th>处理</th></tr></thead><tbody>{generated.mappings.map(row => <tr key={row.number}><td>{row.number}</td><td>{row.before.join("、") || "未设置"}</td><td>{row.after.join("、") || "未设置"}</td><td>{row.skipped || "已乱序"}</td></tr>)}</tbody></table>{!generated.mappings.length && <p className="py-6 text-center text-muted">当前没有可乱序的选择题</p>}</div>
    <footer className="flex justify-end gap-2 border-t border-line p-4"><Button variant="outline" onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0])}>重新乱序</Button><Button disabled={!generated.mappings.some(row => !row.skipped)} variant="primary" onClick={() => { onApply(generated.exam); onClose(); }}>生成并使用 B 卷</Button></footer>
  </Modal>;
}
