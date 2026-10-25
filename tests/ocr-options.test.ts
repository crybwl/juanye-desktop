import test from "node:test";
import assert from "node:assert/strict";
import { parseOcrResponse } from "../src/ocr.ts";

const parse = (value: unknown) => parseOcrResponse(typeof value === "string" ? value : JSON.stringify(value), { multiple: false })[0];

test("inline ABCD choices are moved into the option fields", () => {
  const q = parse("1. 下列数中最大的是 A. 1 B. 2 C. 3 D. 4");
  assert.equal(q.stem, "下列数中最大的是");
  assert.equal(q.type, "single");
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
  assert.deepEqual(q.answer, []);
});

test("two-column OCR options are extracted in label order", () => {
  const q = parse({ text: "请选择正确答案。\nA. $x+1$    B. $x-1$\nC. $2x$    D. $x^2$" });
  assert.equal(q.stem, "请选择正确答案。");
  assert.deepEqual(q.options, ["$x+1$", "$x-1$", "$2x$", "$x^2$"]);
});

test("column-first OCR keeps A/C/B/D content mapped to its correct field", () => {
  const q = parse("正确的是\nA. 甲\nC. 丙\nB. 乙\nD. 丁");
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["甲", "乙", "丙", "丁"]);
});

test("an option block returned as a string is also unpacked", () => {
  const q = parse({ type: "single", stem: "正确的是", options: "A. 1 B. 2 C. 3 D. 4" });
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
});

test("matching partial structured choices are completed without overwriting their content", () => {
  const q = parse({ type: "single", stem: "正确的是 A. 1 B. 2 C. 3 D. 4", options: ["$1$", "", "$3$", ""] });
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
});

test("multiline option continuation stays in its own option", () => {
  const q = parse("选择正确的说法。\nA. 第一项前半段\n第一项续行\nB. 第二项\n第二项续行\nC. 第三项\nD. 第四项");
  assert.equal(q.stem, "选择正确的说法。");
  assert.deepEqual(q.options, ["第一项前半段\n第一项续行", "第二项\n第二项续行", "第三项", "第四项"]);
});

test("full-width letters and common option punctuation are recognized", () => {
  const q = parse("选择正确答案。\nＡ．1\nＢ、2\nＣ）3\n（Ｄ）4");
  assert.equal(q.stem, "选择正确答案。");
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
});

test("ASCII parenthesized option labels are recognized", () => {
  const q = parse({ type: "single", stem: "哪个正确？ (A)甲 (B)乙 (C)丙 (D)丁" });
  assert.equal(q.stem, "哪个正确？");
  assert.deepEqual(q.options, ["甲", "乙", "丙", "丁"]);
});

test("Chinese colon option labels are recognized", () => {
  const q = parse("正确的是\nA：甲\nB：乙\nC：丙\nD：丁");
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["甲", "乙", "丙", "丁"]);
});

test("HTML paragraphs with inline options are unwrapped before extraction", () => {
  const q = parse("```html\n<p>正确的是</p><p>A. 1 B. 2</p><p>C. 3 D. 4</p>\n```");
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
});

test("an explicit multi-choice type and supplied answer are preserved", () => {
  const q = parse({ questionType: "多项选择题", content: "正确的是 A. 甲 B. 乙 C. 丙 D. 丁", answers: "AC" });
  assert.equal(q.stem, "正确的是");
  assert.equal(q.type, "multi");
  assert.deepEqual(q.options, ["甲", "乙", "丙", "丁"]);
  assert.deepEqual(q.answer, ["A", "C"]);
});

test("each top-level question gets only its own extracted choices", () => {
  const questions = parseOcrResponse("1. 第一题 A. 1 B. 2 C. 3 D. 4\n2. 第二题 A. 甲 B. 乙 C. 丙 D. 丁", { multiple: true });
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map(q => q.stem), ["第一题", "第二题"]);
  assert.deepEqual(questions[0].options, ["$1$", "$2$", "$3$", "$4$"]);
  assert.deepEqual(questions[1].options, ["甲", "乙", "丙", "丁"]);
});

test("structured multi-question results also extract choices from the stem", () => {
  const questions = parseOcrResponse(JSON.stringify({ questions: [
    { type: "single", stem: "第一题\nA. 1 B. 2 C. 3 D. 4", options: [] },
    { type: "single", stem: "第二题\nA. 甲 B. 乙 C. 丙 D. 丁", options: [] },
  ] }), { multiple: true });
  assert.deepEqual(questions.map(q => q.stem), ["第一题", "第二题"]);
  assert.deepEqual(questions.map(q => q.options.length), [4, 4]);
});

test("source-image / re-recognition parsing shares the same option extraction", () => {
  const [q] = parseOcrResponse(JSON.stringify({ text: "正确的是 A. 1 B. 2 C. 3 D. 4" }), { multiple: false, sourceImage: "data:image/png;base64,TEST" });
  assert.equal(q.sourceImage, "data:image/png;base64,TEST");
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["$1$", "$2$", "$3$", "$4$"]);
});

test("numeric choices including decimals, signs, percentages and coordinates are math-wrapped", () => {
  const q = parse("正确的是 A. 0.5 B. -2 C. 25% D. (1,2)");
  assert.deepEqual(q.options, ["$0.5$", "$-2$", "$25\\%$", "$(1,2)$"]);
});

test("existing A/B newline extraction remains compatible", () => {
  const q = parse("下面正确的是\nA. 甲\nB. 乙");
  assert.equal(q.stem, "下面正确的是");
  assert.deepEqual(q.options, ["甲", "乙"]);
});

test("a single stray option-like label is not extracted", () => {
  const source = "已知下列条件。\nA. 仅有一个说明。";
  const q = parse(source);
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, []);
});

test("a missing middle label does not silently shift choices", () => {
  const source = "正确的是\nA. 甲\nC. 丙\nD. 丁";
  const q = parse(source);
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, []);
});

test("mathematical ABCD and dotted symbols are not choice labels", () => {
  const source = "在四边形 $ABCD$ 中，已知 $A.B=1$，求面积。\n(1) 连接 $AC$；\n(2) 证明结论。";
  const q = parse(source);
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, []);
});

test("point names in Chinese prose are not choices", () => {
  const source = "已知点 A、B、C、D 构成四边形，求它的面积。";
  const q = parse(source);
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, []);
});

test("labels inside LaTeX math are protected while real choices still extract", () => {
  const formula = "$\\text{A. 甲 B. 乙 C. 丙 D. 丁}$";
  const q = parse(`观察 ${formula}，正确的是\nA. 真甲\nB. 真乙\nC. 真丙\nD. 真丁`);
  assert.equal(q.stem, `观察 ${formula}，正确的是`);
  assert.deepEqual(q.options, ["真甲", "真乙", "真丙", "真丁"]);
});

test("labels inside TikZ code are never split into choices", () => {
  const drawing = String.raw`\begin{tikzpicture}
\node at (0,0) {A. 甲 B. 乙 C. 丙 D. 丁};
\end{tikzpicture}`;
  const source = `观察下图并证明。\n${drawing}`;
  const q = parse(source);
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, []);
});

for (const type of ["essay", "blank"]) {
  test(`an explicit ${type} question is not converted by an ABCD list`, () => {
    const source = "依次处理以下材料\nA. 第一段\nB. 第二段\nC. 第三段\nD. 第四段";
    const q = parse({ type, stem: source });
    assert.equal(q.type, type);
    assert.equal(q.stem, source);
    assert.deepEqual(q.options, []);
  });
}

test("existing structured choices are preserved without duplication", () => {
  const q = parse({ type: "single", stem: "正确的是 A. 甲 B. 乙 C. 丙 D. 丁", options: ["甲", "乙", "丙", "丁"] });
  assert.equal(q.stem, "正确的是");
  assert.deepEqual(q.options, ["甲", "乙", "丙", "丁"]);
});

test("conflicting structured choices do not erase either source of content", () => {
  const source = "正确的是 A. 原甲 B. 原乙 C. 原丙 D. 原丁";
  const q = parse({ type: "single", stem: source, options: ["新甲", "新乙", "新丙", "新丁"] });
  assert.equal(q.stem, source);
  assert.deepEqual(q.options, ["新甲", "新乙", "新丙", "新丁"]);
});
