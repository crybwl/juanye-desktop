import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

const icon = fs.readFileSync(new URL("../src/assets/juanye-icon.svg", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/components/brand-logo.css", import.meta.url), "utf8");
const component = fs.readFileSync(new URL("../src/components/BrandLogo.tsx", import.meta.url), "utf8");
const titleBar = fs.readFileSync(new URL("../src/components/TitleBar.tsx", import.meta.url), "utf8");

test("page icon is transparent native SVG with independently animatable paper, fold and question blocks", () => {
  const doc = new DOMParser().parseFromString(icon, "image/svg+xml");
  assert.equal(doc.documentElement?.getAttribute("viewBox"), "0 0 512 512");
  assert.equal(doc.getElementsByTagName("path").length, 4);
  assert.equal(doc.getElementsByTagName("rect").length, 0, "no opaque app-icon backplate");
  assert.doesNotMatch(icon, /<image|<script|<foreignObject|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  for (const name of ["brand-page", "brand-fold", "brand-question--one", "brand-question--two"]) assert.ok(icon.includes(name));
});

test("title-bar intro reuses native artwork and static dialogs do not animate", () => {
  assert.ok(component.includes('juanye-icon.svg?raw'));
  assert.ok(component.includes('animated = false'));
  assert.ok(titleBar.includes('<Logo animated />'));
  assert.doesNotMatch(component, /setTimeout|setInterval|requestAnimationFrame|useEffect|useState/);
  assert.doesNotMatch(css, /infinite|will-change/);
  assert.match(css, /\.app-bg\[data-interface-motion="reduced"\] \.brand-logo\[data-animate="true"\]/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /animation:\s*none/);
  assert.match(css, /transition:\s*none/);
  assert.match(css, /transform:\s*none/);
});
