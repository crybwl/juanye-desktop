import test from "node:test";
import assert from "node:assert/strict";
import { createBPaper } from "../src/ab-paper";
import { analyzeExam, analysisCsv } from "../src/exam-analysis";
import { parseGeneratedQuestion } from "../src/generated-question";
import type { Exam, Question } from "../src/types";
const question: Question = { id: "q1", type: "single", score: 5, stem: "已知 $f(x)=x^2$，则 $f(2)=$", options: ["$1$", "$2$", "$3$", "$4$"], answer: ["D"], analysis: "答案为D", knowledge: ["函数", "代入", "函数"], difficulty: "easy" };
const exam: Exam = { title: "测试卷", subtitle: "", duration: 120, notice: [], sections: [{ id: "s1", type: "single", title: "选择题", note: "", questions: [question] }] };

test("B paper reorders choices and remaps answers without mutating A, metadata or mathematical content", () => {
  const original = structuredClone(exam);
  for (let seed = 1; seed <= 200; seed++) {
    const result = createBPaper(exam, seed), b = result.exam.sections[0].questions[0];
    assert.notDeepEqual(b.options, question.options);
    assert.equal(b.options[b.answer[0].charCodeAt(0) - 65], "$4$");
    assert.deepEqual(b.knowledge, question.knowledge); assert.equal(b.score, 5);
    assert.match(b.flag!, /B卷/);
    assert.deepEqual(createBPaper(exam, seed), result);
  }
  assert.deepEqual(exam, original);
});
test("multi-choice remaps all correct options; unsafe position references are reported and unchanged", () => {
  const source = structuredClone(exam), q = source.sections[0].questions[0]; q.type = "multi"; q.answer = ["A", "D"];
  const b = createBPaper(source, 81).exam.sections[0].questions[0];
  assert.deepEqual(b.answer.map(value => b.options[value.charCodeAt(0) - 65]).sort(), ["$1$", "$4$"].sort());
  q.options[3] = "以上均正确";
  const unsafe = createBPaper(source, 5); assert.ok(unsafe.mappings[0].skipped); assert.deepEqual(unsafe.exam.sections[0].questions[0].options, q.options);
  q.options[3] = "$4$"; q.answer = ["Z"]; assert.ok(createBPaper(source, 2).mappings[0].skipped);
});
test("analysis conserves total points across multi-knowledge allocation and includes unset and empty cases", () => {
  const source = structuredClone(exam); source.sections[0].questions.push({ ...question, id: "q2", score: 7, knowledge: [], difficulty: undefined });
  const report = analyzeExam(source);
  assert.equal(report.totalScore, 12); assert.equal(report.count, 2);
  assert.equal(report.byKnowledge.reduce((sum, row) => sum + row.score, 0), 12);
  assert.equal(report.byKnowledge.find(row => row.name === "函数")?.score, 2.5);
  assert.equal(report.byKnowledge.find(row => row.name === "未设置")?.score, 7);
  assert.equal(report.byDifficulty.find(row => row.name === "未设置")?.count, 1);
  assert.equal(report.matrix.find(row => row.name === "函数")?.cells.single.numbers[0], 1);
  assert.equal(analyzeExam({ ...source, sections: [] }).totalScore, 0);
  source.sections[0].questions[0].source = '=HYPERLINK("bad")';
  assert.match(analysisCsv(source), /'=HYPERLINK/); assert.ok(analysisCsv(source).startsWith("\uFEFF"));
});
test("generated variant stays pending, independent, and analysis generation cannot overwrite original answers", () => {
  const variant = { ...question, stem: "求 $f(3)$", options: ["$6$", "$7$", "$8$", "$9$"], analysis: "$f(3)=9$" };
  const response = JSON.stringify({ questions: [variant] });
  const parsed = parseGeneratedQuestion(response, question, "variant");
  assert.notEqual(parsed.id, question.id); assert.match(parsed.flag!, /待核对/); assert.equal(parsed.options[3], "$9$");
  const original = structuredClone(question);
  const analysis = parseGeneratedQuestion(JSON.stringify({ questions: [{ ...variant, answer: ["A"] }] }), question, "analysis");
  assert.deepEqual(analysis.answer, question.answer); assert.equal(analysis.stem, question.stem); assert.equal(analysis.id, question.id);
  assert.deepEqual(question, original);
  assert.throws(() => parseGeneratedQuestion(JSON.stringify({ questions: [question, variant] }), question, "variant"), /一道/);
  assert.throws(() => parseGeneratedQuestion(JSON.stringify({ questions: [{ ...variant, answer: ["Z"] }] }), question, "variant"), /答案/);
  assert.throws(() => parseGeneratedQuestion(JSON.stringify({ questions: [{ ...variant, answer: ["A", "B"] }] }), question, "variant"), /只有一个/);
  assert.throws(() => parseGeneratedQuestion(JSON.stringify({ questions: [{ ...variant, options: ["$9$", "$9$"], answer: ["A"] }] }), question, "variant"), /重复/);
});
