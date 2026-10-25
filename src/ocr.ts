import type { QType, Question } from "./types";
import { uid } from "./data";
import { normalizeOcrMath, removeAnswerPlaceholders } from "./text-normalization";
import { splitOcrOptions, stripOcrOptionLabel } from "./ocr-options";
import { fillQuestionOptions } from "./question-options";

export interface OcrPreferences { multiple: boolean; keepImage: boolean }
const PREF_KEY = "juanye.ocr.preferences.v1";
export function getOcrPreferences(): OcrPreferences {
  try { return { multiple: false, keepImage: true, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; }
  catch { return { multiple: false, keepImage: true }; }
}
export function saveOcrPreferences(value: OcrPreferences) { localStorage.setItem(PREF_KEY, JSON.stringify(value)); }

function normalizeLists(text: string): string {
  const counters: number[] = [];
  let looseCounter = 0;
  return text.replace(/\$?\\(begin|end)\{enumerate\}\$?|\$?\\item\$?[ \t]*/g, (_, command?: string) => {
    if (command === "begin") { counters.push(0); return "\n"; }
    if (command === "end") { counters.pop(); return "\n"; }
    const index = counters.length ? ++counters[counters.length - 1] : ++looseCounter;
    return `\n(${index}) `;
  });
}

/** Only normalizes transport/markup. Never invents mathematical content or answers. */
export function cleanOcrText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return normalizeLists(String(value)
    .replace(/^\s*```(?:latex|tex|markdown|md|html)?\s*\n?/i, "").replace(/\n?```\s*$/, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<\/?(?:html|body|div|p|span|h[1-6]|ol|ul|li|table|thead|tbody|tr|td|th|em|strong|b|i|u|br|code|pre|img|a|sup|sub)(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, math: string) => `\\[${math.trim()}\\]`)
    .replace(/\\\\(?=(?:frac|sqrt|sin|cos|tan|cot|sec|csc|ln|log|pi|sigma|alpha|beta|theta|omega|infty|overline|vec|mathbb|begin|end|item|leq?|geq?|times|cdot|in|notin|perp|parallel|triangle)\b)/g, "\\"))
    .replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function optionsFrom(value: unknown): string[] {
  if (typeof value === "string") return splitOcrOptions(cleanOcrText(value))?.options ?? [];
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === "string") {
      const split = splitOcrOptions(cleanOcrText(value[0]));
      if (split) return split.options;
    }
    const options = value.map((entry) => {
      const item = asRecord(entry);
      return stripOcrOptionLabel(cleanOcrText(item ? item.text ?? item.content ?? item.value : entry));
    });
    return options.some(Boolean) ? options : [];
  }
  const obj = asRecord(value);
  if (!obj) return [];
  const options = Object.keys(obj).sort().map(key => stripOcrOptionLabel(cleanOcrText(obj[key])));
  return options.some(Boolean) ? options : [];
}
function normalizeType(value: unknown, options: string[], answer: string[]): QType {
  const label = String(value || "").toLowerCase();
  if (/multi|多选|多项/.test(label)) return "multi";
  if (/single|单选|单项/.test(label)) return "single";
  if (/judge|truefalse|true.false|判断/.test(label)) return "judge";
  if (/material|材料/.test(label)) return "material";
  if (/custom|自定义/.test(label)) return "custom";
  if (/blank|fill|填空/.test(label)) return "blank";
  if (/essay|subjective|解答|证明|计算|简答/.test(label)) return "essay";
  if (options.length) return answer.join("").replace(/[^A-H]/g, "").length > 1 ? "multi" : "single";
  return "essay";
}
function parseOne(raw: unknown, image?: string): Question | null {
  const obj = asRecord(raw);
  let stem = cleanOcrText(obj ? obj.stem ?? obj.text ?? obj.content ?? obj.question ?? obj.expression : raw);
  if (!stem) return null;
  if (/^[\[{]/.test(stem)) {
    try { const nested = JSON.parse(stem); if (asRecord(nested)) return parseOne(nested, image); } catch { /* handled as invalid text below */ }
    if (/^\s*\{\s*"(?:text|stem|expression|questions)"\s*:/.test(stem)) throw new Error("模型返回的 JSON 不完整，请重试本页；原始结果已保留。");
  }
  let options = optionsFrom(obj?.options);
  if (!options.length) options = optionsFrom(obj?.choices);
  const answerValue = obj?.answer ?? obj?.answers;
  const answer = (Array.isArray(answerValue) ? answerValue : answerValue == null || answerValue === "" ? [] : [answerValue]).map(cleanOcrText).filter(Boolean);
  const suppliedType = obj?.type ?? obj?.questionType;
  // An untyped plain-text response with explicit choices is itself a choice question.
  const type = normalizeType(suppliedType, options.length ? options : suppliedType ? [] : splitOcrOptions(stem)?.options ?? [], answer);
  const rawScore = Number(obj?.score ?? obj?.points);
  const score = Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 1000 ? rawScore : ({ single: 5, multi: 6, judge: 2, blank: 5, essay: 12, material: 15, custom: 5 })[type];
  const filled = fillQuestionOptions({
    id: uid(), type, score, stem, options: options.map(option => normalizeOcrMath(option, true)),
    answer,
    analysis: cleanOcrText(obj?.analysis ?? obj?.analyze ?? obj?.explanation),
    ...(image ? { sourceImage: image } : {}),
  });
  return {
    ...filled,
    stem: removeAnswerPlaceholders(normalizeOcrMath(filled.stem.replace(/^\s*(?:#{1,3}\s*)?\d{1,3}[.、．](?!\d)\s*/, ""))),
    answer: filled.type === "single" || filled.type === "multi" ? answer.flatMap((a) => /^[A-H\s,，、]+$/.test(a) ? a.match(/[A-H]/g) || [] : [a]) : answer,
  };
}

export function parseOcrResponse(response: string, config: { multiple: boolean; sourceImage?: string }): Question[] {
  let text = response.trim().replace(/^```(?:json|html|latex|tex|markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  if (!text) throw new Error("模型返回为空，请重试。");
  let data: unknown;
  try { data = JSON.parse(text); }
  catch {
    const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { data = JSON.parse(text.slice(start, end + 1)); } catch { /* plain text handled below */ }
    }
    if (data === undefined && /^\s*[\[{]/.test(text)) throw new Error("模型返回的结构不完整，请重试本页；不会把 JSON 原文导入题干。");
  }
  let items: unknown[];
  if (data !== undefined) {
    const record = asRecord(data);
    const nested = asRecord(record?.data);
    const list = record?.questions ?? record?.items ?? nested?.questions ?? (Array.isArray(record?.data) ? record?.data : undefined);
    items = Array.isArray(data) ? data : Array.isArray(list) ? list : [record?.question && typeof record.question === "object" ? record.question : data];
  } else {
    text = cleanOcrText(text);
    if (!text) throw new Error("识别结果没有可导入的题目文本。");
    const beginnings = [...text.matchAll(/^(?:#{1,3}\s*)?\s*(\d{1,3})[.、．](?!\d)\s*\S/gm)];
    const sequential = beginnings.length > 1 && beginnings.every((m, i) => !i || Number(m[1]) === Number(beginnings[i - 1][1]) + 1);
    items = config.multiple && sequential
      ? beginnings.map((match, i) => text.slice(match.index!, beginnings[i + 1]?.index ?? text.length).trim())
      : [text];
  }
  const questions = items.map((item) => parseOne(item, config.sourceImage)).filter((q): q is Question => q !== null);
  if (!questions.length) throw new Error("没有识别到题目。请检查图片清晰度或调整识别范围后重试。");
  if (!config.multiple && questions.length > 1) throw new Error("模型返回了多道题。请打开“多题识别”后重试，避免把小问错误拆开。");
  return questions;
}
