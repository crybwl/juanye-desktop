import katex from "katex";
import { drawingSegments } from "./drawing";
import { mathSegments, normalizeMathDelimiters } from "./math";

const commands = 'begin|end|frac|dfrac|tfrac|sqrt|vec|overrightarrow|overline|underline|left|right|text|mathrm|mathbf|mathbb|sin|cos|tan|cot|sec|csc|log|ln|exp|lim|sum|prod|int|partial|infty|pi|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|cdot|times|div|pm|mp|leq|le|geq|ge|neq|ne|approx|in|notin|subset|subseteq|supset|supseteq|cup|cap|emptyset|forall|exists|perp|parallel|angle|triangle';
const doubleSlash = new RegExp(`(?<!\\\\)\\\\{2}(?!\\\\)(?=(?:${commands})\\b)`, 'g');
const forwardSlash = new RegExp(`(?<![:/])/{2}(?!/)(?=(?:${commands})\\b)`, 'g');
const braced = String.raw`\{(?:[^{}\r\n]|\{[^{}\r\n]*\})*\}`;
const commandMath = new RegExp(String.raw`(?:[A-Za-z][A-Za-z0-9_()^{}]*\s*[=<>]\s*)?\\(?:${commands})(?![A-Za-z])(?:\[[^\]\r\n]*\])?(?:${braced})*(?:\s*[A-Za-z0-9]+(?:[_^](?:${braced}|[A-Za-z0-9]+))?)*`, 'g');
const safeMath = (candidate: string) => {
  try { katex.renderToString(candidate, { throwOnError: true, trust: false, maxExpand: 1000, maxSize: 20 }); return true; } catch { return false; }
};

/** Repair recognizable markup only, preserving diagrams and already delimited mathematics. */
export function normalizeOcrMath(text: string, numericOption = false): string {
  return drawingSegments(text).map(segment => {
    if (segment.kind === "tikz") return segment.code;
    let value = segment.text.replace(/＄/g, '$').replace(doubleSlash, '\\').replace(forwardSlash, '\\');
    const wrap = (pattern: RegExp) => {
      value = mathSegments(value).map(part => part.math ? part.display ? `\\[${part.text}\\]` : `$${part.text}$` : part.text.replace(pattern, candidate => safeMath(candidate.trim()) ? `$${candidate.trim()}$` : candidate)).join('');
    };
    wrap(/\\begin\{(aligned|cases|pmatrix|bmatrix|matrix|gathered)\}[\s\S]*?\\end\{\1\}/g);
    wrap(commandMath);
    wrap(/(?<![A-Za-z0-9])(?:[A-Za-z]\([^()\r\n]*\)|[A-Za-z0-9]+)(?:\s*[_^]\s*(?:\{[^{}\r\n]*\}|[A-Za-z0-9]+))+/g);
    wrap(/(?<![A-Za-z0-9])(?:[A-Za-z][A-Za-z0-9_()^{}.+*/ -]{0,40})\s*[=<>]\s*[-+A-Za-z0-9][A-Za-z0-9_()^{}.+*/ -]{0,40}/g);
    const trimmed = value.trim();
    // A literal percent in a numeric choice is not a TeX comment.
    if (numericOption && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(trimmed)) return `$${trimmed.slice(0, -1)}\\%$`;
    if (numericOption && !mathSegments(value).some(part => part.math) && !/\p{Script=Han}/u.test(trimmed) && trimmed.length <= 100 && (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[%°])?$/.test(trimmed) || /^[A-Za-z]$/.test(trimmed) || /^[\d.()+*/^{} -]+$/.test(trimmed) || /^[[(][^\r\n]+,[^\r\n]+[\])]$/.test(trimmed)) && safeMath(trimmed)) return `$${trimmed}$`;
    return normalizeMathDelimiters(value);
  }).join('');
}

/** Printed answer blanks are not mathematical parentheses such as coordinates or subquestions. */
export function removeAnswerPlaceholders(text: string): string {
  return drawingSegments(text).map(segment => {
    if (segment.kind === 'tikz') return segment.code;
    const placeholder = (content: string) => !content.replace(/\\(?:underline|hspace\*?|rule|qquad|quad|enspace|hfill)|\\_/g, '').replace(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|mm|cm|em|ex|in)\b/gi, '').replace(/[\s＿_﹏—–·⋯…$~{}\[\]-]/g, '');
    return segment.text.replace(/\$[（(]([^（）()\r\n]{0,160})[）)]\$/g, (match, content: string) => placeholder(content) ? '' : match).replace(/[（(]([^（）()\r\n]{0,160})[）)]/g, (match, content: string) => placeholder(content) ? '' : match).replace(/[ \t　]+([，。；：,.!?！？])/g, '$1');
  }).join('');
}
