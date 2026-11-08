import { memo, type CSSProperties, type ReactNode } from "react";
import { formulaHtml, inlineAnswerHtml } from "./formula";
import "./editing-base.css";
import type { RichDoc, RichMark, RichNode } from "./rich";

/** 与 Tiptap 节点视图共用：静态与编辑态 DOM 结构一致。 */
export function mathNodeHtml(latex: string, display = false): string {
  return latex.trim() ? formulaHtml(latex, display) : '<span class="wb-math-empty">公式</span>';
}
export function blankNodeHtml(answer: string): string {
  return `<span class="wb-blank-answer">${answer.trim() ? inlineAnswerHtml(answer) : "  "}</span>`;
}

function wrapMarks(children: ReactNode, marks: RichMark[] | undefined, key: string): ReactNode {
  if (!marks?.length) return children;
  return marks.reduceRight<ReactNode>((inner, mark, index) => {
    const k = `${key}-${index}`;
    switch (mark.type) {
      case "bold": return <strong key={k}>{inner}</strong>;
      case "italic": return <em key={k}>{inner}</em>;
      case "underline": return <u key={k}>{inner}</u>;
      case "strike": return <s key={k}>{inner}</s>;
      case "dots": return <span key={k} className="wb-dots" data-dots="">{inner}</span>;
      case "textStyle": return mark.attrs?.color ? <span key={k} style={{ color: mark.attrs.color } as CSSProperties}>{inner}</span> : inner;
      default: return inner;
    }
  }, children);
}

function renderInline(node: RichNode, key: string): ReactNode {
  switch (node.type) {
    case "text": return wrapMarks(node.text, node.marks, key);
    case "hardBreak": return <br key={key} />;
    case "inlineMath": {
      const latex = String(node.attrs?.latex ?? ""), display = Boolean(node.attrs?.display);
      return <span key={key} className={display ? "wb-math is-display" : "wb-math"} data-inline-math="" data-latex={latex} dangerouslySetInnerHTML={{ __html: mathNodeHtml(latex, display) }} />;
    }
    case "blank": {
      const answer = String(node.attrs?.answer ?? "");
      return <span key={key} className="wb-blank" data-blank="" data-answer={answer} dangerouslySetInnerHTML={{ __html: blankNodeHtml(answer) }} />;
    }
    default: return null;
  }
}

function renderBlock(node: RichNode, key: string): ReactNode {
  const kids = node.content ?? [];
  switch (node.type) {
    case "paragraph": return <p key={key}>{kids.length ? kids.map((child, i) => renderInline(child, `${key}.${i}`)) : <br />}</p>;
    case "bulletList": return <ul key={key}>{kids.map((child, i) => renderBlock(child, `${key}.${i}`))}</ul>;
    case "orderedList": return <ol key={key} start={Number(node.attrs?.start ?? 1)}>{kids.map((child, i) => renderBlock(child, `${key}.${i}`))}</ol>;
    case "listItem": return <li key={key}>{kids.map((child, i) => renderBlock(child, `${key}.${i}`))}</li>;
    default: return null;
  }
}

export const RichView = memo(function RichView({ doc }: { doc: RichDoc }) {
  return <>{doc.content.map((node, i) => renderBlock(node, String(i)))}</>;
});
