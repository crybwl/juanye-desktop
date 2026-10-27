import test from "node:test";
import assert from "node:assert/strict";
import type { Exam, Question } from "../src/types";
import { patchWorkspaceQuestion } from "../src/workspace-edits";

function fixture(): Exam {
  const question = (id: string, type: Question["type"]): Question => ({ id, type, score: 5, stem: id, options: [], answer: [], analysis: "" });
  return { title: "缓存检查", subtitle: "", duration: 120, notice: [], sections: [
    { id: "single", type: "single", title: "选择", note: "保留", questions: [question("a", "single"), question("b", "single")] },
    { id: "essay", type: "essay", title: "解答", note: "保留", questions: [question("c", "essay")] },
    { id: "blank", type: "blank", title: "填空", note: "保留", questions: [] },
  ] };
}

test("typing changes only the edited question and its containing section", () => {
  const original = fixture();
  const next = patchWorkspaceQuestion(original, "a", { stem: "最新字符", score: 6 });
  assert.equal(next.sections[0].questions[0].stem, "最新字符");
  assert.equal(next.sections[0].questions[0].score, 6);
  assert.notStrictEqual(next.sections[0], original.sections[0]);
  assert.strictEqual(next.sections[0].questions[1], original.sections[0].questions[1]);
  assert.strictEqual(next.sections[1], original.sections[1]);
  assert.strictEqual(next.sections[2], original.sections[2]);
  assert.equal(original.sections[0].questions[0].stem, "a");
});

test("no-op edits and missing IDs retain the entire frame and avoid undo/save work", () => {
  const original = fixture();
  assert.strictEqual(patchWorkspaceQuestion(original, "missing", { stem: "ignored" }), original);
  assert.strictEqual(patchWorkspaceQuestion(original, "a", {}), original);
  assert.strictEqual(patchWorkspaceQuestion(original, "a", { stem: "a", source: undefined }), original);
});

test("changing type moves the complete question without mutating previous undo frames", () => {
  const original = fixture();
  const next = patchWorkspaceQuestion(original, "a", { type: "essay", analysis: "保留解析" });
  assert.deepEqual(next.sections[0].questions.map(question => question.id), ["b"]);
  assert.deepEqual(next.sections[1].questions.map(question => question.id), ["c", "a"]);
  assert.equal(next.sections[1].questions[1].analysis, "保留解析");
  assert.strictEqual(next.sections[1].questions[0], original.sections[1].questions[0]);
  assert.strictEqual(next.sections[2], original.sections[2]);
  assert.deepEqual(original.sections[0].questions.map(question => question.id), ["a", "b"]);
});

test("a missing target type creates the same standard section as the existing workflow", () => {
  const original = fixture();
  const next = patchWorkspaceQuestion(original, "a", { type: "multi" });
  assert.equal(next.sections.length, 4);
  assert.equal(next.sections[3].type, "multi");
  assert.equal(next.sections[3].title, "多项选择题");
  assert.equal(next.sections[3].questions[0].id, "a");
  assert.strictEqual(next.sections[1], original.sections[1]);
});
