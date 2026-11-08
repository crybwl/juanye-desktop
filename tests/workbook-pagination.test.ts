import assert from "node:assert/strict";
import test from "node:test";
import { paginate } from "../src/workbook/pagination";
import { concatRich, countBlanks, isRichEmpty, richFromPlain, richToPlain } from "../src/workbook/rich";
import { convertQuestion, createBlock, questionNumbers, sampleWorkbook, sanitizeWorkbook, type QuestionBlock } from "../src/workbook/model";

test("blocks never split and move whole to the next page", () => {
  const { placements, pages } = paginate([{ id: "a", height: 600 }, { id: "b", height: 300 }, { id: "c", height: 100 }], 800);
  assert.deepEqual(placements, [{ page: 0, top: 0 }, { page: 1, top: 0 }, { page: 1, top: 300 }]);
  assert.equal(pages, 2);
});

test("headings keep with the start of the next block", () => {
  const { placements } = paginate([{ id: "a", height: 740 }, { id: "h", height: 40, keepWithNext: true }, { id: "p", height: 200 }], 800);
  assert.equal(placements[1].page, 1);
  assert.equal(placements[2].page, 1);
});

test("stacked headings travel together", () => {
  const { placements } = paginate([{ id: "a", height: 700 }, { id: "h1", height: 40, keepWithNext: true }, { id: "h2", height: 30, keepWithNext: true }, { id: "p", height: 100 }], 800);
  assert.deepEqual(placements.slice(1).map(p => p.page), [1, 1, 1]);
});

test("page breaks start a new page but never leave an empty page", () => {
  const result = paginate([{ id: "a", height: 100 }, { id: "br", height: 8, pageBreak: true }, { id: "b", height: 100 }, { id: "br2", height: 8, pageBreak: true }], 800);
  assert.deepEqual(result.placements.map(p => p.page), [0, 0, 1, 1]);
  assert.equal(result.pages, 2);
});

test("an oversized block still gets its own page", () => {
  const { placements, pages } = paginate([{ id: "a", height: 100 }, { id: "big", height: 1200 }, { id: "c", height: 50 }], 800);
  assert.deepEqual(placements.map(p => p.page), [0, 1, 2]);
  assert.equal(pages, 3);
});

test("rich text helpers keep formulas and blanks", () => {
  const doc = richFromPlain("已知 $x^2=4$，则 x = ____");
  assert.equal(richToPlain(doc), "已知 $x^2=4$，则 x = ____");
  assert.equal(countBlanks(doc), 1);
  assert.equal(isRichEmpty(richFromPlain("  ")), true);
  assert.equal(richToPlain(concatRich(richFromPlain("甲"), richFromPlain("乙"))), "甲乙");
});

test("question numbering restarts per chapter and numbers examples separately", () => {
  const book = sampleWorkbook();
  const numbers = questionNumbers(book.blocks);
  const questions = book.blocks.filter((b): b is QuestionBlock => b.kind === "question");
  assert.equal(numbers.get(questions[0].id), 1);
  assert.deepEqual(questions.slice(1).map(q => numbers.get(q.id)), [1, 2, 3]);
  const custom = { ...questions[1], label: "拓展" };
  assert.equal(questionNumbers([custom]).has(custom.id), false);
});

test("question type conversion keeps content and trims answers", () => {
  const multi = { ...(createBlock("question", "multi") as QuestionBlock), stem: richFromPlain("题干") };
  const withAnswers = { ...multi, correct: [multi.options[0].id, multi.options[1].id] };
  const single = convertQuestion(withAnswers, "single");
  assert.equal(single.correct.length, 1);
  assert.equal(richToPlain(single.stem), "题干");
  const essay = convertQuestion(single, "essay");
  assert.equal(essay.correct.length, 1, "the hidden choice answer survives a detour through essay");
  assert.ok(essay.space > 0);
  assert.equal(convertQuestion(essay, "single").space, 0, "switching back to a choice question removes the answer space");
  assert.deepEqual(convertQuestion(essay, "single").correct, single.correct, "switching back restores the marked answer");
  assert.equal(convertQuestion({ ...essay, space: 0 }, "essay").space, 0, "an essay keeps a deliberately removed space");
});

test("stored workbooks are validated", () => {
  assert.equal(sanitizeWorkbook({ version: 2 }), null);
  const restored = sanitizeWorkbook(JSON.parse(JSON.stringify(sampleWorkbook())));
  assert.ok(restored && restored.blocks.length > 5);
  const broken = sanitizeWorkbook({ version: 1, blocks: [{ id: "x", kind: "text", text: null }, { kind: "text" }, { id: "y", kind: "unknown" }] });
  assert.equal(broken?.blocks.length, 1);
  assert.equal(isRichEmpty((broken?.blocks[0] as { text: never }).text), true);
});
