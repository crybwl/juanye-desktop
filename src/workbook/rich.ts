/**
 * 富文本采用 ProseMirror JSON 子集：编辑时交给 Tiptap，静态时由 RichView 直接渲染，
 * 两边共用同一套 CSS，点击进入编辑不跳动。
 */
export interface RichMark { type: "bold" | "italic" | "underline" | "strike" | "dots" | "textStyle"; attrs?: { color?: string | null } }
export interface RichNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: RichMark[];
  content?: RichNode[];
}
export interface RichDoc { type: "doc"; content: RichNode[] }

export const emptyRich = (): RichDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/** 把 `$...$` 文本拆成文字与行内公式；`___` 视为空白填空。用于示例与题库题目导入。 */
export function inlineFromPlain(src: string): RichNode[] {
  const out: RichNode[] = [];
  const pattern = /\$([^$]+)\$|_{3,}/g;
  let last = 0;
  for (let match: RegExpExecArray | null; (match = pattern.exec(src));) {
    if (match.index > last) out.push({ type: "text", text: src.slice(last, match.index) });
    out.push(match[1] !== undefined ? { type: "inlineMath", attrs: { latex: match[1].trim() } } : { type: "blank", attrs: { answer: "" } });
    last = match.index + match[0].length;
  }
  if (last < src.length) out.push({ type: "text", text: src.slice(last) });
  return out;
}

export function richFromPlain(src: string): RichDoc {
  const paragraphs = src.split(/\n/);
  return { type: "doc", content: paragraphs.map(line => {
    const content = inlineFromPlain(line);
    return content.length ? { type: "paragraph", content } : { type: "paragraph" };
  }) };
}

/** 可读纯文本：公式保留 `$latex$`，填空写成答案或下划线。 */
export function richToPlain(doc: RichDoc | RichNode, blanks: "answer" | "line" = "line"): string {
  const walk = (node: RichNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "inlineMath") return `$${String(node.attrs?.latex ?? "")}$`;
    if (node.type === "blank") return blanks === "answer" ? String(node.attrs?.answer ?? "") : "____";
    if (node.type === "hardBreak") return "\n";
    const inner = (node.content ?? []).map(walk);
    return node.type === "doc" || node.type === "bulletList" || node.type === "orderedList" ? inner.join("\n") : inner.join("");
  };
  return walk(doc);
}

export function isRichEmpty(doc: RichDoc | undefined): boolean {
  if (!doc?.content?.length) return true;
  const visit = (node: RichNode): boolean => {
    if (node.type === "text") return !(node.text ?? "").trim();
    if (node.type === "inlineMath" || node.type === "blank") return false;
    return (node.content ?? []).every(visit);
  };
  return doc.content.every(visit);
}

/** 统计挖空数量（填空题答题卡、题号提示）。 */
export function countBlanks(doc: RichDoc): number {
  let count = 0;
  const visit = (node: RichNode) => { if (node.type === "blank") count++; node.content?.forEach(visit); };
  doc.content.forEach(visit);
  return count;
}

/** 合并两个段落文档：用于 Backspace 合并上一段。 */
export function concatRich(a: RichDoc, b: RichDoc): RichDoc {
  const head = a.content.slice(0, -1), tail = a.content[a.content.length - 1], first = b.content[0];
  if (!tail || !first || tail.type !== "paragraph" || first.type !== "paragraph") return { type: "doc", content: [...a.content, ...b.content] };
  return { type: "doc", content: [...head, { ...tail, content: [...(tail.content ?? []), ...(first.content ?? [])] }, ...b.content.slice(1)] };
}

export function sanitizeRich(value: unknown): RichDoc {
  if (!value || typeof value !== "object" || (value as RichDoc).type !== "doc" || !Array.isArray((value as RichDoc).content)) return emptyRich();
  const doc = value as RichDoc;
  return doc.content.length ? doc : emptyRich();
}
