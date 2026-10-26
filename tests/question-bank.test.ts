import test from "node:test";
import assert from "node:assert/strict";
import type { Question } from "../src/types";
import { checkedBankDocument, cloneBankQuestions, filterBankEntries, parseBankDrag, type BankEntry } from "../src/question-bank";

const q: Question = { id: "original", type: "single", stem: "已知 $x=2$，求 $x^2$", score: 5, options: ["$1$", "$2$", "$3$", "$4$"], answer: ["D"], analysis: "$x^2=4$", source: "市统考", knowledge: ["指数", "计算"], difficulty: "easy", figures: [{ id: "fig", src: "data:image/png;base64,aGVsbG8=", layout: "right", width: 35 }], pageBreakBefore: true };
const entry = (id: string, patch: Partial<Question> = {}): BankEntry => ({ id, question: { ...q, ...patch }, origin: { examTitle: "高三模拟卷", questionId: q.id }, contentKey: "hash", createdAt: "2026-10-26T00:00:00Z", version: 1 });

test("bank filters combine question type, knowledge, difficulty, source and searchable math content", () => {
  const entries = [entry("a"), entry("b", { type: "essay", knowledge: ["函数"], difficulty: "hard", source: "教辅", stem: "函数求导" }), entry("c", { difficulty: undefined, source: undefined })];
  assert.deepEqual(filterBankEntries(entries, { type: "single", knowledge: "指数", difficulty: "easy", source: "市统考", query: "x^2" }).map(item => item.id), ["a"]);
  assert.deepEqual(filterBankEntries(entries, { difficulty: "unset", source: "高三模拟卷" }).map(item => item.id), ["c"]);
  assert.deepEqual(filterBankEntries(entries, { query: "函数", type: "single" }), []);
  assert.equal(filterBankEntries(entries, { query: "Ｘ^２" }).length, 3);
});

test("adding bank questions clones question and figure identities without losing fields or changing the source", () => {
  let sequence = 0;
  const clones = cloneBankQuestions([q], () => `new-${++sequence}`);
  assert.equal(clones[0].id, "new-1"); assert.equal(clones[0].figures?.[0].id, "new-2");
  assert.deepEqual({ ...clones[0], id: q.id, figures: q.figures }, q);
  clones[0].answer[0] = "A"; clones[0].knowledge!.push("新增");
  assert.deepEqual(q.answer, ["D"]); assert.deepEqual(q.knowledge, ["指数", "计算"]);
});

test("bank drag payload contains local IDs only, rejects malformed or oversized input and deduplicates", () => {
  assert.deepEqual(parseBankDrag('["a","b","a"]'), ["a", "b"]);
  for (const raw of ['{"stem":"html"}', 'not-json', '[]', '[null]', '[""]', JSON.stringify(Array(201).fill("a")), "x".repeat(50001)]) assert.throws(() => parseBankDrag(raw));
});

test("bank loading reuses project validation, preserves editable fields and rejects remote images", () => {
  const raw = { schema: "juanye-bank/1", revision: 1, entries: [entry("a")] };
  const loaded = checkedBankDocument(raw); assert.deepEqual(loaded.entries[0].question, q);
  assert.throws(() => checkedBankDocument({ ...raw, entries: [...raw.entries, ...raw.entries] }), /记录无效/);
  assert.throws(() => checkedBankDocument({ ...raw, entries: [entry("a", { figure: "https://example.com/picture.png" })] }), /嵌入项目/);
});
