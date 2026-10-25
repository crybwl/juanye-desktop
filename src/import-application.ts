import type { Exam, Question } from "./types";
import type { SolutionEntry } from "./paper-import";
import { TYPE_META, uid } from "./data";

export type SolutionMatch = { index: number; entry: SolutionEntry; target?: Question; targetNumber?: number; reason?: string; conflicts: string[] };
const fields = ["answer", "analysis", "type", "score", "source", "knowledge", "difficulty", "options", "drawing", "figure", "figures", "sourceImage", "image", "answerSpace", "paperAnswerSpace", "pageBreakBefore"] as const;
const meaningful = (value: unknown) => value !== undefined && value !== null && (typeof value !== "string" || !!value.trim()) && (!Array.isArray(value) || value.length > 0 && value.some(meaningful));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function solutionPatch(entry: SolutionEntry): Partial<Question> {
  const patch: Partial<Question> = {};
  for (const field of fields) if (meaningful(entry[field])) Object.assign(patch, { [field]: entry[field] });
  return patch;
}

/** Identity from our Markdown metadata wins; otherwise use recorded source numbers, not array offsets. */
export function matchSolutions(exam: Exam, entries: SolutionEntry[], targets: Record<number, string> = {}): SolutionMatch[] {
  const flat = exam.sections.flatMap(section => section.questions);
  const sourceCounts = new Map<number, number>();
  entries.forEach(entry => sourceCounts.set(entry.number, (sourceCounts.get(entry.number) ?? 0) + 1));
  const matches = entries.map((entry, index): SolutionMatch => {
    let candidates: Question[];
    if (Object.prototype.hasOwnProperty.call(targets, index)) candidates = flat.filter(q => q.id === targets[index]);
    else if (sourceCounts.get(entry.number)! > 1) return { index, entry, conflicts: [], reason: "解析文件题号重复，请指定目标题目" };
    else {
      const withIdentity = entry as SolutionEntry & { questionId?: string; importNumber?: number };
      const byId = withIdentity.questionId ? flat.filter(q => q.id === withIdentity.questionId) : [];
      const number = withIdentity.importNumber ?? entry.number;
      candidates = byId.length ? byId : flat.filter((q, i) => (q.importNumber ?? i + 1) === number);
    }
    if (candidates.length !== 1) return { index, entry, conflicts: [], reason: candidates.length ? "当前试卷原题号重复，请指定目标题目" : "未匹配到题目" };
    const target = candidates[0];
    const patch = solutionPatch(entry);
    const conflicts = fields.filter(field => meaningful(patch[field]) && meaningful(target[field]) && !same(target[field], patch[field]));
    return { index, entry, target, targetNumber: flat.indexOf(target) + 1, conflicts: [...conflicts] };
  });
  const used = new Map<string, number>();
  for (const match of matches) if (match.target) used.set(match.target.id, (used.get(match.target.id) ?? 0) + 1);
  return matches.map(match => match.target && used.get(match.target.id)! > 1 ? { ...match, reason: "多份解析指向同一道题，请取消重复匹配" } : match);
}

/** A single immutable, undoable commit; unmatched entries can never shift subsequent answers. */
export function applySolutionMatches(exam: Exam, matches: SolutionMatch[], selected: Set<number>, overwrite = false): { exam: Exam; applied: number; issues: string[] } {
  const patches = new Map<string, Partial<Question>>();
  const issues: string[] = [];
  for (const match of matches) {
    if (!selected.has(match.index)) continue;
    if (!match.target || match.reason) { issues.push(`第 ${match.entry.number} 题：${match.reason ?? "未匹配"}`); continue; }
    if (match.conflicts.length && !overwrite) { issues.push(`第 ${match.entry.number} 题：已有内容，尚未允许覆盖`); continue; }
    const patch = solutionPatch(match.entry);
    if (Object.keys(patch).length) patches.set(match.target.id, patch);
  }
  if (!patches.size) return { exam, applied: 0, issues };
  const moved: Question[] = [];
  const sections = exam.sections.map(section => ({ ...section, questions: section.questions.flatMap(question => {
    const patch = patches.get(question.id);
    if (!patch) return [question];
    const updated = { ...question, ...patch };
    if (updated.type !== question.type) { moved.push(updated); return []; }
    return [updated];
  }) }));
  for (const question of moved) {
    let target = sections.find(section => section.type === question.type);
    if (!target) { target = { id: uid(), type: question.type, title: TYPE_META[question.type].label, note: "", questions: [] }; sections.push(target); }
    target.questions.push(question);
  }
  return { exam: { ...exam, sections }, applied: patches.size, issues };
}
