import assert from "node:assert/strict";
import test from "node:test";
import { exportProject, parseProject } from "../src/documents";
import { defaultLayout, sampleExam } from "../src/data";

test("editable project preserves stable paper identity and bank revision snapshot", () => {
  const exam = structuredClone(sampleExam);
  exam.id = "exam-stable";
  exam.sections[0].questions[0].bankOrigin = { libraryId: "library-1", revisionId: "revision-2", version: 2 };
  const imported = parseProject(exportProject(exam, defaultLayout)).exam;
  assert.equal(imported.id, "exam-stable");
  assert.deepEqual(imported.sections[0].questions[0].bankOrigin, exam.sections[0].questions[0].bankOrigin);
  imported.title = "改名后的试卷";
  assert.equal(parseProject(exportProject(imported, defaultLayout)).exam.id, "exam-stable");
});

test("project rejects malformed library provenance without silently discarding it", () => {
  const exam = structuredClone(sampleExam);
  const original = { libraryId: "library", revisionId: "revision", version: 1 };
  for (const patch of [{ version: 1.5 }, { version: 0 }, { revisionId: "" }, { libraryId: "" }]) {
    exam.sections[0].questions[0].bankOrigin = { ...original, ...patch };
    assert.throws(() => parseProject(exportProject(exam, defaultLayout)), /题库来源|题库版本/);
  }
});
