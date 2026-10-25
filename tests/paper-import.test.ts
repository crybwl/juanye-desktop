import test from "node:test";
import assert from "node:assert/strict";
import { parsePaperImport } from "../src/paper-import";
import { exportMarkdown } from "../src/markdown-export";
import type { Exam, Question } from "../src/types";
import { defaultLayout } from "../src/data";

const after = String.raw`# 数学试题
一、单项选择题
**1.**（5 分）若 $f(x)=x^2$，则 $f(2)$ 为
A. 1 B. 2 C. 3 D. 4
【答案】D
【解析】代入得 $f(2)=4$。
来源：校本题库
知识点：函数，代入
难度：基础

二、解答题
## 第16题（15 分）
已知 $a_n$，求下列问题。
（1）求通项；
（2）证明结论。
| 条件 | 数值 |
| --- | --- |
| 样本 | $P(A|B)$ |
答案：（1）$a_n=2^n$；（2）成立。
解析：先代入，再证明。
\begin{tikzpicture}
\node at (0,0) {$A_B$};
\end{tikzpicture}`;

test("after-each-question import fills editor fields and explicit metadata", () => {
  const plan = parsePaperImport(after, { kind: "annotated", placement: "after" });
  assert.equal(plan.questions.length, 2);
  assert.deepEqual(plan.questions.map(value => value.number), [1, 16]);
  const first = plan.questions[0].question;
  assert.equal(first.type, "single");
  assert.equal(first.score, 5);
  assert.deepEqual(first.options, ["$1$", "$2$", "$3$", "$4$"]);
  assert.deepEqual(first.answer, ["D"]);
  assert.equal(first.analysis, "代入得 $f(2)=4$。");
  assert.equal(first.source, "校本题库");
  assert.deepEqual(first.knowledge, ["函数", "代入"]);
  assert.equal(first.difficulty, "easy");
  assert.equal(plan.questions[1].question.type, "essay");
  assert.equal(plan.questions[1].question.score, 15);
  assert.match(plan.questions[1].question.stem, /（2）证明结论/);
  assert.match(plan.questions[1].question.stem, /P\(A\|B\)/);
  assert.match(plan.questions[1].question.analysis, /\\begin\{tikzpicture\}/);
});

test("question-only import discards solution fields and a genuine answer appendix", () => {
  const plan = parsePaperImport(after, { kind: "questions" });
  assert.equal(plan.questions.length, 2);
  assert.ok(plan.questions.every(value => value.question.answer.length === 0 && value.question.analysis === ""));
  const tail = parsePaperImport("1. 第一题\n2. 第二题\n\n参考答案与解析\n1. 答案：A\n2. 答案：B", { kind: "questions" });
  assert.equal(tail.questions.length, 2);
  assert.equal(tail.questions[1].question.stem, "第二题");
});

test("answer-at-end import matches nonconsecutive question numbers instead of positions", () => {
  const plan = parsePaperImport("**2.** 选择正确结论\nA. 甲 B. 乙 C. 丙 D. 丁\n**16.**（15 分）求值。\n(1) 求和。\n\n## 参考答案与解析\n16. 答案：$2$\n解析：计算可得。\n2. 答案：B\n解析：选乙。", { kind: "annotated", placement: "end" });
  assert.deepEqual(plan.questions.map(value => value.number), [2, 16]);
  assert.deepEqual(plan.questions[0].question.answer, ["B"]);
  assert.equal(plan.questions[0].question.analysis, "选乙。");
  assert.deepEqual(plan.questions[1].question.answer, ["$2$"]);
  assert.equal(plan.questions[1].question.analysis, "计算可得。");
});

test("number restarts can identify an unlabeled answer appendix with a review warning", () => {
  const plan = parsePaperImport("1. 第一题。\n2. 第二题。\n1. 答案：A\n2. 答案：B", { kind: "annotated", placement: "end" });
  assert.equal(plan.questions.length, 2);
  assert.deepEqual(plan.questions.map(value => value.question.answer), [["A"], ["B"]]);
  assert.match(plan.warnings.join(""), /未找到卷尾标题/);
});

test("location selection is required only for annotated papers and rejects the wrong layout", () => {
  assert.throws(() => parsePaperImport("1. 题干。", { kind: "annotated" }), /请选择/);
  assert.throws(() => parsePaperImport("1. 题干。\n参考答案与解析\n1. 答案：A", { kind: "annotated", placement: "after" }), /卷尾/);
  assert.throws(() => parsePaperImport("1. 题干。\n答案：A", { kind: "annotated", placement: "end" }), /未找到卷尾/);
  assert.equal(parsePaperImport("1. 题干。", { kind: "questions" }).questions.length, 1);
  assert.equal(parsePaperImport("1. 答案：A", { kind: "solutions" }).solutions.length, 1);
});

test("separate solutions produce numbered patches and never manufacture questions", () => {
  const plan = parsePaperImport("**16.**\n【答案】$2$\n【解析】先求概率。\n\n第2题\n答案：AC\n解析：两项正确。\n来源：答案册", { kind: "solutions" });
  assert.deepEqual(plan.questions, []);
  assert.deepEqual(plan.solutions.map(value => value.number), [2, 16]);
  assert.deepEqual(plan.solutions[0].answer, ["A", "C"]);
  assert.equal(plan.solutions[0].source, "答案册");
  assert.equal(plan.solutions[1].analysis, "先求概率。");
});

test("an answer-only book cannot accidentally become a fake question containing the document title", () => {
  const text = "# 模拟卷答案与详细解析\n\n## 参考答案\n\n## 第1题\n\n**答案：A。方法：先代入。**\n\n详细说明。";
  assert.equal(parsePaperImport(text, { kind: "solutions" }).solutions.length, 1);
  assert.throws(() => parsePaperImport(text, { kind: "questions" }), /只有答案解析/);
  assert.throws(() => parsePaperImport(text, { kind: "annotated", placement: "after" }), /导入解析文件/);
  assert.throws(() => parsePaperImport(text, { kind: "annotated", placement: "end" }), /导入解析文件/);
});

test("vertical quick-answer tables and detailed analysis complement each other", () => {
  const plan = parsePaperImport("| 题号 | 答案 |\n| --- | --- |\n| 1 | A |\n| 2 | BC |\n\n1. 解析：因为 $x=1$。\n2. 解析：两项成立。", { kind: "solutions" });
  assert.equal(plan.solutions.length, 2);
  assert.deepEqual(plan.solutions[1].answer, ["B", "C"]);
  assert.equal(plan.solutions[0].analysis, "因为 $x=1$。");
});

test("horizontal quick-answer tables map columns to actual question numbers", () => {
  const plan = parsePaperImport("| 题号 | 2 | 16 |\n| --- | --- | --- |\n| 答案 | B | $P(A|B)$ |\n| 解析 | 选乙 | 根据定义。 |", { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(value => value.number), [2, 16]);
  assert.deepEqual(plan.solutions[1].answer, ["$P(A|B)$"]);
  assert.equal(plan.solutions[1].analysis, "根据定义。");
});

test("compact one-line choice answers include every number without an invented explanation", () => {
  const plan = parsePaperImport("1.A 2.B 3.AC", { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(value => [value.number, value.answer]), [[1, ["A"]], [2, ["B"]], [3, ["A", "C"]]]);
  assert.ok(plan.solutions.every(value => !value.analysis));
});

test("conflicting duplicate answer entries are not silently applied", () => {
  const plan = parsePaperImport("1. 答案：A\n1. 答案：B\n2. 答案：C", { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(value => value.number), [2]);
  assert.match(plan.warnings.join(""), /重复答案/);
});

test("question and solution numbers inside display math, tables and TikZ are not boundaries", () => {
  const source = String.raw`**1.** 求值。
\[
1. x + 2
2. y + 3
\]
\begin{tikzpicture}
1. text
2. text
\end{tikzpicture}
（1）第一小问。
（2）第二小问。
**2.** 第二题。`;
  const plan = parsePaperImport(source, { kind: "questions" });
  assert.equal(plan.questions.length, 2);
  assert.match(plan.questions[0].question.stem, /2\. y/);
  assert.match(plan.questions[0].question.stem, /2\. text/);
});

test("JSON imports preserve editor properties and reject unnumbered solution guesses", () => {
  const plan = parsePaperImport(JSON.stringify({ questions: [{ number: 16, type: "essay", stem: "求值。", score: 15, answer: ["$1$", "$2$"], analysis: "详解。", source: "校本", knowledge: ["概率"], difficulty: "hard", drawing: "绘图源码", answerSpace: "full", pageBreakBefore: true }] }), { kind: "annotated", placement: "after" });
  const q = plan.questions[0].question;
  assert.equal(q.score, 15);
  assert.deepEqual(q.answer, ["$1$", "$2$"]);
  assert.equal(q.difficulty, "hard");
  assert.equal(q.answerSpace, "full");
  assert.equal(q.drawing, "绘图源码");
  const missing = parsePaperImport('{"solutions":[{"answer":"A"}]}', { kind: "solutions" });
  assert.equal(missing.solutions.length, 0);
  assert.match(missing.warnings.join(""), /缺少题号/);
});

test("Markdown export remains readable, portable and round-trips every editor value", () => {
  const png = "data:image/png;base64,aGVsbG8=";
  const q = { id: "original", type: "blank", score: 7, stem: "**16.** 已知 $x_1$。\n\n| 项目 | 数值 |\n| --- | --- |\n| 数据 | $2$ |", options: [], answer: ["（1）$1$", "（2）$2$"], analysis: "**解析**：代入。", importNumber: 16, source: "校本", knowledge: ["函数"], difficulty: "hard", answerSpace: "full", pageBreakBefore: true, figures: [{ id: "figure", src: png, layout: "right", caption: "$A$", width: 25 }], sourceImage: png, drawing: String.raw`\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}` } as Question;
  const exam: Exam = { title: "往返测试", subtitle: "数学", duration: 90, notice: ["保持题目原文。"], sections: [{ id: "s", type: "blank", title: "填空题", note: "", questions: [q] }] };
  const md = exportMarkdown(exam, { ...defaultLayout, answerMode: "none" });
  assert.match(md, /【答案】/);
  assert.match(md, /【解析】/);
  assert.match(md, /\| 项目 \| 数值 \|/);
  const result = parsePaperImport(md, { kind: "annotated", placement: "after" });
  assert.equal(result.questions.length, 1);
  const imported = result.questions[0].question;
  for (const key of ["type", "score", "stem", "options", "answer", "analysis", "source", "knowledge", "difficulty", "answerSpace", "pageBreakBefore", "figures", "sourceImage", "drawing", "importNumber"] as const) assert.deepEqual(imported[key], q[key], key);
  const solution = parsePaperImport(md, { kind: "solutions" }).solutions[0];
  assert.equal(solution.questionId, "original");
  assert.equal(solution.importNumber, 16);
});

test("untrusted JSON cannot smuggle external picture URLs or configuration keys", () => {
  const source = JSON.stringify({ questions: [{ number: 1, stem: "题目。", type: "essay", score: 12, figure: "https://example.invalid/a.png", sourceImage: "file:///secret", figures: [{ id: "bad", src: "javascript:alert(1)", layout: "right" }], apiKey: "do-not-import-this" }] });
  const q = parsePaperImport(source, { kind: "questions" }).questions[0].question;
  assert.equal(q.figure, undefined);
  assert.equal(q.sourceImage, undefined);
  assert.deepEqual(q.figures, []);
  assert.equal("apiKey" in q, false);
});

test("embedded Markdown images become persistent right-side figures but outside links remain inert", () => {
  const png = "data:image/png;base64,aGVsbG8=";
  const plan = parsePaperImport(`1. 如图求值。\n![示意图 $A_B$](${png})\n![另一张](https://example.invalid/image.png)`, { kind: "questions" });
  const q = plan.questions[0].question;
  assert.equal(q.figures?.length, 1);
  assert.equal(q.figures?.[0].src, png);
  assert.equal(q.figures?.[0].layout, "right");
  assert.equal(q.figures?.[0].caption, "示意图 $A_B$");
  assert.ok(!q.stem.includes(png));
  assert.ok(q.stem.includes("https://example.invalid/image.png"));
  assert.match(plan.warnings.join(""), /外部图片不会/);
});

test("unmatched answer appendix entries remain visible as warnings and are not attached by order", () => {
  const plan = parsePaperImport("1. 第一题。\n3. 第三题。\n\n参考答案与解析\n1. 答案：A\n2. 答案：B", { kind: "annotated", placement: "end" });
  assert.deepEqual(plan.questions[0].question.answer, ["A"]);
  assert.deepEqual(plan.questions[1].question.answer, []);
  assert.equal(plan.solutions[0].number, 2);
  assert.match(plan.warnings.join(""), /第 2 题解析没有对应/);
  assert.match(plan.warnings.join(""), /第 3 题未找到/);
});

test("a choice followed by its explanation never becomes one oversized answer value", () => {
  for (const body of ["【答案】C。方法：把四边形分为两个三角形。", "C。方法：把四边形分为两个三角形。", "C\n方法：把四边形分为两个三角形。", "C\n【解析】把四边形分为两个三角形。"]) {
    const entry = parsePaperImport(`5. ${body}`, { kind: "solutions" }).solutions[0];
    assert.deepEqual(entry.answer, ["C"], body);
    assert.match(entry.analysis!, /把四边形分为两个三角形/, body);
    assert.ok(!entry.answer?.some(value => value.includes("方法")), body);
  }
});

test("inline, wide-bracket and combined answer labels populate separate editable fields", () => {
  for (const body of ["【答案】AC【详解】两项正确。", "［答案］AC［详解］两项正确。", "**【答案】** AC\n**【解析】** 两项正确。", "【答案与解析】AC。两项正确。", "【参考答案及解析】AC。两项正确。"]) {
    const q = parsePaperImport(`9. 选择正确结论。\nA. 甲 B. 乙 C. 丙 D. 丁\n${body}`, { kind: "annotated", placement: "after" }).questions[0].question;
    assert.deepEqual(q.answer, ["A", "C"], body);
    assert.equal(q.analysis, "两项正确。", body);
    assert.equal(q.stem, "选择正确结论。", body);
  }
});

test("combined-column answer tables keep solutions and metadata out of quick-answer text", () => {
  const source = "| 题号 | 参考答案及解析 | 题型 | 分值 | 知识点 |\n| --- | --- | --- | --- | --- |\n| 5 | C。方法：把四边形分为两个三角形。 | 单选题 | 5 | 平面几何 |\n| 16 | 【答案】$2$<br>【解析】先计算。<br>再代入 $P(A|B)$ 与 $\\|x\\|$。 | 解答题 | 15 | 概率 |";
  const plan = parsePaperImport(source, { kind: "solutions" });
  assert.deepEqual(plan.solutions[0].answer, ["C"]);
  assert.match(plan.solutions[0].analysis!, /方法：把四边形/);
  assert.equal(plan.solutions[0].type, "single");
  assert.equal(plan.solutions[0].score, 5);
  assert.deepEqual(plan.solutions[0].knowledge, ["平面几何"]);
  assert.deepEqual(plan.solutions[1].answer, ["$2$"]);
  assert.equal(plan.solutions[1].analysis, "先计算。\n再代入 $P(A|B)$ 与 $\\|x\\|$。");
  assert.equal(plan.solutions[1].score, 15);
});

test("recognized answer tables are not swallowed into the previous question analysis", () => {
  const plan = parsePaperImport("1. 【答案】C【详解】由条件可得。\n\n| 题号 | 答案 |\n| --- | --- |\n| 1 | C |\n| 2 | AB |", { kind: "solutions" });
  assert.equal(plan.solutions[0].analysis, "由条件可得。");
  assert.deepEqual(plan.solutions[1].answer, ["A", "B"]);
  assert.ok(!plan.solutions.some(entry => entry.analysis?.includes("| 题号 |")));
});

test("layout-only solution tables recognize independently numbered cells including the first row", () => {
  const plan = parsePaperImport("| 1. A【详解】一。 | 2. B【详解】二。 |\n| --- | --- |\n| 3. C。方法：三。 | 4. D。方法：四。 |", { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(entry => [entry.number, entry.answer]), [[1, ["A"]], [2, ["B"]], [3, ["C"]], [4, ["D"]]]);
  assert.deepEqual(plan.solutions.map(entry => entry.analysis), ["一。", "二。", "方法：三。", "方法：四。"]);
});

test("repeated side-by-side answer table columns each retain their own question numbers", () => {
  const plan = parsePaperImport("| 题号 | 答案及解析 | 题号 | 答案及解析 |\n| --- | --- | --- | --- |\n| 1 | A。第一题详解。 | 3 | C。第三题详解。 |\n| 2 | B。第二题详解。 | 4 | D。第四题详解。 |", { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(entry => [entry.number, entry.answer, entry.analysis]), [[1, ["A"], "第一题详解。"], [2, ["B"], "第二题详解。"], [3, ["C"], "第三题详解。"], [4, ["D"], "第四题详解。"]]);
});

test("ordinary data tables and mathematical answer expressions are not guessed as choice explanations", () => {
  const plan = parsePaperImport("1. 【解析】如下表。\n\n| 项目 | 数值 |\n| --- | --- |\n| 1. 试验 | $A+B$ |", { kind: "solutions" });
  assert.equal(plan.solutions.length, 1);
  assert.match(plan.solutions[0].analysis!, /\| 1\. 试验 \|/);
  const expression = parsePaperImport("2. 【答案】$A+B$\n【解析】是一个式子。", { kind: "solutions" }).solutions[0];
  assert.deepEqual(expression.answer, ["$A+B$"]);
  assert.equal(expression.analysis, "是一个式子。");
});

test("JSON answer blobs are separated before application just like document answer text", () => {
  const plan = parsePaperImport(JSON.stringify({ solutions: [{ number: 5, type: "single", answer: "C。方法：先作辅助线。", analysis: "再代入。" }] }), { kind: "solutions" });
  assert.deepEqual(plan.solutions[0].answer, ["C"]);
  assert.equal(plan.solutions[0].analysis, "方法：先作辅助线。\n\n再代入。");
});

test("a bold summary line separates formula answers from methods and every following proof paragraph", () => {
  const source = String.raw`## 第12题

**答案：$a_n=2^n-1$。方法：把一次递推平移为等比递推。**

由 $a_{n+1}=2a_n+1$ 得 $a_{n+1}+1=2(a_n+1)$。

于是 $a_n+1=2^n$。

## 第13题

**答案：$(3\ln2,+\infty)$。方法：先识别倒数对称。**

直接代入可得 $f(1)=0$，且

$$f(1/x)=-\ln x+a\frac{x-1}{x+1}=-f(x).$$

## 第14题

**答案：$\sqrt7$。方法：利用倍角公式。**

**保留正文加粗。** 故原式为 $\sqrt7$。`;
  const plan = parsePaperImport(source, { kind: "solutions" });
  assert.deepEqual(plan.solutions.map(entry => entry.answer), [["$a_n=2^n-1$"], ["$(3\\ln2,+\\infty)$"], ["$\\sqrt7$"]]);
  assert.equal(plan.solutions[0].analysis, "方法：把一次递推平移为等比递推。\n\n由 $a_{n+1}=2a_n+1$ 得 $a_{n+1}+1=2(a_n+1)$。\n\n于是 $a_n+1=2^n$。");
  assert.match(plan.solutions[1].analysis!, /\\\[f\(1\/x\)=-\\ln x\+a\\frac\{x-1\}\{x\+1\}=-f\(x\)\.\\\]/);
  assert.match(plan.solutions[2].analysis!, /\*\*保留正文加粗。\*\*/);
  assert.ok(plan.solutions.every(entry => !/。\*\*\n/.test(entry.analysis!)));
});

test("bold conclusion summaries populate essay answers without swallowing detailed derivations", () => {
  const source = String.raw`## 第15题

**结论：第（2）问存在，$PM/PC=1/3$；第（3）问余弦值为 $\sqrt2/4$。方法：建立坐标系。**

**（1）证明垂直。** 两向量数量积为 $0$。

## 第16题

**结论：有关联；分布列见下表，$E(X)=2$；第（3）问为 $3/5$。方法：代入统计量。**

| $X$ | $0$ | $1$ |
| --- | --- | --- |
| $P$ | $1/32$ | $7/32$ |

## 第19题

**结论：第（1）问为 $m_0/16$；第（3）问为 $[2,3]$。方法：建立乘法模型。**

因此 $\lambda\in[2,3]$。

---

题目依据：[Notion《修订稿》](https://app.notion.com/p/example)。本稿逐题计算，题号与题面保持对应。`;
  const plan = parsePaperImport(source, { kind: "solutions" });
  assert.deepEqual(plan.solutions[0].answer, ["第（2）问存在，$PM/PC=1/3$；第（3）问余弦值为 $\\sqrt2/4$"]);
  assert.deepEqual(plan.solutions[1].answer, ["有关联；分布列见下表，$E(X)=2$；第（3）问为 $3/5$"]);
  assert.match(plan.solutions[1].analysis!, /\| \$X\$ \|/);
  assert.deepEqual(plan.solutions[2].answer, ["第（1）问为 $m_0/16$；第（3）问为 $[2,3]$"]);
  assert.equal(plan.solutions[2].analysis, "方法：建立乘法模型。\n\n因此 $\\lambda\\in[2,3]$。");
  assert.ok(!JSON.stringify(plan).includes("app.notion.com"));
});

test("formula content and ordinary separators are not mistaken for field or citation boundaries", () => {
  const source = String.raw`1. **答案：$\text{方法：}x=2$。方法：按公式计算。**

推导中的公式保持原样。

---

这条分隔线后仍是解析内容。`;
  const entry = parsePaperImport(source, { kind: "solutions" }).solutions[0];
  assert.deepEqual(entry.answer, ["$\\text{方法：}x=2$"]);
  assert.match(entry.analysis!, /---\n\n这条分隔线后仍是解析内容。$/);
});
