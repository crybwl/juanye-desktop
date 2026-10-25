import test from "node:test";
import assert from "node:assert/strict";
import type { Exam } from "../src/types";
import { applySolutionMatches, matchSolutions, solutionPatch } from "../src/import-application";
import { parsePaperImport } from "../src/paper-import";
import { exportMarkdown } from "../src/markdown-export";
import { exportProject, parseProject } from "../src/documents";
import { defaultLayout } from "../src/data";

const copy = (): Exam => ({ title: "测试卷", subtitle: "", duration: 90, notice: [], sections: [{ id: "s", title: "单选题", type: "single", note: "", questions: [
  { id: "q16", importNumber: 16, type: "single", score: 8, stem: "原题干", options: ["甲", "乙", "丙", "丁"], answer: ["A"], analysis: "本地解析" },
  { id: "q17", importNumber: 17, type: "essay", score: 15, stem: "求值。", options: [], answer: [], analysis: "", paperAnswerSpace: "quarter", answerSpace: "full" },
] }] });

test("solution matching uses recorded source numbers without changing unmatched questions", () => {
  const exam = copy();
  const plan = parsePaperImport("17. 答案：$2$\n解析：得 $2$。\n99. 答案：B", { kind: "solutions" });
  const matches = matchSolutions(exam, plan.solutions);
  assert.equal(matches[0].target?.id, "q17"); assert.match(matches[1].reason!, /未匹配/);
  const result = applySolutionMatches(exam, matches, new Set([0]));
  assert.equal(result.applied, 1); assert.equal(result.exam.sections[0].questions.length, 2);
  assert.deepEqual(result.exam.sections[0].questions[1].answer, ["$2$"]);
  assert.equal(result.exam.sections[0].questions[1].stem, "求值。");
  assert.deepEqual(exam.sections[0].questions[1].answer, []);
});

test("conflicts require permission and provided fields do not erase other editor data", () => {
  const exam = copy(), matches = matchSolutions(exam, [{ number: 16, answer: ["B"], analysis: "新解析", source: "来源", knowledge: ["概率"] }]);
  assert.ok(matches[0].conflicts.includes("answer"));
  assert.equal(applySolutionMatches(exam, matches, new Set([0])).exam, exam);
  const changed = applySolutionMatches(exam, matches, new Set([0]), true).exam.sections[0].questions[0];
  assert.equal(changed.id, "q16"); assert.equal(changed.stem, "原题干"); assert.equal(changed.score, 8);
  assert.deepEqual(changed.options, exam.sections[0].questions[0].options);
  assert.deepEqual(changed.answer, ["B"]); assert.equal(changed.source, "来源");
});

test("duplicate target source numbers must be disambiguated explicitly", () => {
  const exam = copy(); exam.sections[0].questions[1].importNumber = 16;
  const entries = [{ number: 16, analysis: "解析" }];
  assert.match(matchSolutions(exam, entries)[0].reason!, /重复/);
  assert.equal(matchSolutions(exam, entries, { 0: "q17" })[0].target?.id, "q17");
});

test("Markdown identity survives reordered papers when importing solutions separately", () => {
  const exam = copy();
  const md = exportMarkdown(exam);
  exam.sections[0].questions.reverse();
  const entries = parsePaperImport(md, { kind: "solutions" }).solutions;
  const matches = matchSolutions(exam, entries);
  assert.ok(matches.some(match => match.target?.id === "q16" && match.entry.analysis === "本地解析"));
  assert.equal(entries.find(entry => entry.questionId === "q16")?.analysis, "本地解析");
});

test("Markdown preserves four empty or partially edited option fields without moving them into the stem", () => {
  for (const options of [["", "", "", ""], ["甲\n续行", "", "$3$", ""]]) {
    const exam = copy(); exam.sections[0].questions[0].options = options;
    const imported = parsePaperImport(exportMarkdown(exam), { kind: "annotated", placement: "after" }).questions[0].question;
    assert.deepEqual(imported.options, options); assert.equal(imported.stem, "原题干");
  }
});

test("metadata-only solution fields are whitelisted and do not clear meaningful values", () => {
  assert.deepEqual(solutionPatch({ number: 16, analysis: "", answer: [], pageBreakBefore: false, paperAnswerSpace: "quarter" }), { pageBreakBefore: false, paperAnswerSpace: "quarter" });
});

test("project persistence retains original numbers and both independent spaces", () => {
  const exam = copy(), layout = { ...defaultLayout, paperMode: "integrated" as const };
  const imported = parseProject(exportProject(exam, layout));
  assert.deepEqual(imported.exam, exam); assert.deepEqual(imported.layout, layout);
});

test("combined answer-table prose is applied to the actual answer and analysis fields", () => {
  const exam = copy();
  const plan = parsePaperImport("| 题号 | 答案与解析 |\n| --- | --- |\n| 16 | C。方法：先作辅助线，再计算。 |\n| 17 | 【答案】$2$<br>【解析】代入得 $2$。 |", { kind: "solutions" });
  const changed = applySolutionMatches(exam, matchSolutions(exam, plan.solutions), new Set([0, 1]), true).exam;
  assert.deepEqual(changed.sections[0].questions[0].answer, ["C"]);
  assert.equal(changed.sections[0].questions[0].analysis, "方法：先作辅助线，再计算。");
  assert.equal(changed.sections[0].questions[0].stem, "原题干");
  assert.deepEqual(changed.sections[0].questions[1].answer, ["$2$"]);
  assert.equal(changed.sections[0].questions[1].analysis, "代入得 $2$。");
  const roundTrip = parseProject(exportProject(changed, defaultLayout));
  assert.deepEqual(roundTrip.exam, changed);
});
