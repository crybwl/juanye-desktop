import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBlocks, quickAnswerSummary } from "../src/components/Paper";
import { defaultLayout } from "../src/data";
import type { Exam, Question } from "../src/types";

Object.assign(globalThis, { React });

test("quick-check cells retain short choices and ordinary mathematical answers", () => {
  assert.equal(quickAnswerSummary({ answer: ["A", "C"] }), "A；C");
  assert.equal(quickAnswerSummary({ answer: [String.raw`$\frac{\sqrt{3}}{2}$`] }), String.raw`$\frac{\sqrt{3}}{2}$`);
  assert.equal(quickAnswerSummary({ answer: ["$|x|$"] }), "$|x|$");
  assert.equal(quickAnswerSummary({ answer: [] }), "待补充");
});

test("a worked solution or table never becomes a huge four-column quick-check cell", () => {
  for (const text of ["C。方法：利用三角恒等变换和辅助角公式可以求得该函数的值域。".repeat(8), "答案第一行\n第二行", "| 类别 | 数值 |\n| --- | --- |\n| 样本 | $200$ |", String.raw`$\begin{aligned}x&=1\\y&=2\end{aligned}$`]) {
    assert.equal(quickAnswerSummary({ answer: [text] }), "见下方");
  }
});

test("quick-check fallback does not edit or discard the complete answer below it", () => {
  const answer = "C。方法：利用三角恒等变换和辅助角公式可以求得该函数的值域。".repeat(8);
  const q: Question = { id: "long-answer", type: "single", score: 5, stem: "测试题", options: ["甲", "乙", "丙", "丁"], answer: [answer], analysis: "单独的解析" };
  const exam: Exam = { title: "速对布局", subtitle: "", duration: 120, notice: [], sections: [{ id: "single", type: "single", title: "单项选择题", note: "", questions: [q] }] };
  const blocks = buildBlocks(exam, { ...defaultLayout, answerMode: "full" }, 5, 1);
  const quick = renderToStaticMarkup(React.createElement(React.Fragment, null, blocks.find(block => block.key === "quick-0")!.node));
  const detail = renderToStaticMarkup(React.createElement(React.Fragment, null, blocks.find(block => block.key === "long-answer-answer")!.node));
  assert.match(quick, /p-quick-cell/);
  assert.match(quick, /见下方/);
  assert.ok(!quick.includes(answer));
  assert.ok(detail.includes(answer));
  assert.ok(detail.includes("单独的解析"));
  assert.deepEqual(q.answer, [answer]);
});
