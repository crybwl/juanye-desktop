import test from "node:test";
import assert from "node:assert/strict";
import type { Question } from "../src/types.ts";
import { fillQuestionOptions } from "../src/question-options.ts";
import { parseOcrResponse } from "../src/ocr.ts";

const stem = "**2.** 为研究某新品种水稻的产量，某农业科技站随机选取了 5 块面积相同的试验田，现测得其亩产量（单位：kg）分别为：$610，620，630，640，700$，则（　　）";
const options = [
  "该组数据极差为 80",
  "该组数据中位数为 630",
  "由样本数据可知，该地区所有试验田的亩产量均不超过 700 kg",
  "该组数据中，数据“700”存在较大误差，计算平均数时应舍去。",
];
const sample = `${stem}\n\n${options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n")}`;
const question = (patch: Partial<Question> = {}): Question => ({ id: "existing-local-question", type: "single", score: 5, stem: sample, options: ["", "", "", ""], answer: [], analysis: "", ...patch });

test("the user's rice question fills four empty option fields with the exact corresponding text", () => {
  const original = question();
  const filled = fillQuestionOptions(original);
  assert.equal(filled.stem, stem);
  assert.deepEqual(filled.options, options);
  assert.equal(filled.type, "single");
  assert.equal(original.stem, sample);
  assert.deepEqual(original.options, ["", "", "", ""]);
});

test("a second fill is a same-object no-op", () => {
  const filled = fillQuestionOptions(question());
  assert.strictEqual(fillQuestionOptions(filled), filled);
});

test("filling choices retains all unrelated local metadata", () => {
  const original = question({ score: 5.5, answer: ["B"], analysis: "本地解析", source: "水稻练习", knowledge: ["统计"], difficulty: "medium", sourceImage: "data:image/png;base64,TEST", figure: "data:image/png;base64,FIGURE", answerSpace: "half", pageBreakBefore: true, flag: "待核对" });
  assert.deepEqual(fillQuestionOptions(original), { ...original, stem, options });
});

test("an existing multi-choice type and selected answers remain multi-choice", () => {
  const filled = fillQuestionOptions(question({ type: "multi", answer: ["A", "B"] }));
  assert.equal(filled.type, "multi");
  assert.deepEqual(filled.answer, ["A", "B"]);
  assert.deepEqual(filled.options, options);
});

test("conflicting local nonempty choices are neither overwritten nor removed from the stem", () => {
  const original = question({ options: ["本地编辑过的A选项", "", "", ""] });
  assert.strictEqual(fillQuestionOptions(original), original);
  assert.equal(original.stem, sample);
  assert.deepEqual(original.options, ["本地编辑过的A选项", "", "", ""]);
});

test("matching existing choices are kept while empty slots are filled", () => {
  const filled = fillQuestionOptions(question({ options: [options[0], "", options[2], ""] }));
  assert.equal(filled.stem, stem);
  assert.deepEqual(filled.options, options);
});

test("a complete ABCD group plus the choice cue corrects a mislabeled essay", () => {
  const filled = fillQuestionOptions(question({ type: "essay" }));
  assert.equal(filled.type, "single");
  assert.equal(filled.stem, stem);
  assert.deepEqual(filled.options, options);
});

test("material ABCD lists do not turn into multiple-choice questions", () => {
  const list = "阅读材料并撰写分析报告。\nA. 第一段材料\nB. 第二段材料\nC. 第三段材料\nD. 第四段材料";
  for (const type of ["material", "essay"] as const) {
    const original = question({ type, stem: list, options: [] });
    assert.strictEqual(fillQuestionOptions(original), original);
  }
});

test("an empty D item leaves all original text and local fields untouched", () => {
  const original = question({ stem: `${stem}\nA. 甲\nB. 乙\nC. 丙\nD. ` });
  assert.strictEqual(fillQuestionOptions(original), original);
});

test("OCR parsing also repairs the user's sample when the model calls it an essay", () => {
  const [q] = parseOcrResponse(JSON.stringify({ type: "essay", stem: sample, options: [] }), { multiple: false });
  assert.equal(q.type, "single");
  assert.deepEqual(q.options, options);
  assert.equal(q.stem.includes("A."), false);
  assert.match(q.stem, /新品种水稻/);
  assert.match(q.stem, /610，620，630，640，700/);
  assert.deepEqual(q.answer, []);
});
