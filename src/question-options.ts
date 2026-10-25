import type { Question } from "./types";
import { splitOcrOptions } from "./ocr-options";
import { normalizeOcrMath } from "./text-normalization";

const isChoice = (type: Question["type"]) => type === "single" || type === "multi";
const choiceCue = (text: string) => /正确|错误|不成立|选项|选择|选出|哪个|哪一|值为|等于|最大|最小|(?:下列|以下)[\s\S]{0,80}(?:的是|符合|成立)|则\s*[（(]|[（(][\s＿_\\]+[)）]/.test(text);
const comparable = (value: string) => normalizeOcrMath(value, true).replace(/\s+/g, "");

/** Fill the editor's option fields without losing a local edit or changing unrelated question data. */
export function fillQuestionOptions(question: Question): Question {
  const split = splitOcrOptions(question.stem);
  if (!split?.stem) {
    // Some models return structured choices but mislabel the question as an essay.
    if (!isChoice(question.type) && ["essay", "blank"].includes(question.type) && question.options.filter(option => option.trim()).length >= 4 && choiceCue(question.stem)) {
      const type = question.answer.join("").replace(/[^A-H]/g, "").length > 1 ? "multi" : "single";
      return { ...question, type };
    }
    return question;
  }
  if (!isChoice(question.type) && (!["essay", "blank"].includes(question.type) || split.options.length < 4 || !choiceCue(split.stem))) return question;
  // Empty default A/B/C/D boxes may be filled. Different non-empty local content is never overwritten.
  if (question.options.some((option, index) => option.trim() && (index >= split.options.length || comparable(option) !== comparable(split.options[index])))) return question;
  const type = isChoice(question.type) ? question.type : question.answer.join("").replace(/[^A-H]/g, "").length > 1 ? "multi" : "single";
  return {
    ...question, type, stem: split.stem,
    options: split.options.map((option, index) => question.options[index]?.trim() ? question.options[index] : normalizeOcrMath(option, true)),
  };
}
