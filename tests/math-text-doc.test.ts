import assert from "node:assert/strict";
import test from "node:test";
import { canEditVisually, docToMathText, mathTextToDoc, segmentMath } from "../src/math-text-doc";

const roundTrip = (src: string) => docToMathText(mathTextToDoc(src));

test("plain text, line breaks and blanks round-trip exactly", () => {
  for (const src of ["", "已知集合，则", "第一行\n第二行", "空行\n\n之后", "若 x=______，则", "尾随换行\n"]) assert.equal(roundTrip(src), src);
});

test("all four formula delimiters are preserved", () => {
  const src = "设 $f(x)=x^2$，且 \\(a>0\\)。\n$$\\int_0^1 x\\,dx$$\n\\[\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\\]";
  assert.equal(roundTrip(src), src);
  const kinds = segmentMath(src).filter(s => s.math).map(s => s.math!.delim);
  assert.deepEqual(kinds, ["$", "\\(", "$$", "\\["]);
});

test("multi-line display math stays a single formula", () => {
  const src = "方程组\n\\[\\begin{cases}x+y=1\\\\\nx-y=3\\end{cases}\\]\n的解为";
  const doc = mathTextToDoc(src);
  assert.equal(doc.content.length, 3);
  assert.equal(roundTrip(src), src);
});

test("escaped dollars and unmatched delimiters stay as text", () => {
  for (const src of ["价格 \\$5", "只有一个 $ 符号", "$$ 未闭合"]) {
    assert.equal(roundTrip(src), src);
    assert.ok(canEditVisually(src));
  }
});

test("content that cannot be edited losslessly falls back to source mode", () => {
  assert.equal(canEditVisually("| 类别 | 数量 |\n| --- | --- |\n| 甲 | 1 |"), false);
  assert.equal(canEditVisually("\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}"), false);
  assert.equal(canEditVisually("**加粗** 文字"), false);
  assert.equal(canEditVisually("第一行<br/>第二行"), false);
  assert.equal(canEditVisually("集合 $A=\\{x\\mid x>1\\}$，求 $A\\cap B$"), true);
  assert.equal(canEditVisually("公式内的竖线 $|x|$ 不是表格"), true);
});
