import test from "node:test";
import assert from "node:assert/strict";
import { getExperimentalWorkbench, readSavedExperimentalWorkbench, setExperimentalWorkbench, WORKBENCH_EVENT, WORKBENCH_STORAGE_KEY } from "../src/experimental-workbench";

test("experimental workbench is opt-in and ignores invalid saved values", () => {
  const before = globalThis.localStorage;
  try {
    for (const [value, expected] of [[null, false], ["false", false], ["true", true], ["1", false], ["experimental", false]] as const) {
      Object.assign(globalThis, { localStorage: { getItem: () => value } });
      assert.equal(readSavedExperimentalWorkbench(), expected);
    }
    Object.assign(globalThis, { localStorage: { getItem: () => { throw Error("blocked"); } } });
    assert.equal(readSavedExperimentalWorkbench(), false);
  } finally { Object.assign(globalThis, { localStorage: before }); }
});

test("switching the workbench changes only its independent device preference", () => {
  const before = { window: globalThis.window, localStorage: globalThis.localStorage };
  const target = new EventTarget();
  const saved = new Map([["juanye.appearance.v1", "telegram"], ["juanye.telegram-scheme.v1", "light"], ["draft", "untouched"]]);
  let changes = 0;
  target.addEventListener(WORKBENCH_EVENT, () => changes++);
  Object.assign(globalThis, { window: target, localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) } });
  try {
    setExperimentalWorkbench(true);
    assert.equal(getExperimentalWorkbench(), true);
    assert.equal(saved.get(WORKBENCH_STORAGE_KEY), "true");
    setExperimentalWorkbench(false);
    assert.equal(getExperimentalWorkbench(), false);
    assert.equal(saved.get(WORKBENCH_STORAGE_KEY), "false");
    assert.equal(saved.get("juanye.appearance.v1"), "telegram");
    assert.equal(saved.get("juanye.telegram-scheme.v1"), "light");
    assert.equal(saved.get("draft"), "untouched");
    assert.equal(changes, 2);
  } finally { Object.assign(globalThis, before); }
});

test("blocked preference storage still allows switching for the current session", () => {
  const before = { window: globalThis.window, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: new EventTarget(), localStorage: { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } } });
  try {
    assert.doesNotThrow(() => setExperimentalWorkbench(true));
    assert.equal(getExperimentalWorkbench(), true);
    assert.doesNotThrow(() => setExperimentalWorkbench(false));
    assert.equal(getExperimentalWorkbench(), false);
  } finally { Object.assign(globalThis, before); }
});
