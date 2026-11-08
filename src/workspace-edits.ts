import type { Exam, Question } from "./types";
import { TYPE_META, uid } from "./data";

/** Keep untouched sections and questions referentially stable for editor/preview caches. */
export function patchWorkspaceQuestion(exam: Exam, id: string, patch: Partial<Question>): Exam {
  const sourceIndex = exam.sections.findIndex(section => section.questions.some(question => question.id === id));
  if (sourceIndex < 0) return exam;
  const source = exam.sections[sourceIndex];
  const questionIndex = source.questions.findIndex(question => question.id === id);
  const original = source.questions[questionIndex];
  if ((Object.keys(patch) as (keyof Question)[]).every(key => Object.is(original[key], patch[key]))) return exam;
  const updated = { ...original, ...patch };
  const sections = [...exam.sections];
  if (!patch.type || patch.type === original.type) {
    const questions = [...source.questions];
    questions[questionIndex] = updated;
    sections[sourceIndex] = { ...source, questions };
  } else {
    sections[sourceIndex] = { ...source, questions: source.questions.filter(question => question.id !== id) };
    const targetIndex = sections.findIndex(section => section.type === updated.type);
    if (targetIndex < 0) sections.push({ id: uid(), type: updated.type, title: TYPE_META[updated.type].label, note: "", questions: [updated] });
    else sections[targetIndex] = { ...sections[targetIndex], questions: [...sections[targetIndex].questions, updated] };
  }
  return { ...exam, sections };
}

/** 选题篮“按题型自动归入”：放进同题型的第一个大题，没有则按题型新建大题。 */
export const AUTO_SECTION = "__auto__";
export function distributeByType(exam: Exam, questions: Question[]): Exam {
  const sections = [...exam.sections];
  for (const question of questions) {
    const index = sections.findIndex(section => section.type === question.type);
    if (index < 0) sections.push({ id: uid(), type: question.type, title: TYPE_META[question.type].label, note: "", questions: [question] });
    else sections[index] = { ...sections[index], questions: [...sections[index].questions, question] };
  }
  return { ...exam, sections };
}
