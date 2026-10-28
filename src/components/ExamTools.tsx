import { useId, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BarChart3, Crosshair, Download, Grid2X2, ListOrdered, Shuffle, Sparkles } from "lucide-react";
import type { Exam } from "../types";
import { TYPE_META } from "../data";
import { analyzeExam, analysisCsv, DIFFICULTY_LABELS, formatPoints } from "../exam-analysis";
import { createBPaper } from "../ab-paper";
import { Button, Modal, SharedPill, softSpring, useToast } from "../ui";
import { saveText } from "../storage";
import { knowledgeDifficultyMatrix, type ApplyExamMetadata, type ExamAiReport } from "../exam-ai";
import { ExamAiPanel } from "./ExamAiPanel";
import type { ExamAiSession } from "../exam-ai-session";
import { DialogHeader } from "./DialogChrome";
import "./exam-tools.css";

const ANALYSIS_TABS = [{id:"overview",label:"本地统计",icon:BarChart3},{id:"ai",label:"AI 评估",icon:Sparkles},{id:"matrix",label:"双向细目表",icon:Grid2X2},{id:"detail",label:"逐题细目",icon:ListOrdered}] as const;
type DistributionRow = { name: string; count: number; score: number; percent: number };
function Distribution({title,rows}:{title:string;rows:DistributionRow[]}) {
  const reduced=useReducedMotion();
  return <section className="exam-distribution"><div className="exam-section-title"><h3>{title}分布</h3><span>按分值占比</span></div><div className="exam-distribution-bars">{rows.map((row,index)=><div className="exam-distribution-row" key={row.name}><div><span>{row.name}</span><span className="text-muted">{row.count} 题 · {formatPoints(row.score)} 分 <b>{formatPoints(row.percent)}%</b></span></div><div className="exam-distribution-track"><motion.span initial={reduced?false:{width:0}} animate={{width:`${Math.min(100,Math.max(0,row.percent))}%`}} transition={reduced?{duration:0}:{...softSpring,delay:index*.035}}/></div></div>)}</div><details className="exam-secondary-details"><summary>查看精确数据</summary><table className="exam-tools-table"><thead><tr><th>{title}</th><th>题数</th><th>分值</th><th>占比</th></tr></thead><tbody>{rows.map(row=><tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{formatPoints(row.score)}</td><td>{formatPoints(row.percent)}%</td></tr>)}</tbody></table></details></section>;
}

export function ExamAnalysisDialog({ open, onClose, exam, session, initialTab = "overview", onLocate, onApplyMetadata, onReportAvailable }: { open: boolean; onClose: () => void; exam: Exam; session: ExamAiSession; initialTab?: "overview" | "ai"; onLocate?: (id: string) => void; onApplyMetadata?: ApplyExamMetadata; onReportAvailable?: (report: ExamAiReport) => void }) {
  const report = useMemo(() => analyzeExam(exam), [exam]);
  const difficultyMatrix = useMemo(() => knowledgeDifficultyMatrix(exam), [exam]);
  const [tab, setTab] = useState<"overview" | "ai" | "matrix" | "detail">(initialTab);
  const [matrixMode, setMatrixMode] = useState<"type" | "difficulty">("type");
  const [direction,setDirection]=useState(1);
  const id=useId(),reduced=useReducedMotion();
  const selectTab=(next:typeof tab)=>{setDirection(ANALYSIS_TABS.findIndex(item=>item.id===next)>=ANALYSIS_TABS.findIndex(item=>item.id===tab)?1:-1);setTab(next);};
  const toast = useToast();
  const questions = exam.sections.flatMap(section => section.questions);
  const missingKnowledge = report.rows.filter(row => !row.knowledge.length);
  const missingDifficulty = report.rows.filter(row => row.difficulty === "unset");
  const locate = (id: string) => { onLocate?.(id); };
  return <Modal open={open} onClose={onClose} className="exam-tools-dialog flex max-h-[88vh] w-[1060px] max-w-full flex-col">
    <DialogHeader title="试卷分析与双向细目表" closeLabel="关闭试卷分析" icon={<BarChart3 size={19}/>} subtitle={`${report.count} 题 · ${formatPoints(report.totalScore)} 分`} onClose={onClose} actions={<Button size="sm" icon={<Download size={14} />} onClick={async () => { try { if (await saveText(`${exam.title}_细目表`, analysisCsv(exam), "csv")) toast({ title: "细目表已导出" }); } catch (error) { toast({ title: "导出失败", desc: String(error), tone: "warn" }); } }}>导出 CSV</Button>}/>
    <nav className="exam-analysis-tabs" role="tablist" aria-label="试卷分析视图" onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const index=ANALYSIS_TABS.findIndex(item=>item.id===tab),next=event.key==="Home"?0:event.key==="End"?ANALYSIS_TABS.length-1:(index+(event.key==="ArrowRight"?1:-1)+ANALYSIS_TABS.length)%ANALYSIS_TABS.length;selectTab(ANALYSIS_TABS[next].id);event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();}}>{ANALYSIS_TABS.map(item=><Button key={item.id} id={`${id}-${item.id}`} size="sm" role="tab" tabIndex={tab===item.id?0:-1} aria-controls={`${id}-panel`} aria-selected={tab===item.id} variant="ghost" className="exam-analysis-tab" onClick={()=>selectTab(item.id)}>{tab===item.id&&<SharedPill layoutId={`${id}-analysis-pill`} transition={reduced?{duration:0}:softSpring} className="exam-analysis-tab-pill"/>}<item.icon size={14}/><span>{item.label}</span></Button>)}</nav>
    <div id={`${id}-panel`} className="exam-tools-scroll min-h-0 overflow-auto p-6" role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      {/* Keep active tasks, review selection and undo state alive when switching views. */}
      <motion.div hidden={tab !== "ai"} initial={false} animate={tab==="ai"?{opacity:1,x:0}:{opacity:0,x:reduced?0:direction*12}} transition={reduced?{duration:0}:softSpring}><ExamAiPanel exam={exam} session={session} onBackgroundStart={onClose} onLocate={onLocate} onApplyMetadata={onApplyMetadata} onReportAvailable={onReportAvailable} /></motion.div>
      <AnimatePresence mode="wait" initial={false} custom={direction}>{tab!=="ai"&&<motion.div key={tab} custom={direction} variants={{enter:(d:number)=>({opacity:0,x:reduced?0:d*14}),center:{opacity:1,x:0},exit:(d:number)=>({opacity:0,x:reduced?0:d*-10})}} initial="enter" animate="center" exit="exit" transition={reduced?{duration:0}:{duration:.16,ease:[.2,.8,.2,1]}}>
      {tab === "overview" && <>
      <div className="exam-analysis-stats"><div className="exam-analysis-stat"><span>精确总分</span><strong>{formatPoints(report.totalScore)} <small className="text-[12px]">分</small></strong></div><div className="exam-analysis-stat"><span>题量 / 题型</span><strong>{report.count} <small className="text-[12px]">题 · {report.byType.length} 类</small></strong></div><div className="exam-analysis-stat"><span>已标知识点</span><strong>{report.count-missingKnowledge.length} <small className="text-[12px]">/ {report.count} 题</small></strong></div><div className="exam-analysis-stat"><span>已标难度</span><strong>{report.count-missingDifficulty.length} <small className="text-[12px]">/ {report.count} 题</small></strong></div></div>
      <p className="mb-4 text-[12px] text-muted">以下为当前试卷与已有标签的本地精确统计，不调用模型。难度标签不是实测难度系数；AI 定性估计在独立页面展示。</p>
      <div className="exam-distributions"><Distribution title="题型" rows={report.byType}/><Distribution title="难度" rows={report.byDifficulty}/></div>
      <h3 className="mb-2 mt-6 font-semibold">知识点分值 <span className="ml-2 text-[11px] font-normal text-muted">多知识点分值均分；题数允许重复计入</span></h3><table className="exam-tools-table"><thead><tr><th>知识点</th><th>涉及题数</th><th>分摊分值</th><th>分值占比</th></tr></thead><tbody>{report.byKnowledge.map(row=><tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{formatPoints(row.score)}</td><td>{formatPoints(row.percent)}%</td></tr>)}</tbody></table>
      <section className="mt-5 space-y-2 text-[12px] text-muted">{[{label:"未标知识点",rows:missingKnowledge},{label:"未标难度",rows:missingDifficulty},{label:"未填写答案（不代表题目有误）",rows:questions.filter(question=>!question.answer.some(value=>value.trim())).map(question=>({id:question.id}))}].filter(item=>item.rows.length).map(item=><div className="flex items-center gap-3 rounded-lg border border-line p-3" key={item.label}><span>{item.rows.length} 道题{item.label}</span>{onLocate&&<Button size="sm" variant="ghost" icon={<Crosshair size={13}/>} onClick={()=>locate(item.rows[0].id)}>定位第一题</Button>}</div>)}</section>
      </>}
      {tab === "matrix" && <>
      <div className="exam-matrix-heading"><span className="text-[12px] text-muted">本地标签细目表；多知识点分值均分，不使用 AI 未应用的建议。</span><div className="exam-matrix-switch">{([['type','知识点 × 题型'],['difficulty','知识点 × 难度']] as const).map(([value,label])=><Button key={value} size="sm" variant="ghost" aria-pressed={matrixMode===value} onClick={()=>setMatrixMode(value)}>{matrixMode===value&&<SharedPill layoutId={`${id}-matrix-pill`} transition={reduced?{duration:0}:softSpring} className="exam-analysis-tab-pill"/>}<span>{label}</span></Button>)}</div></div>
      <motion.div key={matrixMode} initial={reduced?false:{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={reduced?{duration:0}:softSpring} className="exam-table-scroll">
      {matrixMode === "type" && <>
      <h3 className="mb-2 mt-6 font-semibold">双向细目表 <span className="ml-2 text-[11px] font-normal text-muted">多知识点分值均分</span></h3>
      <table className="exam-tools-table"><thead><tr><th>知识点</th>{report.types.map(type => <th key={type}>{TYPE_META[type].label}</th>)}<th>分值</th><th>占比</th></tr></thead><tbody>{report.matrix.map(row => <tr key={row.name}><th>{row.name}</th>{report.types.map(type => <td key={type}>{row.cells[type].numbers.length ? <>{row.cells[type].numbers.join("、")} 题 <span className="text-muted">/ {formatPoints(row.cells[type].score)} 分</span></> : "—"}</td>)}<td>{formatPoints(row.score)}</td><td>{formatPoints(row.percent)}%</td></tr>)}</tbody></table>
      </>}
      {matrixMode === "difficulty" && <table className="exam-tools-table"><thead><tr><th>知识点</th>{difficultyMatrix.keys.map(key=><th key={key}>{DIFFICULTY_LABELS[key]}</th>)}<th>分值</th><th>占比</th></tr></thead><tbody>{difficultyMatrix.rows.map(row=><tr key={row.name}><th>{row.name}</th>{difficultyMatrix.keys.map(key=><td key={key}>{row.cells[key].numbers.length?<>{row.cells[key].numbers.join("、")} 题 <span className="text-muted">/ {formatPoints(row.cells[key].score)} 分</span></>:"—"}</td>)}<td>{formatPoints(row.score)}</td><td>{formatPoints(report.totalScore?row.score/report.totalScore*100:0)}%</td></tr>)}</tbody></table>}
      </motion.div>
      </>}
      {tab === "detail" && <>
      <h3 className="mb-2 mt-6 font-semibold">逐题细目</h3><table className="exam-tools-table"><thead><tr><th>题号</th><th>题型</th><th>分值</th><th>知识点</th><th>难度</th><th>来源</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.id}><td>{row.number}</td><td>{TYPE_META[row.type].label}</td><td>{row.score}</td><td>{row.knowledge.join("、") || "未设置"}</td><td>{DIFFICULTY_LABELS[row.difficulty]}</td><td>{row.source}</td></tr>)}</tbody></table>
      </>}
    </motion.div>}</AnimatePresence></div>
  </Modal>;
}

export function AbPaperDialog({ open, onClose, exam, onApply }: { open: boolean; onClose: () => void; exam: Exam; onApply: (exam: Exam) => void }) {
  const [seed, setSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const generated = useMemo(() => createBPaper(exam, seed), [exam, seed]);
  return <Modal open={open} onClose={onClose} className="exam-tools-dialog flex max-h-[85vh] w-[720px] max-w-full flex-col">
    <DialogHeader title="生成 B 卷" closeLabel="关闭AB卷" icon={<Shuffle size={19}/>} subtitle="保留原卷，随机调整选择题选项" onClose={onClose}/>
    <div className="exam-tools-scroll min-h-0 overflow-auto p-5"><p className="mb-4 text-[12px] text-muted">原卷会保留在历史记录。答案与答题卡随选项同步；解析中的字母引用需要核对。</p><table className="exam-tools-table"><thead><tr><th>题号</th><th>A卷答案</th><th>B卷答案</th><th>处理</th></tr></thead><tbody>{generated.mappings.map(row => <tr key={row.number}><td>{row.number}</td><td>{row.before.join("、") || "未设置"}</td><td>{row.after.join("、") || "未设置"}</td><td>{row.skipped || "已乱序"}</td></tr>)}</tbody></table>{!generated.mappings.length && <p className="py-6 text-center text-muted">当前没有可乱序的选择题</p>}</div>
    <footer className="flex justify-end gap-2 border-t border-line p-4"><Button variant="outline" onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0])}>重新乱序</Button><Button disabled={!generated.mappings.some(row => !row.skipped)} variant="primary" onClick={() => { onApply(generated.exam); onClose(); }}>生成并使用 B 卷</Button></footer>
  </Modal>;
}
