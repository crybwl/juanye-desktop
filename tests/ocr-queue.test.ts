import test from "node:test";
import assert from "node:assert/strict";
import { OrderedOcrImports, pendingOcrPages, removeOcrPage } from "../src/ocr-queue.ts";

function fixture(limit = 30) {
  let items: { id: string; status: string }[] = [];
  let pending = 0;
  const queue = new OrderedOcrImports<typeof items[number]>({ limit, count: () => items.length, append: (next) => { items = [...items, ...next]; }, onPending: (count) => { pending = count; } });
  return { queue, get items() { return items; }, get pending() { return pending; }, remove(id: string) { items = removeOcrPage(items, id); } };
}
const page = (id: string) => ({ id, status: "ready" });

test("rapid pasted imports append in action order and keep existing pages", async () => {
  const state = fixture();
  await state.queue.enqueue(async () => [page("existing")]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow = state.queue.enqueue(async () => { await gate; return [page("first")]; });
  let secondRead = false;
  const fast = state.queue.enqueue(async () => { secondRead = true; return [page("second")]; });
  assert.equal(state.pending, 2);
  await Promise.resolve();
  assert.equal(secondRead, false);
  release();
  await Promise.all([slow, fast]);
  assert.deepEqual(state.items.map((item) => item.id), ["existing", "first", "second"]);
  assert.equal(state.pending, 0);
});

test("failed import preserves old pages and later imports still work", async () => {
  const state = fixture();
  await state.queue.enqueue(async () => [page("old")]);
  const fail = state.queue.enqueue(async () => { throw new Error("bad image"); });
  const next = state.queue.enqueue(async () => [page("next")]);
  await assert.rejects(fail, /bad image/);
  await next;
  assert.deepEqual(state.items.map((item) => item.id), ["old", "next"]);
});

test("30 page cap includes all previous imports and deletion frees capacity", async () => {
  const state = fixture();
  await state.queue.enqueue(async (remaining) => { assert.equal(remaining, 30); return Array.from({ length: 29 }, (_, i) => page(String(i))); });
  await assert.rejects(state.queue.enqueue(async (remaining) => { assert.equal(remaining, 1); return [page("overflow1"), page("overflow2")]; }), /30/);
  assert.equal(state.items.length, 29);
  await state.queue.enqueue(async () => [page("last")]);
  let read = false;
  await assert.rejects(state.queue.enqueue(async () => { read = true; return [page("extra")]; }), /30/);
  assert.equal(read, false);
  state.remove("10");
  await state.queue.enqueue(async () => [page("replacement")]);
  assert.equal(state.items.length, 30);
  assert.equal(state.items.some((item) => item.id === "10"), false);
});

test("closing an import session prevents stale reads from entering a reopened dialog", async () => {
  const state = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const old = state.queue.enqueue(async () => { await gate; return [page("stale")]; });
  await Promise.resolve();
  state.queue.reset();
  await state.queue.enqueue(async () => [page("new session")]);
  release();
  await old;
  assert.deepEqual(state.items.map((item) => item.id), ["new session"]);
  assert.equal(state.pending, 0);
});

test("continue and explicit retries never request successful or running pages", () => {
  const items = [page("ready"), { id: "done", status: "done" }, { id: "running", status: "running" }, { id: "failed", status: "error" }];
  assert.deepEqual(pendingOcrPages(items).map((item) => item.id), ["ready", "failed"]);
  assert.deepEqual(pendingOcrPages(items, ["done", "failed"]).map((item) => item.id), ["failed"]);
});
