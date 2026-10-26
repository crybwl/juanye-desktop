import test from "node:test";
import assert from "node:assert/strict";
import { defaultLayout, MM } from "../src/data";
import { paperGeometry, physicalSheets } from "../src/paper-geometry";
import { exportProject, parseProject } from "../src/documents";
import type { Exam, Layout } from "../src/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SealingStrip } from "../src/components/Paper";

const exam: Exam = { title: "排版测试", subtitle: "", duration: 120, notice: [], sections: [] };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < .001, `${a} != ${b}`);

test("legacy A4 geometry remains single-column with no reserved sealing strip", () => {
  const geometry = paperGeometry(defaultLayout);
  near(geometry.pw, 210 * MM); near(geometry.ph, 297 * MM);
  assert.equal(geometry.columns, 1); assert.equal(geometry.seal, 0); assert.equal(geometry.gutter, 0);
  near(geometry.contentWidth, (210 - 22) * MM);
  near(geometry.columnWidth, geometry.contentWidth);
});

test("A3 and 8K landscape reserve independent sealing, gap and two measured columns", () => {
  for (const [paper, width, height] of [["A3", 420, 297], ["8K", 390, 270]] as const) {
    const layout: Layout = { ...defaultLayout, paper, orientation: "landscape", columns: 2, columnGap: 8, sealLine: true, sealWidth: 18 };
    const geometry = paperGeometry(layout);
    near(geometry.pw, width * MM); near(geometry.ph, height * MM);
    near(geometry.seal, 18 * MM); near(geometry.gutter, 8 * MM);
    near(geometry.columnWidth, (width - 22 - 18 - 8) / 2 * MM);
    near(geometry.contentWidth, geometry.columnWidth * 2 + geometry.gutter);
    near(geometry.contentHeight, (height - 22) * MM - 12);
    assert.equal(geometry.columns, 2);
  }
});

test("column grouping preserves left-to-right order and explicit blank columns", () => {
  assert.deepEqual(physicalSheets([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(physicalSheets(["heading", "", "new section"], 2), [["heading", ""], ["new section"]]);
  assert.deepEqual(physicalSheets([1, 2], 1), [[1], [2]]);
  assert.deepEqual(physicalSheets([], 2), []);
});

test("new print fields roundtrip without migrating old project defaults", () => {
  const layout: Layout = { ...defaultLayout, paper: "8K", orientation: "landscape", columns: 2, columnGap: 12, sealLine: true, sealWidth: 20 };
  assert.deepEqual(parseProject(exportProject(exam, layout)).layout, layout);
  const old = parseProject(exportProject(exam, defaultLayout)).layout;
  assert.equal(old.columns, undefined); assert.equal(old.sealLine, undefined);
  for (const invalid of [{ columns: 3 }, { columnGap: 0 }, { sealLine: "yes" }, { sealWidth: 50 }]) {
    assert.throws(() => parseProject(exportProject(exam, { ...layout, ...invalid } as Layout)));
  }
});

test("sealing strip uses untransformed local SVG coordinates on every print page", () => {
  const svg = renderToStaticMarkup(createElement(SealingStrip, { width: 68, height: 1027 }));
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('data-seal-line=""'));
  for (const label of ["学校", "班级", "姓名", "考号"]) assert.ok(svg.includes(label));
  assert.equal((svg.match(/<line /g) || []).length, 5);
  assert.doesNotMatch(svg, /transform=|position:absolute|writing-mode/);
});
