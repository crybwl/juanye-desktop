import { TYPE_META, uid } from "./data";
import { normalizeMathDelimiters } from "./math";
import type { Exam, QType, Question, Section } from "./types";
import { normalizeOcrMath, removeAnswerPlaceholders } from "./text-normalization";

export const questionTypes = () => Object.keys(TYPE_META) as QType[];
export const defaultScore = (type: QType): number => ({ single: 5, multi: 6, judge: 2, blank: 5, essay: 12, material: 15, custom: 5 }[type] ?? 5);
export const isOptionType = (type: QType) => ["single", "multi", "judge"].includes(type);
export const defaultOptions = (type: QType) => String(type) === "judge" ? ["正确", "错误"] : isOptionType(type) ? ["", "", "", ""] : [];

export function changeQuestionType(q: Question, type: QType): Question {
  if (q.type === type) return q;
  return { ...q, type, options: type === "judge" ? defaultOptions(type) : isOptionType(type) && !isOptionType(q.type) ? defaultOptions(type) : q.options };
}

export function createSection(type: QType, title = TYPE_META[type].label): Section {
  return { id: uid(), type, title: title.trim() || TYPE_META[type].label, note: "", questions: [] };
}

export function moveSection(exam: Exam, id: string, direction: number): Exam {
  const index = exam.sections.findIndex(section => section.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= exam.sections.length) return exam;
  const sections = [...exam.sections];
  [sections[index], sections[target]] = [sections[target], sections[index]];
  return { ...exam, sections };
}

/** Copy/move in paper order; same-section move is a no-op rather than reordering. */
export function transferQuestions(exam: Exam, ids: Set<string>, targetId: string, copy = false): Exam {
  const target = exam.sections.find(section => section.id === targetId);
  if (!target || !ids.size) return exam;
  const incoming = exam.sections.flatMap(section => section.questions
    .filter(q => ids.has(q.id) && (copy || section.id !== targetId))
    .map(q => changeQuestionType(copy ? { ...structuredClone(q), id: uid() } : q, target.type)));
  if (!incoming.length) return exam;
  const moving = new Set(incoming.map(q => q.id));
  return { ...exam, sections: exam.sections.map(section => ({ ...section,
    questions: section.id === targetId ? [...section.questions, ...incoming] : copy ? section.questions : section.questions.filter(q => !moving.has(q.id)),
  })) };
}

export function copyQuestions(exam: Exam, ids: Set<string>): Exam {
  if (!ids.size) return exam;
  return { ...exam, sections: exam.sections.map(section => ({ ...section,
    questions: section.questions.flatMap(q => ids.has(q.id) ? [q, { ...structuredClone(q), id: uid() }] : [q]),
  })) };
}

/** Remove only a top-level question number; never strip (1), (2) subquestions. */
export function removeLeadingNumber(stem: string): string {
  return stem.replace(/^\s*(?:第\s*\d{1,3}\s*题[、.．:：]?|\d{1,3}\s*[.．、](?!\d)|\d{1,3}\s*[)）](?!\s*\d))\s*/, "");
}

export function repairOcrText(text: string): string {
  const repaired = text.replace(/&#(?:x20|32);/gi, " ").replace(/&nbsp;/gi, " ")
    .replace(/\\{2,}(?=(?:frac|dfrac|tfrac|sqrt|sin|cos|tan|sec|csc|cot|log|ln|alpha|beta|gamma|theta|sigma|omega|pi|leq?|geq?|neq|infty|times|cdot|overline|vec|triangle|begin|end)\b)/g, "\\")
    .replace(/\/{2,}(?=(?:frac|dfrac|sqrt|sin|cos|tan|theta|pi|leq?|geq?)\b)/g, "\\");
  return normalizeOcrMath(normalizeMathDelimiters(repaired));
}

export function repairQuestion(q: Question): Question {
  return { ...q, stem: removeAnswerPlaceholders(repairOcrText(q.stem)), options: q.options.map(option => normalizeOcrMath(repairOcrText(option), true)), answer: q.answer.map(repairOcrText), analysis: repairOcrText(q.analysis) };
}

export function convertQuestions(exam: Exam, ids: Set<string>, type: QType): Exam {
  const changing = exam.sections.flatMap(s => s.questions).filter(q => ids.has(q.id) && q.type !== type);
  if (!changing.length) return exam;
  const changingIds = new Set(changing.map(q => q.id));
  const sections = exam.sections.map(s => ({ ...s, questions: s.questions.filter(q => !changingIds.has(q.id)) }));
  let target = sections.find(s => s.type === type);
  if (!target) { target = createSection(type); sections.push(target); }
  target.questions = [...target.questions, ...changing.map(q => changeQuestionType(q, type))];
  return { ...exam, sections };
}
