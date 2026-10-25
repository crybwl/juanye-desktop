import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { defaultLayout, sampleExam } from "./data";
import { exportProject, exportTex, importDocument, importText, parseProject, PROJECT_SCHEMA, stripQuestionNumber } from "./documents";
import { mathSegments, normalizeMathDelimiters, renderMathText } from "./math";
import { buildBlocks } from "./components/Paper";

const examCopy = () => structuredClone(sampleExam);
// tsx may select classic JSX when the workspace is accessed through its Windows junction.
Object.assign(globalThis, { React });

test("editable project roundtrip keeps figures, source images and answer spaces", () => {
  const exam = examCopy();
  exam.sections[0].questions[0].figure = "data:image/png;base64,aGVsbG8=";
  exam.sections[0].questions[0].sourceImage = "data:image/jpeg;base64,aGVsbG8=";
  exam.sections[0].questions[0].answerSpace = "half";
  const parsed = parseProject(exportProject(exam, defaultLayout));
  assert.equal(parsed.exam.title, exam.title);
  assert.equal(parsed.exam.sections[0].questions[0].figure, exam.sections[0].questions[0].figure);
  assert.equal(parsed.exam.sections[0].questions[0].sourceImage, exam.sections[0].questions[0].sourceImage);
  assert.deepEqual(parsed.layout, defaultLayout);
  assert.ok(!parsed.exam.sections.at(-1)!.questions.at(-1)!.stem.includes("$$"));
});

test("project validation rejects other protocols, duplicate IDs, scripts and invalid numbers", () => {
  assert.throws(() => parseProject("{bad"), /JSON/);
  assert.throws(() => parseProject(JSON.stringify({ schema: "haoti/1" })), /juanye\/1/);
  const exam = examCopy();
  exam.sections[0].questions[1].id = exam.sections[0].questions[0].id;
  assert.throws(() => parseProject(exportProject(exam, defaultLayout)), /重复/);
  const invalid = examCopy();
  invalid.sections[0].questions[0].figure = "javascript:alert(1)";
  assert.throws(() => parseProject(exportProject(invalid, defaultLayout)), /题图/);
  assert.throws(() => parseProject(exportProject(sampleExam, { ...defaultLayout, margin: -4 })), /页边距/);
  assert.equal(JSON.parse(exportProject(sampleExam, defaultLayout)).schema, PROJECT_SCHEMA);
});

test("text import splits main questions but preserves numbered subquestions", () => {
  const questions = importText("数学试卷\n一、单项选择题\n1. 已知 $x=1$，则结果为\nA. $1$ B. 2 C. $3$ D. 4\n答案：B\n解析：代入。\n二、解答题\n2. 已知函数 $f(x)$。\n(1) 求定义域；\n（2）求值域。");
  assert.equal(questions.length, 2);
  assert.equal(questions[0].stem, "已知 $x=1$，则结果为");
  assert.deepEqual(questions[0].options, ["$1$", "2", "$3$", "4"]);
  assert.deepEqual(questions[0].answer, ["B"]);
  assert.equal(questions[0].analysis, "代入。");
  assert.equal(questions[1].type, "essay");
  assert.match(questions[1].stem, /\(1\).*\n（2）/);
  assert.ok(!questions[0].stem.includes("解答题"));
});

test("multiple-choice headings, formulas, decimal values and unnumbered input survive", () => {
  const questions = importText("一、多项选择题\n9. 选择正确结论\nA. $A.B.$ B. 0.34 C. 3 D. 4\n【答案】ABD\n10. $f(x)=x^2$\n(1) 证明；\n(2) 求值。");
  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, "multi");
  assert.deepEqual(questions[0].answer, ["A", "B", "D"]);
  assert.equal(questions[0].options[1], "0.34");
  assert.equal(importText("求 $x$ 的值。\n(1) $x+1=2$").length, 1);
  assert.equal(stripQuestionNumber("9. 已知 $x$"), "已知 $x$");
  assert.equal(stripQuestionNumber("(1) 已知 $x$"), "(1) 已知 $x$");
});

test("math accepts all supported delimiters, normalises legacy display dollars and escapes prose", () => {
  const src = "正文 $x_1$、\\(\\frac{1}{2}\\)、\\[\\sqrt{x}\\]、$$y^2$$";
  assert.equal(mathSegments(src).filter((s) => s.math).length, 4);
  assert.ok(!normalizeMathDelimiters(src).includes("$$"));
  assert.match(renderMathText(src), /class="katex/);
  assert.match(renderMathText("<script>alert(1)</script>"), /&lt;script&gt;/);
  assert.ok(!renderMathText("$\\href{javascript:alert(1)}{x}$").includes('href="javascript'));
  assert.equal(mathSegments("未结束 $x").filter((s) => s.math).length, 0);
  assert.equal(mathSegments("价格 \\$5，公式 $x$").filter((s) => s.math).length, 1);
});

test("TeX preserves formulas, escapes prose, uses continuous numbering and appends answers", () => {
  const exam = examCopy();
  exam.title = "标题 & 50%_{}\\input{evil}";
  const tex = exportTex(exam, { ...defaultLayout, paper: "A5", orientation: "landscape" });
  assert.match(tex, /paperwidth=210mm,paperheight=148mm/);
  assert.match(tex, /标题 \\& 50\\%\\_/);
  assert.ok(!tex.includes("$$"));
  assert.match(tex, /\\begin\{enumerate\}\[start=4,/);
  assert.match(tex, /\\begin\{enumerate\}\[start=6,/);
  assert.match(tex, /A\. \$\(-1,4\]\$/);
  assert.ok(tex.indexOf("参考答案与解析") > tex.indexOf("start=6"));
  assert.match(tex, /选择、填空速对/);
  const bad = examCopy();
  bad.sections[0].questions[0].stem = "$\\input{secret}$";
  assert.throws(() => exportTex(bad, defaultLayout), /不允许/);
});

test("paper blocks append answers only after all questions", () => {
  const blocks = buildBlocks(sampleExam, defaultLayout, 51, 7);
  const answerIndex = blocks.findIndex((b) => b.key === "answer-title");
  assert.ok(answerIndex > blocks.map((b) => b.kind).lastIndexOf("q"));
  assert.equal(blocks[answerIndex].breakBefore, true);
  assert.ok(blocks.some((b) => b.key === "quick-0"));
});

test("file importer recognises project/text and refuses images and third-party ZIPs", async () => {
  const imported = await importDocument(new File(["1. 求值。\n(1) 已知 $x=1$。"], "题目.txt", { type: "text/plain" }));
  assert.equal(imported.questions?.length, 1);
  const project = await importDocument(new File([exportProject(sampleExam, defaultLayout)], "试卷.juanye", { type: "application/json" }));
  assert.equal(project.exam?.title, sampleExam.title);
  await assert.rejects(() => importDocument(new File(["pixels"], "题.png", { type: "image/png" })), /OCR/);
  await assert.rejects(() => importDocument(new File(["zip"], "好题.zip")), /不接收/);
  await assert.rejects(() => importDocument(new File([], "空.txt")), /为空/);
});
