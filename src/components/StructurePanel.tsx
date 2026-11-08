import { useState } from "react";
import { ArrowDown, ArrowUp, LocateFixed, Plus, Trash2 } from "lucide-react";
import type { Exam, QType } from "../types";
import { CN_NUM, TYPE_META } from "../data";
import { createSection, defaultScore, moveSection, questionTypes } from "../structure";
import { Button, IconButton, Switch, inputCls } from "../ui";
import { WorkspaceSheet } from "./WorkspaceSheet";
import { Select } from "./Select";

export function StructurePanel({ exam, onChange, onClose, onSelect }: { exam: Exam; onChange: (update: (exam: Exam) => Exam) => void; onClose: () => void; onSelect: (id: string) => void }) {
  const [newType, setNewType] = useState<QType>("essay");
  const [newTitle, setNewTitle] = useState("");
  const [uniform, setUniform] = useState<Record<string, string>>({});
  const scoreOf = (id: string, type: QType) => uniform[id] ?? String(defaultScore(type));
  const validScore = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  const update = (id: string, patch: Partial<Exam["sections"][number]>) => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === id ? { ...item, ...patch } : item) }));
  return <WorkspaceSheet title="管理大题" onClose={onClose} width={420}>
    <div className="structure-list">
      {exam.sections.map((section, index) => {
        const score = scoreOf(section.id, section.type);
        return <section key={section.id} aria-label={`大题设置：${section.title}`} className="structure-section">
          <div className="structure-head">
            <span className="structure-index">{CN_NUM[index] ?? index + 1}、</span>
            <input aria-label={`大题名称${index + 1}`} className="structure-title-input" value={section.title} placeholder={TYPE_META[section.type].label} onChange={event => update(section.id, { title: event.target.value })} />
            <span className="structure-count">{TYPE_META[section.type].short} · {section.questions.length} 题</span>
            <div className="structure-actions">
              <IconButton label={`上移大题${section.title}`} disabled={index === 0} onClick={() => onChange(exam => moveSection(exam, section.id, -1))}><ArrowUp size={14} /></IconButton>
              <IconButton label={`下移大题${section.title}`} disabled={index === exam.sections.length - 1} onClick={() => onChange(exam => moveSection(exam, section.id, 1))}><ArrowDown size={14} /></IconButton>
              <IconButton label={`删除大题${section.title}`} onClick={() => {
                if (!window.confirm(`删除“${section.title}”${section.questions.length ? `及其中 ${section.questions.length} 道题` : ""}？`)) return;
                onChange(exam => ({ ...exam, sections: exam.sections.filter(item => item.id !== section.id) }));
              }}><Trash2 size={14} /></IconButton>
            </div>
          </div>
          <textarea aria-label={`大题说明${index + 1}`} rows={2} placeholder="大题说明（可选），会印在大题标题后" className="structure-note" value={section.note} onChange={event => update(section.id, { note: event.target.value })} />
          <div className="structure-meta">
            <span className="structure-score">每题<input aria-label={`${section.title}统一分值`} type="number" min="0" max="100" step="0.5" value={score} onChange={event => { const value = event.target.value; setUniform(state => ({ ...state, [section.id]: value })); }} />分</span>
            <Button size="sm" variant="ghost" disabled={!section.questions.length || !validScore(score)} onClick={() => onChange(exam => ({ ...exam, sections: exam.sections.map(item => item.id === section.id ? { ...item, questions: item.questions.map(q => ({ ...q, score: Number(score) })) } : item) }))}>统一分值</Button>
            <span className="structure-divider" aria-hidden="true" />
            <span className="text-[12px] text-muted">另起一页</span>
            <Switch label={`${section.title}另起一页`} checked={Boolean(section.pageBreakBefore)} onChange={value => update(section.id, { pageBreakBefore: value })} />
            <Button size="sm" variant="ghost" className="ml-auto" icon={<LocateFixed size={13} />} onClick={() => { onSelect(section.id); onClose(); }}>定位</Button>
          </div>
        </section>;
      })}
      <div className="structure-add">
        <div className="structure-add-label">新增大题</div>
        <div className="flex gap-2">
          <div className="w-[132px] shrink-0"><Select aria-label="新增大题题型" value={newType} onValueChange={setNewType} options={questionTypes().map(type => ({ value: type, label: TYPE_META[type].label }))} /></div>
          <input aria-label="新增大题名称" className={`${inputCls} min-w-0 flex-1`} value={newTitle} placeholder={TYPE_META[newType].label} onChange={event => setNewTitle(event.target.value)} />
        </div>
        <Button className="mt-2 w-full" variant="outline" icon={<Plus size={14} />} onClick={() => { const section = createSection(newType, newTitle); onChange(exam => ({ ...exam, sections: [...exam.sections, section] })); onSelect(section.id); setNewTitle(""); }}>添加大题</Button>
      </div>
    </div>
  </WorkspaceSheet>;
}
