import test from "node:test";
import assert from "node:assert/strict";
import { SidebarRowStore } from "../src/sidebar-row-store";
import type { Question } from "../src/types";
const q = (id: string): Question => ({ id, type: "single", score: 5, stem: id, options: [], answer: [], analysis: "" });
test("typing notifies only the changed immutable row, retaining every other projection snapshot", () => {
  const questions = [q("one"), q("two")], rows = questions.map((q, index) => ({ q, num: index + 1, active: index === 0, batch: false, checked: false }));
  const store = new SidebarRowStore(rows), second = store.get("two"); let firstCalls = 0, secondCalls = 0;
  store.subscribe("one", () => firstCalls++); store.subscribe("two", () => secondCalls++);
  store.update([{ ...rows[0], q: { ...questions[0], stem: "updated" } }, rows[1]]);
  assert.equal(firstCalls, 1); assert.equal(secondCalls, 0); assert.equal(store.get("two"), second);
});
test("selection and exit retention preserve only live/animating rows", () => {
  const rows = [q("one"), q("two")].map((q, index) => ({ q, num: index + 1, active: false, batch: false, checked: false }));
  const store = new SidebarRowStore(rows), stop = store.subscribe("one", () => {});
  store.update([{ ...rows[1], active: true }]); assert.ok(store.get("one")); assert.equal(store.get("two").active, true);
  stop(); assert.equal(store.get("one"), undefined);
});
test("new rows have a safe initial snapshot before commit without notifying existing rows", () => {
  const row = { q: q("one"), num: 1, active: false, batch: false, checked: false };
  const store = new SidebarRowStore([row]); let calls = 0; store.subscribe("one", () => calls++);
  const added = { ...row, q: q("two"), num: 2 };
  store.seed([{ ...row, active: true }, added]);
  assert.equal(store.get("one"), row); assert.equal(store.get("two"), added); assert.equal(calls, 0);
  store.update([{ ...row, active: true }, added]); assert.equal(calls, 1);
});
