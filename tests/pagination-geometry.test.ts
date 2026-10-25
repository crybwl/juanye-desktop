import test from "node:test";
import assert from "node:assert/strict";
import { safePageCut, samePages, type PagePiece } from "../src/pagination-geometry";

test("cached boundaries preserve table, text-line and image cuts on continuation pages", () => {
  const guards = [{ top: 50, bottom: 180 }, { top: 180, bottom: 200 }, { top: 200, bottom: 220 }, { top: 250, bottom: 350 }];
  assert.equal(safePageCut(0, 100, guards), 50);
  assert.equal(safePageCut(180, 210, guards), 200);
  assert.equal(safePageCut(200, 300, guards), 250);
  assert.equal(safePageCut(250, 300, guards), 300, "oversized item still makes forward progress");
});

test("premeasured bounds produce identical cuts to the previous per-page loop", () => {
  const guards = Array.from({ length: 500 }, (_, i) => ({ top: i * 17.3, bottom: i * 17.3 + 18 }));
  for (let offset = 0; offset < 3000; offset += 97) {
    const target = offset + 1027;
    let reference = target;
    for (const guard of guards) if (guard.top < reference - 0.1 && guard.bottom > reference + 0.1 && guard.top > offset + 1) reference = Math.min(reference, guard.top);
    assert.equal(safePageCut(offset, target, guards), reference);
  }
});

test("page equality avoids serialized copies and includes all pagination fields", () => {
  const a: PagePiece[][] = [[{ index: 0, offset: 0, height: 100, fullHeight: 220 }], [{ index: 0, offset: 100, height: 120, fullHeight: 220 }]];
  assert.equal(samePages(a, structuredClone(a)), true);
  assert.equal(samePages(a, [a[0]]), false);
  for (const key of ["index", "offset", "height", "fullHeight"] as const) {
    const b = structuredClone(a); b[1][0][key]++;
    assert.equal(samePages(a, b), false, key);
  }
  const b = structuredClone(a); b[1][0].fillSpace = true;
  assert.equal(samePages(a, b), false);
  assert.equal(samePages([], []), true);
  assert.equal(samePages([[]], []), false);
});
