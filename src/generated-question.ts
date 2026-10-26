import type { Question } from "./types";
import { parseOcrResponse } from "./ocr";
import { uid } from "./data";

export type GenerationAction = "variant" | "analysis";
export function parseGeneratedQuestion(response: string, source: Question, action: GenerationAction): Question {
  const parsed = parseOcrResponse(response, { multiple: true });
  if (parsed.length !== 1) throw new Error("模型必须返回一道完整题目，请重新生成");
  const question = parsed[0];
  if (!question.analysis.trim()) throw new Error("模型没有返回完整解析，请重新生成");
  const flag = [source.flag, `待核对 · AI${action === "variant" ? "生成变式题" : "补写解析"}`].filter(Boolean).join("；");
  if (action === "analysis") return { ...structuredClone(source), analysis: question.analysis, flag };
  if (question.type !== source.type) throw new Error("模型返回题型与原题不符，请重新生成");
  if (question.stem === source.stem && JSON.stringify(question.options) === JSON.stringify(source.options)) throw new Error("模型返回的是原题，没有生成变式");
  if (["single", "multi"].includes(question.type) && (question.options.length < 2 || !question.answer.length || question.answer.some(value => !/^[A-Z]$/.test(value) || value.charCodeAt(0) - 65 >= question.options.length))) throw new Error("生成题目的选项或答案不完整，请重新生成");
  if (question.type === "single" && question.answer.length !== 1) throw new Error("单选变式必须只有一个正确答案，请重新生成");
  if (!question.answer.some(value => value.trim())) throw new Error("变式缺少参考答案，请重新生成");
  if (new Set(question.answer).size !== question.answer.length) throw new Error("生成答案有重复项，请重新生成");
  if (["single", "multi"].includes(question.type) && (question.options.some(value => !value.trim()) || new Set(question.options.map(value => value.replace(/\s+/g, ""))).size !== question.options.length)) throw new Error("生成选项为空或重复，请重新生成");
  return { ...question, id: uid(), score: source.score, source: source.source, knowledge: source.knowledge?.slice(), difficulty: source.difficulty, flag };
}
