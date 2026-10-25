import test from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { StringLruCache } from "../src/string-lru";
import { renderMathText } from "../src/math";

test("LRU evicts only the oldest unneeded entry and touches cache hits", () => {
  const cache = new StringLruCache(3, 1000);
  cache.set("a", "1"); cache.set("b", "2"); cache.set("c", "3");
  assert.equal(cache.get("a"), "1");
  cache.set("d", "4");
  assert.equal(cache.size, 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "1");
  assert.equal(cache.get("c"), "3");
});

test("LRU respects both UTF-16 payload and entry budgets, including replacements", () => {
  const cache = new StringLruCache(100, 20);
  cache.set("a", "1234"); cache.set("b", "5678");
  assert.equal(cache.payloadBytes, 20);
  cache.set("c", "90");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "5678");
  assert.equal(cache.payloadBytes, 16);
  cache.set("b", "1"); assert.equal(cache.payloadBytes, 10);
  cache.set("huge", "x".repeat(50));
  assert.equal(cache.get("huge"), undefined);
  assert.equal(cache.payloadBytes, 10);
  cache.set("c", "x".repeat(50));
  assert.equal(cache.get("c"), undefined);
  assert.equal(cache.payloadBytes, 4);
  cache.set("", ""); assert.equal(cache.get(""), "");
});

test("identical formulas across different questions reuse KaTeX without changing output modes", () => {
  const original = katex.renderToString;
  let calls = 0;
  katex.renderToString = (formula, options) => { calls++; return original(formula, options); };
  try {
    const formula = String.raw`\frac{x_{987654321}+\sqrt{7}}{2}`;
    const inline = original(formula, { throwOnError: false, displayMode: false, strict: "ignore", trust: false, maxExpand: 1000, maxSize: 20, output: "htmlAndMathml" });
    for (let i = 0; i < 100; i++) assert.equal(renderMathText(`缓存样例 ${i}：$${formula}$`), `缓存样例 ${i}：${inline}`);
    assert.equal(calls, 1, "The same expression should be parsed once, not once per surrounding question");
    const display = renderMathText(`展示：\\[${formula}\\]`);
    assert.ok(display.includes('class="katex-display"'));
    assert.equal(calls, 2, "Inline and display formulas must have independent cache keys");
    assert.equal(renderMathText(`展示：\\[${formula}\\]`), display);
    assert.equal(calls, 2, "Repeated whole text should bypass formula parsing too");
  } finally { katex.renderToString = original; }
});

test("large working sets no longer clear a recently reused formula every 800 texts", () => {
  const original = katex.renderToString;
  let calls = 0;
  katex.renderToString = (formula, options) => { calls++; return original(formula, options); };
  try {
    for (let i = 0; i < 1000; i++) renderMathText(`跨题大卷 ${i}：$y_{765432198}=x^2+1$`);
    assert.equal(calls, 1);
  } finally { katex.renderToString = original; }
});
