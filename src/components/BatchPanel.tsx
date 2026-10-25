import { useState } from "react";
import { Copy, Eraser, MoveRight, Sparkles, Trash2 } from "lucide-react";
import type { Exam, QType, Question, Layout } from "../types";
import { TYPE_META } from "../data";
import { convertQuestions, copyQuestions, defaultScore, questionTypes, removeLeadingNumber, repairQuestion, transferQuestions } from "../structure";
import { Button, Field, inputCls } from "../ui";
import { WorkspaceSheet } from "./WorkspaceSheet";
import { Select } from "./Select";
import { Checkbox } from "./Checkbox";

export function BatchPanel({ exam, selected, onSelection, onChange, onClose, paperMode = "questions" }: { exam: Exam; selected: Set<string>; onSelection: (ids: Set<string>) => void; onChange: (update: (exam: Exam) => Exam) => void; onClose: () => void; paperMode?: Layout["paperMode"] }) {
  const [score, setScore] = useState("5");
  const [type, setType] = useState<QType>("essay");
  const [target, setTarget] = useState("");
  const [difficulty, setDifficulty] = useState<Question["difficulty"]>("medium");
  const [source, setSource] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [space, setSpace] = useState<Question["answerSpace"]>("auto");
  const [paperSpace, setPaperSpace] = useState<NonNullable<Question["paperAnswerSpace"]> | "follow">("follow");
  const count = selected.size;
  const all = exam.sections.flatMap(section => section.questions.map(q => q.id));
  const targetId = exam.sections.some(section => section.id === target) ? target : exam.sections[0]?.id;
  const apply = (fn: (q: Question) => Question) => onChange(exam => ({ ...exam, sections: exam.sections.map(section => ({ ...section, questions: section.questions.map(q => selected.has(q.id) ? fn(q) : q) })) }));
  const numeric = Number(score);
  return <WorkspaceSheet title={`批量属性 · ${count} 题`} onClose={onClose} modal={false} width={348}>
    <div className="space-y-4 text-[12.5px]">
      <div className="flex items-center gap-3"><label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[12.5px]"><Checkbox aria-label="全选" checked={all.length > 0 && all.every(id => selected.has(id)) ? true : all.some(id => selected.has(id)) ? "mixed" : false} onCheckedChange={checked => onSelection(checked ? new Set(all) : new Set())} disabled={!all.length} />全选</label><Button size="sm" variant="outline" onClick={() => onSelection(new Set(all.filter(id => !selected.has(id))))} disabled={!all.length}>反选</Button><Button size="sm" variant="ghost" onClick={() => onSelection(new Set())} disabled={!count}>清空选择</Button></div>
      <div className="space-y-3 border-t border-line pt-4">
        <Field label="统一分值"><div className="flex gap-2"><input aria-label="批量统一分值" type="number" min="0" max="100" step="0.5" className={`${inputCls} min-w-0 flex-1`} value={score} onChange={event => setScore(event.target.value)} /><Button disabled={!count || !score.trim() || !Number.isFinite(numeric) || numeric < 0 || numeric > 100} onClick={() => apply(q => ({ ...q, score: numeric }))}>应用</Button></div></Field>
        <Button className="w-full" size="sm" variant="outline" disabled={!count} onClick={() => apply(q => ({ ...q, score: defaultScore(q.type) }))}>恢复题型默认分值</Button>
        <Field label="题型"><div className="flex min-w-0 gap-2"><Select aria-label="批量题型" className="min-w-0 flex-1" value={type} onValueChange={setType} options={questionTypes().map(value => ({ value, label: TYPE_META[value].label }))} /><Button disabled={!count} onClick={() => onChange(exam => convertQuestions(exam, selected, type))}>应用</Button></div></Field>
        <Field label="目标大题"><Select aria-label="批量目标大题" value={targetId ?? ""} onValueChange={setTarget} options={exam.sections.map((section, index) => ({ value: section.id, label: `${index + 1}. ${section.title}` }))} /></Field>
        <div className="grid min-w-0 grid-cols-2 gap-2"><Button className="min-w-0 px-2 text-[11.5px]" size="sm" disabled={!count || !targetId} icon={<MoveRight size={13} />} onClick={() => targetId && onChange(exam => transferQuestions(exam, selected, targetId))}>移动到此大题</Button><Button className="min-w-0 px-2 text-[11.5px]" size="sm" variant="outline" disabled={!count || !targetId} icon={<Copy size={13} />} onClick={() => targetId && onChange(exam => transferQuestions(exam, selected, targetId, true))}>复制到此大题</Button></div>
        <Button className="w-full" size="sm" variant="outline" disabled={!count} icon={<Copy size={13} />} onClick={() => onChange(exam => copyQuestions(exam, selected))}>原位复制所选题目</Button>
      </div>
      <div className="space-y-3 border-t border-line pt-4">
        <Field label="答题卡空间"><div className="flex min-w-0 gap-2"><Select aria-label="批量答题卡空间" className="min-w-0 flex-1" value={space ?? "auto"} onValueChange={setSpace} options={[{ value: "auto", label: "自动" }, { value: "quarter", label: "四分之一页" }, { value: "half", label: "半页" }, { value: "full", label: "整页" }]} /><Button disabled={!count} onClick={() => apply(q => ({ ...q, answerSpace: space }))}>应用</Button></div></Field>
        {paperMode === "integrated" && <Field label="卷内答题空间"><div className="flex min-w-0 gap-2"><Select aria-label="批量卷内答题空间" className="min-w-0 flex-1" value={paperSpace} onValueChange={setPaperSpace} options={[{ value: "follow", label: "跟随答题卡" }, { value: "auto", label: "自动紧凑" }, { value: "quarter", label: "四分之一页" }, { value: "half", label: "半页" }, { value: "full", label: "整页" }]} /><Button disabled={!count} onClick={() => apply(q => ({ ...q, paperAnswerSpace: paperSpace === "follow" ? undefined : paperSpace }))}>应用</Button></div></Field>}
        <Field label="难度"><div className="flex min-w-0 gap-2"><Select aria-label="批量难度" className="min-w-0 flex-1" value={difficulty ?? "medium"} onValueChange={setDifficulty} options={[{ value: "easy", label: "基础" }, { value: "medium", label: "中等" }, { value: "hard", label: "较难" }]} /><Button disabled={!count} onClick={() => apply(q => ({ ...q, difficulty }))}>应用</Button></div></Field>
        <Field label="来源"><div className="flex gap-2"><input aria-label="批量来源" className={`${inputCls} min-w-0 flex-1`} value={source} onChange={event => setSource(event.target.value)} /><Button disabled={!count} onClick={() => apply(q => ({ ...q, source: source.trim() }))}>应用</Button></div></Field>
        <Field label="知识点"><div className="flex gap-2"><input aria-label="批量知识点" className={`${inputCls} min-w-0 flex-1`} value={knowledge} onChange={event => setKnowledge(event.target.value)} /><Button disabled={!count} onClick={() => apply(q => ({ ...q, knowledge: [...new Set(knowledge.split(/[,，、;；\n]/).map(value => value.trim()).filter(Boolean))] }))}>应用</Button></div></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-4"><Button size="sm" variant="outline" disabled={!count} icon={<Eraser size={13} />} onClick={() => apply(q => ({ ...q, stem: removeLeadingNumber(q.stem) }))}>清除开头题号</Button><Button size="sm" variant="outline" disabled={!count} icon={<Sparkles size={13} />} onClick={() => apply(repairQuestion)}>修复 OCR / 公式</Button></div>
      <Button className="w-full" variant="danger" disabled={!count} icon={<Trash2 size={14} />} onClick={() => { if (!window.confirm(`删除选中的 ${count} 道题？`)) return; onChange(exam => ({ ...exam, sections: exam.sections.map(section => ({ ...section, questions: section.questions.filter(q => !selected.has(q.id)) })) })); onSelection(new Set()); }}>删除所选题目</Button>
      <Button className="w-full" variant="primary" onClick={onClose}>完成</Button>
    </div>
  </WorkspaceSheet>;
}
