import type { Exam, Layout } from "./types";
import { TYPE_META } from "./data";

/** A readable, self-contained Markdown paper. Printing switches never discard editable answers. */
export function exportMarkdown(exam: Exam, _layout?: Layout): string {
  const lines = [`# ${exam.title || "未命名试卷"}`, ""];
  if (exam.subtitle) lines.push(exam.subtitle, "");
  lines.push(`考试时间：${exam.duration} 分钟`, "");
  if (exam.notice.length) lines.push("## 注意事项", "", ...exam.notice.flatMap((notice, index) => [`${index + 1}）${notice}`, ""]));
  let number = 0;
  for (const [sectionIndex, section] of exam.sections.entries()) {
    if (!section.questions.length) continue;
    lines.push(`## ${["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][sectionIndex] || sectionIndex + 1}、${section.title || TYPE_META[section.type].label}`, "");
    if (section.note) lines.push(section.note, "");
    for (const q of section.questions) {
      number++;
      const { id, stem, options, answer, analysis } = q;
      const metadata: Record<string, unknown> = { questionId: id, answerParts: answer, optionParts: options };
      // Never spread unknown objects into a portable file (especially configuration or API keys).
      for (const key of ["type", "score", "source", "knowledge", "difficulty", "drawing", "figure", "figures", "sourceImage", "image", "answerSpace", "paperAnswerSpace", "pageBreakBefore", "flag", "importNumber"] as const) if (q[key] !== undefined) metadata[key] = q[key];
      lines.push(`### ${number}.（${q.score} 分）`, "", `<!-- juanye-question ${encodeURIComponent(JSON.stringify(metadata))} -->`, "", "<!-- juanye-field stem -->", "", stem, "");
      const pictures = [...q.figures || [], ...(q.figure ? [{ src: q.figure, caption: "题图" }] : [])];
      for (const [index, figure] of pictures.entries()) if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/.test(figure.src)) lines.push(`![${(figure.caption || `题图 ${index + 1}`).replace(/([\\\[\]])/g, "\\$1")}](${figure.src})`, "");
      if (options.length) lines.push("<!-- juanye-field options -->", "", ...options.flatMap((option, index) => [`${String.fromCharCode(65 + index)}. ${option}`, ""]));
      if (answer.length) lines.push("<!-- juanye-field answer -->", "", "【答案】", "", answer.join("\n\n"), "");
      if (analysis.trim()) lines.push("<!-- juanye-field analysis -->", "", "【解析】", "", analysis, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
