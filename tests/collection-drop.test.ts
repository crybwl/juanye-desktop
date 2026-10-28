import test from "node:test";
import assert from "node:assert/strict";
import { planCollectionDrop } from "../src/collection-drop";
import type { BankDocument, BankEntry } from "../src/question-bank";

const entry = (id: string, libraryId = id, collectionIds: string[] = []): BankEntry => ({ id, libraryId, collectionIds, favorite: false, usageCount: 0, version: 1, contentKey: id, createdAt: "2026-10-28T00:00:00Z", origin: { examTitle: "隔离样卷", questionId: id }, question: { id, type: "single", score: 5, stem: "$1+1=$", options: ["$2$"], answer: ["A"], analysis: "" } });
const bank = (): BankDocument => ({ schema: "juanye-bank/1", revision: 1, collections: [{ id: "folder-one", name: "函数" }, { id: "folder-two", name: "错题", parentId: "folder-one" }], entries: [entry("one", "one", ["folder-one"]), entry("two"), entry("old-two", "two")] });

test("folder drop preserves other memberships and groups selected revisions by logical question", () => {
  const value = bank(), before = structuredClone(value);
  assert.deepEqual(planCollectionDrop(value, JSON.stringify(["one", "two", "old-two"]), "folder-two"), { ids: ["one", "old-two"], total: 2, already: 0, name: "错题" });
  assert.deepEqual(value, before, "Planning must not change questions, versions, usage or folder memberships");
});
test("repeated drops are idempotent and preserve already assigned questions", () => {
  assert.deepEqual(planCollectionDrop(bank(), JSON.stringify(["one", "one", "two"]), "folder-one"), { ids: ["two"], total: 2, already: 1, name: "函数" });
  assert.deepEqual(planCollectionDrop(bank(), '["one"]', "folder-one").ids, []);
});
test("unknown folders, stale IDs, trash and malformed payload reject the whole drop", () => {
  const value = bank(); value.entries[1].trashedAt = "2026-10-28T00:00:00Z";
  assert.throws(() => planCollectionDrop(value, '["one"]', "missing"), /收藏夹/);
  assert.throws(() => planCollectionDrop(value, '["one","missing"]', "folder-two"), /删除/);
  assert.throws(() => planCollectionDrop(value, '["one","two"]', "folder-two"), /回收站/);
  for (const invalid of ["{}", "[1]", "[]", "bad-json"]) assert.throws(() => planCollectionDrop(value, invalid, "folder-two"));
});
