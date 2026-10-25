import test from "node:test";
import assert from "node:assert/strict";
import { cleanOcrText, parseOcrResponse } from "../src/ocr.ts";

test("parses questions JSON fence without manufacturing answers", () => {
  const result = parseOcrResponse('```json\n{"questions":[{"type":"blank","stem":"已知 $x=1$，求 $2x$","options":[]}]}\n```', { multiple: true });
  assert.equal(result.length, 1); assert.equal(result[0].type, "blank"); assert.deepEqual(result[0].answer, []);
});
test("legacy text/expression response is unwrapped only once", () => {
  const stem = "9.随机抽取 1000 名学生，服从 $N(75,\\sigma^2)$。";
  const result = parseOcrResponse(JSON.stringify({ text: stem, expression: stem }), { multiple: false });
  assert.equal(result[0].stem, stem.slice(2)); assert.equal(result[0].stem.includes('"expression"'), false);
});
test("HTML fences become text, math comparison survives", () => {
  const result = parseOcrResponse('```html\n<html><body><p>1.若 $x<1$ 且 $y>2$，求值。</p><p>A. $1$</p><p>B. $2$</p></body></html>\n```', { multiple: false });
  assert.equal(result[0].stem, "若 $x<1$ 且 $y>2$，求值。"); assert.deepEqual(result[0].options, ["$1$", "$2$"]);
});
test("double dollar is converted and duplicated command slash repaired", () => {
  assert.equal(cleanOcrText("$$x_2$$ 和 $\\\\frac{1}{2}$"), "\\[x_2\\] 和 $\\frac{1}{2}$");
});
test("enumerate wrappers become editable subquestions without swallowing formulas", () => {
  const result = cleanOcrText("$\\begin{enumerate}\n&#x20;\\item$ 求值。\n\\item $x+1$\n$\\end{enumerate}$");
  assert.equal(result, "(1) 求值。\n\n(2) $x+1$");
});
test("multi-question mode keeps parenthesized subquestions together", () => {
  const result = parseOcrResponse("17.已知 $f(x)$。\n(1) 求定义域。\n(2) 求值域。\n18.证明不等式。\n(1) 先证明。", { multiple: true });
  assert.equal(result.length, 2); assert.match(result[0].stem, /\(2\)/);
});
test("single mode refuses a multi-object response instead of silently dropping data", () => {
  assert.throws(() => parseOcrResponse('{"questions":[{"stem":"第一题"},{"stem":"第二题"}]}', { multiple: false }), /多道题/);
});
test("malformed JSON cannot leak into question content", () => {
  assert.throws(() => parseOcrResponse('{"questions":[{"stem":"未完成', { multiple: true }), /不完整/);
});
test("choice options and multiple answers preserve supplied content", () => {
  const [q] = parseOcrResponse(JSON.stringify({ type: "多选题", stem: "正确的是", options: { A: "$1$", B: "$2$", C: "$3$", D: "$4$" }, answer: "ABD" }), { multiple: false, sourceImage: "data:image/png;base64,TEST" });
  assert.equal(q.type, "multi"); assert.deepEqual(q.answer, ["A", "B", "D"]); assert.equal(q.sourceImage, "data:image/png;base64,TEST");
});
