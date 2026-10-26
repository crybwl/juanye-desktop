import test from "node:test";
import assert from "node:assert/strict";
import type { Question } from "../src/types";
import { checkedBankDocument, cloneBankEntries, cloneBankQuestions, filterBankEntries, latestBankEntries, sortBankEntries, type BankDocument, type BankEntry } from "../src/question-bank";

const question: Question = { id: "original", type: "essay", score: 8, stem: "计算 $x^2$", options: [], answer: ["4"], analysis: "$2^2=4$", knowledge: ["指数"], figures: [{ id: "image", src: "data:image/png;base64,aGVsbG8=", layout: "half" }] };
const entry = (id: string, patch: Partial<BankEntry> = {}): BankEntry => ({ id, libraryId: id, question: structuredClone(question), origin: { examTitle: "A卷", examId: "exam-stable", questionId: question.id }, contentKey: `hash-${id}`, createdAt: "2026-10-24T00:00:00Z", version: 1, favorite: false, collectionIds: [], usageCount: 0, ...patch });
const document = (entries: BankEntry[]): BankDocument => ({ schema: "juanye-bank/1", revision: 1, entries, collections: [{ id: "folder", name: "函数题集" }] });

test("legacy frontend validation derives one logical library for unsorted revision chains", () => {
  const root = { id: "root", question, origin: { examTitle: "A卷", questionId: question.id }, contentKey: "hash-root", createdAt: "2026-10-20", version: 1 };
  const raw = { schema: "juanye-bank/1", revision: 4, entries: [{ ...root, id: "next", version: 2, previousVersionId: "root" }, root] };
  const loaded = checkedBankDocument(raw);
  assert.deepEqual(loaded.collections, []);
  assert.deepEqual(loaded.entries.map(item => [item.libraryId, item.favorite, item.collectionIds, item.usageCount]), [["root", false, [], 0], ["root", false, [], 0]]);
  assert.deepEqual(latestBankEntries(loaded.entries).map(item => item.id), ["next"]);
  assert.equal(Object.hasOwn(raw, "collections"), false);
});

test("frontend validation preserves all new collection, provenance and library metadata", () => {
  const item = entry("revision", { libraryId: "logical", favorite: true, collectionIds: ["folder"], usageCount: 7, lastUsedAt: "2026-10-24T02:00:00Z", trashedAt: "2026-10-25T02:00:00Z", question: { ...question, bankOrigin: { libraryId: "source-library", revisionId: "source-revision", version: 3 } } });
  const raw = document([item]); raw.collections.push({ id: "child", name: "子题集", parentId: "folder" });
  assert.deepEqual(checkedBankDocument(raw), raw);
});

test("frontend validation rejects malformed collection graphs and conflicting logical metadata", () => {
  const raw = document([entry("one")]);
  assert.throws(() => checkedBankDocument({ ...raw, collections: [{ id: "folder", name: "循环", parentId: "folder" }] }), /层级/);
  assert.throws(() => checkedBankDocument(document([entry("one", { collectionIds: ["unknown"] })])), /元数据/);
  assert.throws(() => checkedBankDocument(document([entry("one", { favorite: "yes" as unknown as boolean })])), /元数据/);
  assert.throws(() => checkedBankDocument(document([entry("one", { usageCount: -1 })])), /元数据/);
  assert.throws(() => checkedBankDocument(document([entry("one", { lastUsedAt: "not-a-time" })])), /元数据/);
  const root = entry("root"), next = entry("next", { libraryId: root.libraryId, version: 2, previousVersionId: root.id, favorite: true });
  assert.throws(() => checkedBankDocument(document([root, next])), /元数据不一致/);
  assert.throws(() => checkedBankDocument(document([entry("cycle", { previousVersionId: "cycle" })])), /循环/);
  assert.throws(() => checkedBankDocument(document([root, entry("wrong", { previousVersionId: root.id, version: 2 })])), /版本链/);
});

test("filters show latest visible libraries and combine favorites, collections, review and trash", () => {
  const root = entry("root", { libraryId: "one", favorite: true, collectionIds: ["folder"] });
  const next = entry("next", { libraryId: "one", previousVersionId: root.id, version: 2, favorite: true, collectionIds: ["folder"], question: { ...question, flag: "待核对公式" } });
  const trashed = entry("trash", { favorite: true, collectionIds: ["folder"], trashedAt: "2026-10-25T00:00:00Z" });
  const entries = [root, next, trashed, entry("other")];
  assert.deepEqual(filterBankEntries(entries, {}).map(item => item.id), ["next", "other"]);
  assert.deepEqual(filterBankEntries(entries, { favorite: true, collectionId: "folder", review: true, query: "x^2" }).map(item => item.id), ["next"]);
  assert.deepEqual(filterBankEntries(entries, { trashed: true }).map(item => item.id), ["trash"]);
  assert.deepEqual(filterBankEntries(entries, { favorite: false, review: false }).map(item => item.id), ["other"]);
});

test("library sorting is deterministic and never mutates the input list", () => {
  const entries = [entry("old-used", { usageCount: 4, createdAt: "2026-10-20" }), entry("new", { createdAt: "2026-10-25" }), entry("high-score", { question: { ...question, score: 20 }, createdAt: "2026-10-22" })];
  assert.deepEqual(sortBankEntries(entries, "recent").map(item => item.id), ["new", "high-score", "old-used"]);
  assert.deepEqual(sortBankEntries(entries, "used").map(item => item.id), ["old-used", "new", "high-score"]);
  assert.deepEqual(sortBankEntries(entries, "score").map(item => item.id), ["high-score", "new", "old-used"]);
  assert.deepEqual(entries.map(item => item.id), ["old-used", "new", "high-score"]);
});

test("entry cloning explicitly stamps provenance while the old question-clone helper does not invent it", () => {
  const original = entry("revision-3", { libraryId: "logical", version: 3 }); let sequence = 0;
  const cloned = cloneBankEntries([original], () => `clone-${++sequence}`)[0];
  assert.equal(cloned.id, "clone-1"); assert.equal(cloned.figures![0].id, "clone-2");
  assert.deepEqual(cloned.bankOrigin, { libraryId: "logical", revisionId: "revision-3", version: 3 });
  assert.equal(original.question.bankOrigin, undefined);
  assert.equal(cloneBankQuestions([question], () => "plain")[0].bankOrigin, undefined);
  cloned.answer[0] = "changed"; assert.deepEqual(original.question.answer, ["4"]);
});
