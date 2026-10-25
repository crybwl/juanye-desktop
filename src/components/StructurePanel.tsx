import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Exam, QType } from "../types";
import { TYPE_META } from "../data";
import { createSection, defaultScore, moveSection, questionTypes } from "../structure";
import { Button, Field, IconButton, Switch, inputCls } from "../ui";
import { WorkspaceSheet } from "./WorkspaceSheet";
import { Select } from "./Select";

export function StructurePanel({ exam, onChange, onClose, onSelect }: { exam: Exam; onChange: (update: (exam: Exam) => Exam) => void; onClose: () => void; onSelect: (id: string) => void }) {
  const [newType, setNewType] = useState<QType>("essay");
  const [newTitle, setNewTitle] = useState("");
  const [uniform, setUniform] = useState<Record<string, string>>({});
  return <WorkspaceSheet title="管理大题" onClose={onClose} width={420}>
    <div className="space-y-3">
      {exam.sections.map((section, index) => <section key={section.id} aria-label={`大题设置：${section.title}`} className="rounded-xl border border-line-strong p-3">
        <div className="mb-3 flex items-center gap-1">
          <span className="mr-auto text-[12px] text-muted">{index + 1} · {TYPE_META[section.type].short} · {section.questions.length} 题</span>
          <IconButton label={`上移大题${section.title}`} disabled={index === 0} onClick={() => onChange(exam => moveSection(exam, section.id, -1))}><ArrowUp size={14} /></IconButton>
          <IconButton label={`下移大题${section.title}`} disabled={index === exam.sections.length - 1} onClick={() => onChange(exam => moveSection(exam, section.id, 1))}><ArrowDown size={14} /></IconButton>
          <IconButton label={`删除大题${section.title}`} onClick={() => {
            if (!window.confirm(`删除“${section.title}”${section.questions.length ? `及其中 ${section.questions.length} 道题` : ""}？`)) return;
            onChange(exam => ({ ...exam, sections: exam.sections.filter(item => item.id !== section.id) }));
          }}><Trash2 size={14} /></IconButton>
        </div>
        <div className="space-y-3">
          <Field label="大题名称"><input aria-label={`大题名称${index + 1}`} className={inputCls} value={section.title} onChange={event => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item) }))} /></Field>
          <Field label="大题说明"><textarea aria-label={`大题说明${index + 1}`} rows={2} className={`${inputCls} h-auto resize-y py-2`} value={section.note} onChange={event => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === section.id ? { ...item, note: event.target.value } : item) }))} /></Field>
          <div className="flex items-center justify-between text-[12.5px]"><span>另起一页</span><Switch label={`${section.title}另起一页`} checked={Boolean(section.pageBreakBefore)} onChange={value => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === section.id ? { ...item, pageBreakBefore: value } : item) }))} /></div>
          <div className="flex gap-2">
            <input aria-label={`${section.title}统一分值`} type="number" min="0" max="100" step="0.5" className={`${inputCls} min-w-0 flex-1`} value={uniform[section.id] ?? String(defaultScore(section.type))} onChange={event => { const value = event.target.value; setUniform(state => ({ ...state, [section.id]: value })); }} />
            <Button size="sm" className="h-9" disabled={!section.questions.length || !Number.isFinite(Number(uniform[section.id] ?? defaultScore(section.type))) || Number(uniform[section.id] ?? defaultScore(section.type)) < 0 || Number(uniform[section.id] ?? defaultScore(section.type)) > 100} onClick={() => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === section.id ? { ...item, questions: item.questions.map(q => ({ ...q, score: Number(uniform[section.id] ?? defaultScore(section.type)) })) } : item) }))}>统一分值</Button>
            <Button size="sm" className="h-9" variant="outline" onClick={() => { onSelect(section.id); onClose(); }}>定位</Button>
          </div>
        </div>
      </section>)}
      <div className="rounded-xl border border-line-strong p-3">
        <div className="mb-3 text-[13px] font-medium">新增大题</div>
        <div className="space-y-2">
          <Select aria-label="新增大题题型" value={newType} onValueChange={setNewType} options={questionTypes().map(type => ({ value: type, label: TYPE_META[type].label }))} />
          <input aria-label="新增大题名称" className={inputCls} value={newTitle} placeholder={TYPE_META[newType].label} onChange={event => setNewTitle(event.target.value)} />
          <Button className="w-full" icon={<Plus size={14} />} onClick={() => { const section = createSection(newType, newTitle); onChange(exam => ({ ...exam, sections: [...exam.sections, section] })); onSelect(section.id); setNewTitle(""); }}>添加大题</Button>
        </div>
      </div>
    </div>
  </WorkspaceSheet>;
}
