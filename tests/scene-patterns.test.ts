import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createScenePatternSvg, DEFAULT_SCENE_PREFERENCES, normalizeScenePreferences, SCENE_PATTERNS } from "../src/scene-patterns";
import { getScenePreferences, initializeScenePreferences, readSavedScenePreferences, SCENE_PREFERENCES_EVENT, SCENE_PREFERENCES_STORAGE_KEY, setScenePreferences, subscribeScenePreferences } from "../src/scene-preferences";

const source = fs.readFileSync(new URL("../src/assets/telegram-doodles-workspace.svg", import.meta.url), "utf8");
const definitions = source.match(/<defs>([\s\S]*?)<\/defs>/)![1];
const colors = { primary: "#8099bb", secondary: "#b5a6d1" };
const svg = (patch = {}) => createScenePatternSvg({ ...DEFAULT_SCENE_PREFERENCES, ...patch }, colors, definitions);
const artwork = (value: string) => value.split("</defs>")[1];

test("six distinct complete offline vector backgrounds have deterministic local references", () => {
  assert.equal(SCENE_PATTERNS.length, 6);
  const artworks = new Set<string>();
  for (const pattern of SCENE_PATTERNS) {
    const image = svg({ pattern: pattern.id });
    assert.equal(image, svg({ pattern: pattern.id }));
    assert.match(image, /viewBox="0 0 1440 1000"/);
    assert.doesNotMatch(image, /<script|<image|<foreignObject|(?:href|src)="https?:/i);
    const ids = new Set([...image.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const ref of image.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(ref[1]), `${pattern.id}: missing ${ref[1]}`);
    artworks.add(artwork(image));
  }
  assert.equal(artworks.size, 6, "Pattern choices must not be palette aliases of one drawing");
  const vocabulary = new Set([...artwork(svg()).matchAll(/href="#([^"]+)"/g)].map(match => match[1]));
  assert.ok(vocabulary.size >= 30, `Expanded study vocabulary only has ${vocabulary.size} motifs`);
  assert.ok([...artwork(svg()).matchAll(/<use\b/g)].length >= 96);
});

test("size and density affect actual art; defaults enlarge and enrich the former sparse wallpaper", () => {
  assert.deepEqual(DEFAULT_SCENE_PREFERENCES, { pattern: "study", size: "large", density: "rich" });
  const sparse = svg({ density: "sparse" }), balanced = svg({ density: "balanced" }), rich = svg({ density: "rich" });
  const count = (value: string) => [...artwork(value).matchAll(/<use\b/g)].length;
  assert.ok(count(sparse) < count(balanced) && count(balanced) < count(rich));
  assert.notEqual(svg({ size: "small" }), svg({ size: "large" }));
  assert.notEqual(svg({ pattern: "lattice", size: "small" }), svg({ pattern: "lattice", size: "large" }));
  assert.notEqual(svg({ pattern: "contours", density: "sparse" }), svg({ pattern: "contours", density: "rich" }));
  const preview = createScenePatternSvg(DEFAULT_SCENE_PREFERENCES, colors, definitions, true);
  assert.match(preview, /viewBox="0 0 500 300"/);
});

test("invalid preferences and colors cannot introduce arbitrary SVG content", () => {
  assert.deepEqual(normalizeScenePreferences(null), DEFAULT_SCENE_PREFERENCES);
  assert.deepEqual(normalizeScenePreferences({ pattern: "<script>", size: 3, density: { toString: () => "rich" } }), DEFAULT_SCENE_PREFERENCES);
  const image = createScenePatternSvg(DEFAULT_SCENE_PREFERENCES, { primary: '\"><script>bad()</script>', secondary: "url(https://invalid/)" }, definitions);
  assert.doesNotMatch(image, /bad\(|https:\/\/invalid|<script/);
  assert.match(image, /#8da4b4/);
});

test("background preference persistence is separate from paper, theme and keys and tolerates blocked storage", () => {
  const previous = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
  const target = new EventTarget(), root = { dataset: {} as Record<string, string> }, saved = new Map<string, string>([["juanye.telegram-theme.v1", "spring"]]);
  Object.assign(globalThis, { document: { documentElement: root }, window: target, localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) } });
  const original = getScenePreferences();
  try {
    let notifications = 0; target.addEventListener(SCENE_PREFERENCES_EVENT, () => notifications++);
    initializeScenePreferences();
    const a = subscribeScenePreferences(() => notifications++), b = subscribeScenePreferences(() => notifications++);
    setScenePreferences({ pattern: "cosmos", density: "balanced" });
    assert.equal(getScenePreferences().pattern, "cosmos"); assert.equal(root.dataset.scenePattern, "cosmos"); assert.equal(root.dataset.sceneDensity, "balanced");
    assert.equal(saved.get("juanye.telegram-theme.v1"), "spring"); assert.equal(saved.size, 2);
    assert.equal(readSavedScenePreferences().pattern, "cosmos"); assert.equal(notifications, 3);
    saved.set(SCENE_PREFERENCES_STORAGE_KEY, JSON.stringify({ pattern: "botanical", size: "small", density: "sparse" }));
    const event = Object.assign(new Event("storage"), { key: SCENE_PREFERENCES_STORAGE_KEY }); target.dispatchEvent(event);
    assert.equal(getScenePreferences().pattern, "botanical"); assert.equal(notifications, 5, "All storage observers must receive the update");
    a(); b();
    Object.assign(globalThis, { localStorage: { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } } });
    assert.deepEqual(readSavedScenePreferences(), DEFAULT_SCENE_PREFERENCES);
    assert.doesNotThrow(() => setScenePreferences({ pattern: "contours" }));
    assert.equal(getScenePreferences().pattern, "contours");
  } finally { setScenePreferences(original); Object.assign(globalThis, previous); }
});
