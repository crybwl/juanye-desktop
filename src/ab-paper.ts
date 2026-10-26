import type { Exam } from "./types";

export interface OptionMapping { number: number; before: string[]; after: string[]; permutation: number[]; skipped?: string }
const letter = (index: number) => String.fromCharCode(65 + index);
export function createBPaper(original: Exam, seed: number): { exam: Exam; mappings: OptionMapping[]; seed: number } {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const exam = structuredClone(original);
  exam.title = original.title.replace(/(?:\s*[·—-]?\s*[AB]\s*卷)$/i, "").trim() + " · B卷";
  const mappings: OptionMapping[] = [];
  let number = 0;
  for (const section of exam.sections) for (const q of section.questions) {
    number++;
    if (!["single", "multi"].includes(q.type) || q.options.length < 2) continue;
    const answer = q.answer.map(value => value.trim().toUpperCase());
    let skipped: string | undefined;
    if (answer.some(value => !/^[A-Z]$/.test(value) || value.charCodeAt(0) - 65 >= q.options.length)) skipped = "答案不是有效选项字母";
    // Position-dependent choices would change meaning after reordering. Keep and report them.
    if (/以上|上述(?:选项|说法)|以下(?:选项|说法)|[A-Z](?:项|选项)|选项\s*[A-Z]|[A-Z]\s*[和与、及]\s*[A-Z]|all of|none of|both [a-z]/i.test(q.options.join("\n"))) skipped = "选项含顺序或字母引用，保留原顺序";
    const permutation = q.options.map((_, index) => index);
    if (!skipped) {
      for (let index = permutation.length - 1; index > 0; index--) {
        const next = Math.floor(random() * (index + 1));
        [permutation[index], permutation[next]] = [permutation[next], permutation[index]];
      }
      if (permutation.every((value, index) => value === index)) permutation.push(permutation.shift()!);
      const before = q.options.slice();
      q.options = permutation.map(index => before[index]);
      q.answer = answer.map(value => letter(permutation.indexOf(value.charCodeAt(0) - 65))).sort();
      // Existing explanations may mention A/B/C/D, so never silently publish them as reviewed.
      if (q.analysis) q.flag = [q.flag, "B卷选项已乱序，请核对解析中的选项字母引用"].filter(Boolean).join("；");
    }
    mappings.push({ number, before: answer, after: q.answer.slice(), permutation, ...(skipped ? { skipped } : {}) });
  }
  return { exam, mappings, seed: seed >>> 0 };
}
