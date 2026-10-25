import test from "node:test";
import assert from "node:assert/strict";
import { previewScale, previewPageAt, PREVIEW_PAGE_GAP, PREVIEW_PADDING } from "../src/preview-geometry";

test("preview scale retains the existing fit, minimum, mode cap and zoom behavior", () => {
  assert.equal(previewScale(564, 1000, 1, 1), 0.5);
  assert.equal(previewScale(0, 1000, 1, 1), 0.15);
  assert.equal(previewScale(2064, 1000, 1.05, 2), 2.1);
});
test("page tracking uses fixed scaled geometry instead of measuring every page", () => {
  for (const scale of [0.15, 0.5, 1, 2.5]) {
    for (let i = 0; i < 1000; i++) {
      const top = PREVIEW_PADDING + i * (1000 * scale + PREVIEW_PAGE_GAP);
      assert.equal(previewPageAt(top + 1, 0, 1000, scale, 1000), i + 1);
    }
  }
  assert.equal(previewPageAt(-500, 0, 1000, 1, 10), 1);
  assert.equal(previewPageAt(100000, 800, 1000, 1, 10), 10);
  assert.equal(previewPageAt(0, 800, 1000, 1, 0), 1);
});
