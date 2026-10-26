import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { getTelegramScheme, readSavedTelegramScheme, setTelegramScheme, TELEGRAM_SCHEME_EVENT, TELEGRAM_SCHEME_STORAGE_KEY } from "../src/telegram-scheme";

const bootstrap = fs.readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function initialize(saved: Record<string, string>, failStorage = false) {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  vm.runInNewContext(bootstrap, { document: { documentElement: root }, localStorage: {
    getItem: (key: string) => { if (failStorage) throw new Error("blocked"); return saved[key] ?? null; },
    setItem: (key: string, value: string) => { saved[key] = value; },
    removeItem: (key: string) => { delete saved[key]; },
  } });
  return root;
}

test("Telegram daylight initializes before React without changing its selected palette", () => {
  const root = initialize({ "juanye.appearance.v1": "telegram", "juanye.telegram-theme.v1": "spring", [TELEGRAM_SCHEME_STORAGE_KEY]: "light" });
  assert.equal(root.dataset.theme, "telegram"); assert.equal(root.dataset.telegramScheme, "light");
  assert.equal(root.dataset.telegramTheme, "spring"); assert.equal(root.style.colorScheme, "light");
});

test("legacy Telegram remains dark and ordinary modes do not inherit its submode", () => {
  assert.equal(initialize({ "juanye.appearance.v1": "telegram" }).style.colorScheme, "dark");
  assert.equal(initialize({ "juanye.appearance.v1": "dark", [TELEGRAM_SCHEME_STORAGE_KEY]: "light" }).style.colorScheme, "dark");
  assert.equal(initialize({ "juanye.appearance.v1": "light", [TELEGRAM_SCHEME_STORAGE_KEY]: "dark" }).style.colorScheme, "light");
  assert.equal(initialize({ "juanye.appearance.v1": "telegram", [TELEGRAM_SCHEME_STORAGE_KEY]: "sepia" }).dataset.telegramScheme, "dark");
  assert.doesNotThrow(() => initialize({}, true));
});

test("legacy glass migration retains an explicitly saved Telegram daylight preference", () => {
  const saved = { "juanye.appearance.v1": "glass", [TELEGRAM_SCHEME_STORAGE_KEY]: "light", "juanye.glass-opacity.v1": "0.4" };
  const root = initialize(saved);
  assert.equal(root.dataset.theme, "telegram"); assert.equal(root.style.colorScheme, "light");
  assert.equal(saved["juanye.appearance.v1"], "telegram"); assert.equal("juanye.glass-opacity.v1" in saved, false);
});

test("scheme changes have separate persistence, emit a change, and tolerate blocked storage", () => {
  const before = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  const root = { dataset: {} as Record<string, string> };
  const saved = new Map([["juanye.telegram-theme.v1", "frost"]]);
  const target = new EventTarget(); let events = 0;
  target.addEventListener(TELEGRAM_SCHEME_EVENT, () => events++);
  Object.assign(globalThis, { document: { documentElement: root }, window: target, localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) } });
  try {
    assert.equal(readSavedTelegramScheme(), "dark"); setTelegramScheme("light");
    assert.equal(getTelegramScheme(), "light"); assert.equal(saved.get(TELEGRAM_SCHEME_STORAGE_KEY), "light");
    assert.equal(saved.get("juanye.telegram-theme.v1"), "frost"); assert.equal(events, 1);
    Object.assign(globalThis, { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    assert.equal(readSavedTelegramScheme(), "dark"); assert.doesNotThrow(() => setTelegramScheme("dark"));
    assert.equal(getTelegramScheme(), "dark"); assert.equal(events, 2);
  } finally { Object.assign(globalThis, before); }
});
