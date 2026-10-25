import type { Question, QuestionFigure } from "./types";

export const MAX_QUESTION_FIGURES = 8;
export function questionFigures(question: Question): QuestionFigure[] {
  const figures = question.figures ?? [];
  if (!question.figure || figures.some((figure) => figure.src === question.figure)) return figures;
  return [{ id: `legacy-${question.id}`, src: question.figure, layout: "right" }, ...figures];
}

export function appendFigures(current: QuestionFigure[], incoming: QuestionFigure[]): QuestionFigure[] {
  if (current.length + incoming.length > MAX_QUESTION_FIGURES) throw new Error(`每题最多 ${MAX_QUESTION_FIGURES} 张题图`);
  return [...current, ...incoming];
}

export const hasOptions = (type: Question["type"]) => type === "single" || type === "multi" || type === "judge";
export const isLongAnswer = (type: Question["type"]) => type === "essay" || type === "material" || type === "custom";
