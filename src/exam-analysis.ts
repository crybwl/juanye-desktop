import type { Exam, QType } from "./types";
import { TYPE_META } from "./data";

export const DIFFICULTY_LABELS = { easy: "基础", medium: "中等", hard: "较难", unset: "未设置" } as const;
export interface AnalysisBucket { name: string; count: number; score: number; percent: number }
export function analyzeExam(exam: Exam) {
  const questions = exam.sections.flatMap(section => section.questions);
  const totalScore = questions.reduce((sum, question) => sum + question.score, 0);
  const rows = questions.map((question, index) => ({
    number: index + 1, id: question.id, type: question.type,
    score: question.score, knowledge: [...new Set(question.knowledge?.map(value => value.trim()).filter(Boolean) ?? [])],
    difficulty: question.difficulty ?? "unset" as const, source: question.source?.trim() || "未设置",
  }));
  const bucket = (items: { name: string; score: number }[]): AnalysisBucket[] => {
    const map = new Map<string, { count: number; score: number }>();
    for (const item of items) {
      const value = map.get(item.name) ?? { count: 0, score: 0 };
      value.count++; value.score += item.score; map.set(item.name, value);
    }
    return [...map].map(([name, value]) => ({ name, ...value, percent: totalScore ? value.score / totalScore * 100 : 0 }));
  };
  const byType = bucket(rows.map(row => ({ name: TYPE_META[row.type].label, score: row.score })));
  const byDifficulty = bucket(rows.map(row => ({ name: DIFFICULTY_LABELS[row.difficulty], score: row.score })));
  const byKnowledge = bucket(rows.flatMap(row => (row.knowledge.length ? row.knowledge : ["未设置"]).map(name => ({ name, score: row.score / Math.max(1, row.knowledge.length) }))));
  const types = [...new Set(rows.map(row => row.type))];
  const matrix = byKnowledge.map(entry => ({ ...entry, cells: Object.fromEntries(types.map(type => {
    const matching = rows.filter(row => row.type === type && (row.knowledge.length ? row.knowledge : ["未设置"]).includes(entry.name));
    return [type, { numbers: matching.map(row => row.number), score: matching.reduce((sum, row) => sum + row.score / Math.max(1, row.knowledge.length), 0) }];
  })) as Record<QType, { numbers: number[]; score: number }> }));
  return { count: questions.length, totalScore, rows, byType, byDifficulty, byKnowledge, types, matrix };
}

export const formatPoints = (value: number) => Number(value.toFixed(2)).toString();
// Do not let user-entered metadata execute as an Excel formula when opened.
const csvCell = (value: unknown) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
export function analysisCsv(exam: Exam): string {
  const analysis = analyzeExam(exam);
  const lines: unknown[][] = [[exam.title, "试卷分析"], ["题量", analysis.count, "总分", formatPoints(analysis.totalScore)], [], ["题型", "题数", "分值", "分值占比"]];
  for (const row of analysis.byType) lines.push([row.name, row.count, formatPoints(row.score), `${formatPoints(row.percent)}%`]);
  lines.push([], ["难度", "题数", "分值", "分值占比"]);
  for (const row of analysis.byDifficulty) lines.push([row.name, row.count, formatPoints(row.score), `${formatPoints(row.percent)}%`]);
  lines.push([], ["双向细目表（多知识点分值均分）"], ["知识点", ...analysis.types.map(type => TYPE_META[type].label), "总分", "占比"]);
  for (const row of analysis.matrix) lines.push([row.name, ...analysis.types.map(type => row.cells[type].numbers.length ? `${row.cells[type].numbers.join('、')}题 / ${formatPoints(row.cells[type].score)}分` : "",), formatPoints(row.score), `${formatPoints(row.percent)}%`]);
  lines.push([], ["逐题细目", "题型", "分值", "知识点", "难度", "来源"]);
  for (const row of analysis.rows) lines.push([row.number, TYPE_META[row.type].label, row.score, row.knowledge.join("、") || "未设置", DIFFICULTY_LABELS[row.difficulty], row.source]);
  return "\uFEFF" + lines.map(row => row.map(csvCell).join(",")).join("\r\n");
}
