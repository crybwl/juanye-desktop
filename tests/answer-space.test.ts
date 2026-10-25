import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultLayout } from "../src/data";
import type { Exam, Layout, Question } from "../src/types";
import { answerCardSpace, buildBlocks, integratedSpacePlan, pageDims } from "../src/components/Paper";

Object.assign(globalThis, { React });
const question = (patch: Partial<Question> = {}): Question => ({ id: "space-q", type: "essay", score: 12, stem: "证明 $x^2\\ge0$。", options: [], answer: [], analysis: "", ...patch });
const exam = (q: Question): Exam => ({ title: "空间检查", subtitle: "", duration: 120, notice: [], sections: [{ id: "space-section", type: "essay", title: "解答题", note: "", questions: [q] }] });
const layout: Layout = { ...defaultLayout, answerMode: "none" };
const markup = (q: Question, l = layout) => buildBlocks(exam(q), l, q.score, 1).map(block => renderToStaticMarkup(block.node)).join("");

test("ordinary question paper has no writing-space blocks regardless of answer-card size", () => {
  for (const answerSpace of ["auto", "quarter", "half", "full"] as const) {
    const blocks = buildBlocks(exam(question({ answerSpace })), { ...layout, paperMode: "questions", answerSpace: true }, 12, 1);
    assert.equal(blocks.filter(block => block.kind === "space").length, 0);
  }
  assert.equal(markup(question({ answerSpace: "quarter" })), markup(question({ answerSpace: "full" })));
});

test("old layouts without paperMode also remain compact even if legacy answerSpace was enabled", () => {
  const old = { ...layout, paperMode: undefined, answerSpace: true };
  assert.equal(buildBlocks(exam(question({ answerSpace: "full" })), old, 12, 1).filter(block => block.kind === "space").length, 0);
});

test("the integrated paper mode explicitly creates answer space and follows the answer card by default", () => {
  const q = question({ answerSpace: "half" });
  const l = { ...layout, paperMode: "integrated" as const };
  assert.equal(integratedSpacePlan(q, l, 1)?.space, "half");
  assert.equal(buildBlocks(exam(q), l, 12, 1).filter(block => block.kind === "space").length, 1);
});

test("an independent integrated-paper setting never changes the answer-card setting", () => {
  const q = question({ answerSpace: "quarter", paperAnswerSpace: "full" });
  assert.equal(answerCardSpace(q, 1), "quarter");
  assert.equal(integratedSpacePlan(q, { ...layout, paperMode: "integrated" }, 1)?.space, "full");
  assert.equal(q.answerSpace, "quarter");
});

test("full integrated space is a dynamic page remainder instead of a fixed 550px blank", () => {
  const q = question({ answerSpace: "full" });
  const l = { ...layout, paperMode: "integrated" as const };
  const plan = integratedSpacePlan(q, l, 1);
  assert.deepEqual(plan, { space: "full", height: 0, fillRemaining: true });
  const blocks = buildBlocks(exam(q), l, 12, 1);
  assert.equal(blocks.find(block => block.kind === "q")?.pageSizedQuestion, true);
  assert.equal(blocks.find(block => block.kind === "space")?.fillRemaining, true);
  assert.doesNotMatch(markup(q, l), /height:550px/);
});

test("fractional integrated space uses real page dimensions and margins", () => {
  const q = question({ paperAnswerSpace: "quarter" });
  const a5 = { ...layout, paperMode: "integrated" as const, paper: "A5" as const, margin: 15 };
  const dims = pageDims(a5);
  assert.equal(integratedSpacePlan(q, a5, 1)?.height, (dims.ph - 2 * dims.m - 12) * 0.25);
  assert.ok(integratedSpacePlan(q, a5, 1)!.height < integratedSpacePlan(q, { ...a5, paper: "A4" }, 1)!.height);
});

test("the 17th through 19th answer-card questions still default to one full page each", () => {
  const q = question();
  assert.equal(answerCardSpace(q, 16), "half");
  for (const number of [17, 18, 19]) {
    assert.equal(answerCardSpace(q, number), "full");
    assert.equal(integratedSpacePlan(q, { ...layout, paperMode: "integrated" }, number)?.space, "full");
  }
  assert.equal(answerCardSpace(q, 20), "half");
  assert.equal(answerCardSpace(question({ answerSpace: "quarter" }), 17), "quarter");
});

test("an explicit compact integrated setting is independent of automatic answer-card defaults", () => {
  const q = question({ paperAnswerSpace: "auto" });
  const plan = integratedSpacePlan(q, { ...layout, paperMode: "integrated" }, 17)!;
  assert.equal(plan.space, "auto");
  assert.equal(plan.fillRemaining, false);
  assert.ok(plan.height >= 80);
  assert.equal(answerCardSpace(q, 17), "full");
});

test("choice questions never acquire long-answer spaces in integrated mode", () => {
  const q = question({ type: "single", options: ["1", "2", "3", "4"], answerSpace: "full" });
  assert.equal(integratedSpacePlan(q, { ...layout, paperMode: "integrated" }, 1), undefined);
});

test("new paper defaults are compact and do not reserve writing space", () => {
  assert.equal(defaultLayout.paperMode, "questions");
  assert.equal(defaultLayout.density, "compact");
  assert.equal(defaultLayout.answerSpace, false);
});
