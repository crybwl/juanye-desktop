import test from "node:test";
import assert from "node:assert/strict";
import { AURA_PALETTES, DEFAULT_AURA, normalizeAura, resolveAuraScheme } from "./aura";

const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => { const [r, g, b] = hex.slice(1).match(/../g)!.map(part => channel(parseInt(part, 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// 与 aura.css 中顶栏文字颜色保持一致：顶栏直接坐在渐变上，光晕最浓处也要可读。
const HEADER_TEXT = { light: ["#1c2024", "#52565e", "#54575f"], dark: ["#edeef0", "#b0b4ba", "#969aa3"] } as const;
const PANEL = { light: "#ffffff", dark: "#18191b" } as const;

test("晴岚偏好：非法值回落默认，跟随系统按系统明暗解析", () => {
  assert.deepEqual(normalizeAura(null), { ...DEFAULT_AURA });
  assert.deepEqual(normalizeAura({ palette: "nope", scheme: "sepia" }), { ...DEFAULT_AURA });
  assert.deepEqual(normalizeAura({ palette: "sage", scheme: "light" }), { palette: "sage", scheme: "light" });
  assert.equal(resolveAuraScheme({ palette: "mist", scheme: "dark" }), "dark");
  assert.equal(resolveAuraScheme({ palette: "mist", scheme: "light" }), "light");
  // 没有 matchMedia（例如测试环境）时跟随系统按深色处理，与应用默认深色一致。
  assert.equal(resolveAuraScheme({ palette: "mist", scheme: "system" }), "dark");
});

test("晴岚配色：顶栏文字在底色与每团光晕上都 ≥ 4.5:1", () => {
  assert.equal(new Set(AURA_PALETTES.map(palette => palette.id)).size, AURA_PALETTES.length);
  for (const palette of AURA_PALETTES) for (const scheme of ["light", "dark"] as const) {
    const tone = palette[scheme];
    for (const surface of [tone.base, ...tone.glow]) for (const text of HEADER_TEXT[scheme]) {
      assert.ok(contrast(text, surface) >= 4.5, `${palette.name} ${scheme}: ${text} on ${surface} = ${contrast(text, surface).toFixed(2)}`);
    }
  }
});

test("晴岚配色：主按钮白字与强调文字都达到 AA", () => {
  for (const palette of AURA_PALETTES) for (const scheme of ["light", "dark"] as const) {
    const tone = palette[scheme];
    assert.ok(contrast("#ffffff", tone.fill) >= 4.5, `${palette.name} ${scheme}: button ${tone.fill}`);
    assert.ok(contrast(tone.text, PANEL[scheme]) >= 4.5, `${palette.name} ${scheme}: accent text ${tone.text} on panel`);
    if (scheme === "light") assert.ok(contrast(tone.text, tone.base) >= 4.5, `${palette.name}: accent text on frame`);
  }
});
