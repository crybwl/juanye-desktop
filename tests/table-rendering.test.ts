import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MathText, renderMathText } from "../src/math";
import { SLEEP_QUESTION, SLEEP_TABLE_VALUES } from "./fixtures/sleep-question";
import { printedQuestionStem } from "../src/components/Paper";
import type { Question } from "../src/types";

Object.assign(globalThis, { React });
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}(?:\\s|>)`, "g")) || []).length;

test("paper presentation deduplicates pasted numbering and score without editing the source", () => {
  const q: Question = { id: "sleep", type: "essay", score: 15, stem: SLEEP_QUESTION, options: [], answer: [], analysis: "" };
  assert.ok(printedQuestionStem(q).startsWith("睡眠是影响学习状态"));
  assert.equal(q.stem, SLEEP_QUESTION);
  assert.equal(printedQuestionStem({ ...q, stem: "(1) 求值。" }), "(1) 求值。");
  assert.equal(printedQuestionStem({ ...q, stem: "0.34 是概率。" }), "0.34 是概率。");
});

test("the exact sleep question renders two real tables and bold question numbering", () => {
  const html = renderMathText(SLEEP_QUESTION);
  assert.equal(count(html, "table"), 2);
  assert.equal(count(html, "tr"), 6);
  assert.equal(count(html, "th"), 9);
  assert.equal(count(html, "td"), 17);
  assert.match(html, /<strong\b[^>]*>16\.<\/strong>/);
  assert.doesNotMatch(html, /\*\*16\.\*\*/);
  assert.match(html, /睡眠充足/);
  assert.match(html, /注意力不集中/);
  for (const value of SLEEP_TABLE_VALUES) assert.ok(html.includes(value), `Table lost ${value}`);
});

test("table headers and numeric body cells render local KaTeX mathematics", () => {
  const html = renderMathText(SLEEP_QUESTION);
  assert.match(html, /<th\b[^>]*>[\s\S]*?class="katex/);
  assert.match(html, /<td\b[^>]*>[\s\S]*?class="katex/);
  assert.doesNotMatch(html, /class="katex-error/);
  assert.ok(html.includes("x_\\alpha"));
  assert.ok(html.includes("\\chi^2"));
});

test("the three parenthesized subquestions remain ordinary question text", () => {
  const html = renderMathText(SLEEP_QUESTION);
  for (const label of ["（1）", "（2）", "（3）"]) assert.ok(html.includes(label));
  assert.equal(count(html, "ol"), 0);
  assert.equal(count(html, "li"), 0);
});

test("pipes within delimited probabilities and absolute values do not create table cells", () => {
  const html = renderMathText(String.raw`| 公式 | 值 |
| --- | --- |
| $P(A|B)$ | $|x|$ |`);
  assert.equal(count(html, "table"), 1);
  assert.equal(count(html, "th"), 2);
  assert.equal(count(html, "td"), 2);
  assert.ok(html.includes("P(A|B)"));
  assert.ok(html.includes("|x|"));
  assert.doesNotMatch(html, /class="katex-error/);
});

test("escaped literal table pipes stay in one editable cell", () => {
  const html = renderMathText(String.raw`| 文字 | 值 |
| --- | --- |
| 左\|右 | $1$ |`);
  assert.equal(count(html, "table"), 1);
  assert.equal(count(html, "td"), 2);
  assert.ok(html.includes("左|右"));
});

test("Word table cell line breaks render safely without enabling HTML", () => {
  const html = renderMathText('| 字段 | 内容 |\n| --- | --- |\n| 解答 | 第一段<br>第二段<br/>$P(A|B)$ |\n| 安全 | <br onclick="alert(1)"> |');
  assert.equal(count(html, "table"), 1);
  assert.equal(count(html, "td"), 4);
  assert.match(html, /第一段<br\/>第二段<br\/>/);
  assert.ok(html.includes("P(A|B)"));
  assert.ok(html.includes('&lt;br onclick='));
  assert.doesNotMatch(html, /<br onclick=/);
});

test("tables without outer pipes remain supported", () => {
  const html = renderMathText("类别 | 人数\n:--- | ---:\n充足 | $100$\n不足 | $100$");
  assert.equal(count(html, "table"), 1);
  assert.equal(count(html, "th"), 2);
  assert.equal(count(html, "td"), 4);
});

test("math underscores, asterisks and all existing delimiters stay outside Markdown emphasis", () => {
  const html = renderMathText(String.raw`正文 $x_1*a$、\(y_2\)、\[z_3\]、$$w_4$$。`);
  assert.ok(html.includes("x_1*a"));
  assert.ok(html.includes("y_2"));
  assert.ok(html.includes("z_3"));
  assert.ok(html.includes("w_4"));
  assert.equal(count(html, "em"), 0);
  assert.doesNotMatch(html, /class="katex-error/);
});

test("ordinary prose and numbered conditions are not silently converted into lists", () => {
  const html = renderMathText("已知 $ABCD$。\n1. 第一条件。\n2. 第二条件。\n(1) 求值；\n(2) 证明。");
  assert.equal(count(html, "ol"), 0);
  assert.equal(count(html, "li"), 0);
  assert.ok(html.includes("1. 第一条件。"));
  assert.ok(html.includes("(2) 证明。"));
});

test("printed answer underscores retain the existing blank marker", () => {
  const html = renderMathText("填空：______，已知 $x_1$。");
  assert.match(html, /class="q-blank"/);
  assert.ok(html.includes("x_1"));
});

test("malformed table delimiters remain visible rather than losing content", () => {
  const html = renderMathText("类别 | 人数\n---\n甲 | $2$");
  assert.equal(count(html, "table"), 0);
  assert.ok(html.includes("类别"));
  assert.ok(html.includes("人数"));
  assert.ok(html.includes("甲"));
});

test("raw HTML and executable attributes stay inert in prose and cells", () => {
  const html = renderMathText('<script>alert(1)</script>\n\n| 项 | 值 |\n| --- | --- |\n| <img src="https://example.invalid/a" onerror="alert(1)"> | <iframe src="https://example.invalid/b"></iframe> |');
  assert.equal(count(html, "script"), 0);
  assert.equal(count(html, "img"), 0);
  assert.equal(count(html, "iframe"), 0);
  assert.equal(count(html, "table"), 1);
  assert.ok(html.includes("&lt;script&gt;"));
});

test("Markdown images and links cannot request remote content or execute JavaScript", () => {
  const html = renderMathText('![图](https://example.invalid/x.png) [链接](javascript:alert(1)) https://example.invalid/');
  assert.equal(count(html, "img"), 0);
  assert.equal(count(html, "a"), 0);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:|javascript:)/i);
});

test("TikZ blocks keep drawing code out of Markdown table and emphasis parsing", () => {
  const code = String.raw`\begin{tikzpicture}
\node at (0,0) {$A_B$};
\node at (1,0) {x|y};
\end{tikzpicture}`;
  const html = renderToStaticMarkup(React.createElement(MathText, { text: `**题图**\n${code}\n\n| 项 | 值 |\n| --- | --- |\n| 数据 | $1$ |` }));
  assert.match(html, /tikz-drawing/);
  assert.equal(count(html, "table"), 1);
  assert.doesNotMatch(html, /\\begin\{tikzpicture\}/);
  assert.match(html, /<strong\b[^>]*>题图<\/strong>/);
});
