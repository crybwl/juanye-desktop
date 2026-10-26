import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Crosshair, Play, RotateCcw, Sparkles, Square, Undo2 } from 'lucide-react';
import type { Exam } from '../types';
import { Button } from '../ui';
import { DIFFICULTY_LABELS } from '../exam-analysis';
import { MathText } from '../math';
import { drawingSegments } from '../drawing';
import { Checkbox } from './Checkbox';
import { Select } from './Select';
import { DEFAULT_EXAM_AI_CONFIG, examContextHash, examReportKey, examSnapshotFingerprint, invertMetadataPatches, planExamAnalysis, previewMetadataPatches, reportMetadataProposals, type ApplyExamMetadata, type ExamAiConfig, type ExamAiReport, type ExamMetadataPatch } from '../exam-ai';
import './exam-ai.css';

const ANSWER_LABELS = {consistent:'文本核查暂未见冲突',suspect:'答案疑点待复核',not_checked:'答案未核实'};
const KIND_LABELS = {answer:'答案核查',ambiguity:'条件与表述',coverage:'知识点覆盖',difficulty:'难度估计',other:'其他建议'};
// Math rendering is trusted=false; generated drawing blocks must never reach TikzDrawing.
function ReviewText({text}:{text:string}) { return <MathText text={drawingSegments(text).map(segment=>segment.kind==='text'?segment.text:'[绘图代码未执行]').join('')}/>; }

export function ExamAiPanel({ exam, onLocate, onApplyMetadata }: {exam:Exam;onLocate?:(id:string)=>void;onApplyMetadata?:ApplyExamMetadata}) {
  const [config,setConfig] = useState<ExamAiConfig>({...DEFAULT_EXAM_AI_CONFIG});
  const [reports,setReports]=useState<ExamAiReport[]>([]),[selectedId,setSelectedId]=useState('');
  const [model,setModel]=useState<{model:string;hasKey:boolean}|null>(null);
  const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [undo,setUndo]=useState<{patches:ExamMetadataPatch[];expectedFingerprint:string}|null>(null);
  const activeTask=useRef('');
  const key=examReportKey(exam), fingerprint=useMemo(()=>{try{return examSnapshotFingerprint(exam);}catch{return '';}},[exam]);
  const contextHash=useMemo(()=>{try{return examContextHash(config);}catch{return '';}},[config]);
  const planning=useMemo(()=>{try{return {plan:planExamAnalysis(exam,config),error:''};}catch(error){return {plan:null,error:error instanceof Error?error.message:String(error)};}},[exam,config]);
  const report=reports.find(item=>item.id===selectedId)??reports[0];
  const stale=!!report&&(report.fingerprint!==fingerprint||report.contextHash!==contextHash);
  const proposals=useMemo(()=>report?reportMetadataProposals(report,exam):[],[report,exam]);
  const numbers=useMemo(()=>new Map(exam.sections.flatMap(section=>section.questions).map((question,index)=>[question.id,index+1])),[exam]);
  useEffect(()=>{
    let live=true;
    setReports([]);setSelectedId('');setError('');setUndo(null);
    window.juanye?.loadExamReports(key).then(items=>{if(live)setReports(items);}).catch(error=>{if(live)setError(String(error));});
    window.juanye?.getModel().then(value=>{if(live)setModel(value);}).catch(()=>{if(live)setModel(null);});
    return()=>{live=false;const taskId=activeTask.current;activeTask.current='';if(taskId)void window.juanye?.cancelExamAnalysis(taskId).catch(()=>{});};
  },[key]);
  useEffect(()=>{setSelected(new Set(proposals.map(proposal=>proposal.id)));},[report?.id]); // Review selection is intentionally stable while the exam changes.
  useEffect(()=>{setConfirm(false);},[fingerprint,config]);
  const setField=<K extends keyof ExamAiConfig>(name:K,value:ExamAiConfig[K])=>setConfig(previous=>({...previous,[name]:value}));
  const cancel=()=>{const taskId=activeTask.current;activeTask.current='';setBusy(false);setNotice('整卷分析已取消。');if(taskId)void window.juanye?.cancelExamAnalysis(taskId).catch(error=>setError(String(error)));};
  const run=async()=>{
    const plan=planning.plan,bridge=window.juanye;
    if(!plan||!bridge||plan.exceedsBudget||!plan.questionCount)return;
    const taskId=`exam-${crypto.randomUUID()}`;activeTask.current=taskId;setBusy(true);setConfirm(false);setError('');setNotice('');
    try {
      const result=await bridge.analyzeExam({taskId,exam,config:plan.config,expectedFingerprint:plan.fingerprint,examKey:key});
      if(activeTask.current!==taskId)return;
      setReports(previous=>[result,...previous].slice(0,30));setSelectedId(result.id);
      setNotice(`报告已在本机保存；实际请求 ${result.requestCount} 次，复用 ${result.cacheHits} 个未变化题组。`);
    }catch(error){if(activeTask.current===taskId)setError(error instanceof Error?error.message:String(error));}
    finally{if(activeTask.current===taskId){activeTask.current='';setBusy(false);}}
  };
  const apply=()=>{
    if(!report||stale||!onApplyMetadata)return;
    const patches=proposals.filter(patch=>selected.has(patch.id));if(!patches.length)return;
    const reverse=invertMetadataPatches(exam,patches),expected=examSnapshotFingerprint(exam);
    if(expected!==report.fingerprint){setError('试卷已变化，请重新分析后应用建议。');return;}
    if(onApplyMetadata(patches,expected)===false){setError('应用时试卷已变化，未修改任何题目。');return;}
    setUndo({patches:reverse,expectedFingerprint:examSnapshotFingerprint(previewMetadataPatches(exam,patches))});
    setNotice(`已应用 ${patches.length} 道题的元数据建议；题干、答案、原题解析未更改。`);
  };
  const undoApply=()=>{
    if(!undo||!onApplyMetadata)return;
    if(fingerprint!==undo.expectedFingerprint){setError('应用后试卷已有其他修改，无法安全撤销；请使用编辑器历史记录。');return;}
    if(onApplyMetadata(undo.patches,undo.expectedFingerprint)===false){setError('撤销时快照已变化，未修改题目。');return;}
    setUndo(null);setNotice('已撤销本次元数据应用。');
  };
  const locate=(id:string)=>{if(numbers.has(id))onLocate?.(id);};
  return <div className="exam-ai-panel">
    <section className="exam-ai-card">
      <div className="exam-ai-heading"><Sparkles size={17}/><h3>整卷 AI 评估</h3><span className="exam-ai-muted">使用已保存模型：{model?.model??'未读取'}</span></div>
      <p className="exam-ai-muted">AI 建议需核对；费用由模型服务收取。</p>
      <fieldset disabled={busy} className="exam-ai-fields">
        <label>适用年级<input value={config.grade} maxLength={2000} placeholder="如：高二；未知可留空" onChange={event=>setField('grade',event.target.value)}/></label>
        <label>课程 / 考查范围<input value={config.scope} maxLength={2000} placeholder="如：数列与导数；未知可留空" onChange={event=>setField('scope',event.target.value)}/></label>
        <label>使用目的<input value={config.purpose} maxLength={2000} placeholder="如：期中考试 / 练习讲评" onChange={event=>setField('purpose',event.target.value)}/></label>
        <label>审阅模式<Select aria-label="审阅模式" value={config.mode} disabled={busy} onValueChange={value=>setField('mode',value)} options={[{value:'quick',label:'快速筛查'},{value:'deep',label:'深入教研'}]}/></label>
        <label>最多请求次数<input type="number" min={1} max={16} value={config.maxRequests} onChange={event=>setField('maxRequests',Number(event.target.value))}/></label>
        <label>每次最多输出 tokens<input type="number" min={256} max={8192} step={256} value={config.maxOutputTokens} onChange={event=>setField('maxOutputTokens',Number(event.target.value))}/></label>
        <div className="exam-ai-check"><Checkbox aria-label="额外发送图片" checked={config.includeImages} disabled={busy} onCheckedChange={value=>setField('includeImages',value)}/><span>额外发送图片</span></div>
        {config.includeImages&&<label>最多图片数（每张 ≤ 2 MB）<input type="number" min={0} max={8} value={config.imageBudget} onChange={event=>setField('imageBudget',Number(event.target.value))}/></label>}
      </fieldset>
      <details className="exam-ai-limitations"><summary>发送内容与限制</summary><p>默认发送题干、选项、答案、已有解析与标注，不发送截图像素。启用图片后，仅发送预算内的 PNG/JPG/WebP 数据图（每张 ≤ 2 MB），需模型支持视觉输入；其余图像、SVG 与绘图均为“未检查”。</p><p>题量、分值与细目表来自本地精确统计。AI 仅做定性估计；没有学生作答数据，不生成实测难度、区分度或信度。分块审阅附带全卷结构统计，但不保证跨组完整验算。</p><p>字符数为试卷快照长度，不含提示词与重复附带的全卷统计。报告保存在本机；内容会发送至设置中的模型服务。</p></details>
      {planning.error&&<p role="alert" className="exam-ai-warning">{planning.error}</p>}
      {planning.plan&&<div className="exam-ai-budget"><span>{planning.plan.questionCount} 题</span><span>{planning.plan.charCount.toLocaleString()} 个快照字符</span><span>{planning.plan.chunkCount} 个顺序题组</span><span>{planning.plan.images.length} 张授权图片</span><span>≤ {planning.plan.maxRequests} 次请求</span><span>≤ {planning.plan.maxTotalOutputTokens.toLocaleString()} 总输出 tokens</span></div>}
      {planning.plan?.exceedsBudget&&<p role="alert" className="exam-ai-warning">题组数超过请求预算，本次不会发送。请增加请求预算或分卷处理。</p>}
      <div className="exam-ai-actions">{busy?<><span role="status">正在顺序分析题组；不会自动付费重试…</span><Button size="sm" icon={<Square size={13}/>} onClick={cancel}>取消整卷分析</Button></>:<Button size="sm" variant="primary" icon={<Play size={13}/>} disabled={!window.juanye||!model?.hasKey||!planning.plan?.questionCount||planning.plan?.exceedsBudget} onClick={()=>{setConfirm(true);setError('');}}>预览并确认发送</Button>}{!window.juanye&&<span className="exam-ai-muted">AI 分析仅在桌面版可用；本地统计仍可使用。</span>}{model&&!model.hasKey&&<span className="exam-ai-muted">请先在模型设置中保存 API Key。</span>}</div>
      {confirm&&planning.plan&&<div className="exam-ai-confirm" role="group" aria-label="确认 AI 发送预算"><strong>确认向 {model?.model} 发送此快照？</strong><p>{planning.plan.questionCount} 题 / {planning.plan.charCount.toLocaleString()} 个字符 / {planning.plan.chunkCount} 个题组 / {planning.plan.images.length} 张图。最多 {config.maxRequests} 次请求，每次最多 {config.maxOutputTokens} 输出 tokens。可能产生费用；缓存命中会减少请求。失败后必须手动重新确认，不自动重试。</p><div className="exam-ai-actions"><Button size="sm" variant="primary" onClick={()=>void run()}>确认并开始分析</Button><Button size="sm" onClick={()=>setConfirm(false)}>返回修改</Button></div></div>}
    </section>
    {error&&<p role="alert" className="exam-ai-warning"><AlertTriangle size={15}/>{error}</p>}{notice&&<p role="status" className="exam-ai-muted">{notice}</p>}
    {!!reports.length&&<div className="exam-ai-report-picker"><label>本机历史报告<Select aria-label="本机历史报告" value={report?.id??''} onValueChange={value=>{setSelectedId(value);setUndo(null);}} options={reports.map(item=>({value:item.id,label:`${new Date(item.createdAt).toLocaleString()} · ${item.model.name} · ${item.config.mode==='deep'?'深入':'快速'}`}))}/></label><span className="exam-ai-muted">快照 {report?.fingerprint.slice(0,12)} · {report?.requestCount} 次请求 / {report?.cacheHits} 个缓存</span></div>}
    {report&&<>
      {stale&&<div className="exam-ai-stale" role="status"><AlertTriangle size={16}/><div><strong>历史报告：已过期</strong><p>试卷或分析设置已改变，请重新分析后应用建议。</p>{report.contextHash!==contextHash&&<Button size="sm" icon={<RotateCcw size={12}/>} onClick={()=>setConfig({...report.config})}>恢复报告的分析设置</Button>}</div></div>}
      <section className="exam-ai-card"><div className="exam-ai-heading"><h3>AI 定性结论</h3><span className="exam-ai-muted">{new Date(report.createdAt).toLocaleString()} · {report.model.name}</span></div><div className="exam-ai-prose"><ReviewText text={report.summary}/></div>{report.recommendations.length>0&&<ul>{report.recommendations.map((item,index)=><li key={index}><ReviewText text={item}/></li>)}</ul>}</section>
      <section className="exam-ai-card"><h3>问题与证据 · {report.findings.length} 条</h3>{!report.findings.length&&<p className="exam-ai-muted">未报告具体疑点。</p>}{report.findings.map((finding,index)=><article key={index} className={`exam-ai-finding exam-ai-${finding.severity}`}><div className="exam-ai-heading"><span className="exam-ai-tag">{KIND_LABELS[finding.kind]}</span><strong><ReviewText text={finding.message}/></strong></div><div>依据：<ReviewText text={finding.evidence||'需人工复核'}/></div><div className="exam-ai-muted">建议：<ReviewText text={finding.suggestion}/></div><div className="exam-ai-actions">{finding.questionIds.map(id=><Button key={id} size="sm" icon={<Crosshair size={12}/>} disabled={!numbers.has(id)||!onLocate} onClick={()=>locate(id)}>{numbers.has(id)?`定位第 ${numbers.get(id)} 题`:'题目已移除'}</Button>)}</div></article>)}</section>
      <section className="exam-ai-card"><h3>逐题 AI 评估</h3><div className="exam-ai-table-scroll"><table className="exam-tools-table"><thead><tr><th>题号</th><th>知识点建议</th><th>估计难度</th><th>核查状态</th><th>依据 / 限制</th></tr></thead><tbody>{report.questionReviews.map(review=><tr key={review.questionId}><td><button className="exam-ai-link" disabled={!numbers.has(review.questionId)||!onLocate} onClick={()=>locate(review.questionId)}>{numbers.has(review.questionId)?`第 ${numbers.get(review.questionId)} 题`:'已移除'}</button></td><td><ReviewText text={review.knowledge.join('、')||'未判断'}/></td><td>{review.estimatedDifficulty==='not_checked'?'未判断':DIFFICULTY_LABELS[review.estimatedDifficulty]}（AI 估计）</td><td>{ANSWER_LABELS[review.answerCheck]}<br/>图像：{review.visualCheck==='checked'?'已随图审阅（待复核）':'未检查'}</td><td><ReviewText text={review.rationale}/></td></tr>)}</tbody></table></div></section>
      <section className="exam-ai-card"><div className="exam-ai-heading"><h3>选择性应用元数据建议</h3>{undo&&<Button size="sm" icon={<Undo2 size={13}/>} onClick={undoApply} disabled={fingerprint!==undo.expectedFingerprint}>撤销本次应用</Button>}</div><p className="exam-ai-muted">只修改选中的知识点 / 难度标签，可撤销本次应用。</p>{proposals.map(patch=><div key={patch.id} className="exam-ai-proposal"><Checkbox aria-label={`选择第 ${numbers.get(patch.id)} 题建议`} checked={selected.has(patch.id)} disabled={stale} onCheckedChange={value=>setSelected(previous=>{const next=new Set(previous);if(value)next.add(patch.id);else next.delete(patch.id);return next;})}/><span>第 {numbers.get(patch.id)} 题</span>{patch.knowledge&&<span>知识点 → <ReviewText text={patch.knowledge.join('、')}/></span>}{patch.difficulty&&<span>难度 → {DIFFICULTY_LABELS[patch.difficulty]}（估计）</span>}</div>)}{!proposals.length&&<p className="exam-ai-muted">没有不同于当前标签的建议。</p>}<div className="exam-ai-actions"><Button size="sm" onClick={()=>setSelected(new Set(proposals.map(patch=>patch.id)))} disabled={stale||!proposals.length}>全选建议</Button><Button size="sm" onClick={()=>setSelected(new Set())} disabled={!selected.size}>取消选择</Button><Button size="sm" variant="primary" icon={<Check size={13}/>} disabled={stale||!onApplyMetadata||!proposals.some(patch=>selected.has(patch.id))} onClick={apply}>应用选中建议</Button></div></section>
    </>}
  </div>;
}
