import { useSyncExternalStore } from "react";

/**
 * 「晴岚」外观：柔和的渐变底色 + 细颗粒，只露在窗口边缘与顶栏；
 * 工作区是一张实色悬浮卡片，正文永远在不透明表面上。
 * 版式借鉴 shadcn/ui Sidebar 的 inset 变体（外框留 8px、内容卡片圆角 + 轻阴影，MIT）；
 * 渐变 + 颗粒的思路参考 Zen Browser 的工作区配色（只借概念，未复制其 MPL 代码）。
 */
export type AuraScheme = "light" | "dark" | "system";
export type ResolvedAuraScheme = "light" | "dark";
export const AURA_STORAGE_KEY = "juanye.aura.v1";
export const AURA_EVENT = "juanye:aura";

interface AuraTone { base: string; glow: [string, string, string]; fill: string; text: string }
interface AuraPalette { id: string; name: string; light: AuraTone; dark: AuraTone }

// 每套配色：底色 + 三团光晕（左上 / 右上 / 底部）+ 与之相配的强调色。
// 浅色光晕都压在 L≈88–93%、低饱和；深色光晕 L≈14–20%，保证顶栏文字对比度。
export const AURA_PALETTES: readonly AuraPalette[] = [
  {
    id: "mist", name: "晨雾",
    light: { base: "#eceff5", glow: ["#c6d4f4", "#ddd3f5", "#cbe5e2"], fill: "#3e63dd", text: "#3a5bc7" },
    dark: { base: "#101218", glow: ["#1c2847", "#272043", "#122a2b"], fill: "#3e63dd", text: "#9eb1ff" },
  },
  {
    id: "glacier", name: "冰川",
    light: { base: "#ebf2f3", glow: ["#bfe3df", "#ccdcf2", "#dbebd2"], fill: "#0d7d72", text: "#0b6e65" },
    dark: { base: "#0d1415", glow: ["#0f3230", "#142843", "#1c2b18"], fill: "#0d7d72", text: "#3fd2bd" },
  },
  {
    id: "apricot", name: "杏晴",
    light: { base: "#f4efe9", glow: ["#f3d3bb", "#f0dcc4", "#e3d8f0"], fill: "#c2410c", text: "#b23c0b" },
    dark: { base: "#15110e", glow: ["#3a2415", "#30231a", "#231e31"], fill: "#c2410c", text: "#ffa36b" },
  },
  {
    id: "dusk", name: "暮紫",
    light: { base: "#f0edf6", glow: ["#d7ccf4", "#eed0e0", "#d0daf4"], fill: "#6e56cf", text: "#5f48c0" },
    dark: { base: "#13111a", glow: ["#2a2050", "#381c32", "#1a2445"], fill: "#6e56cf", text: "#baa7ff" },
  },
  {
    id: "sage", name: "青苔",
    light: { base: "#edf1ec", glow: ["#cae3c9", "#dde7c6", "#c9e1e5"], fill: "#218358", text: "#1d7650" },
    dark: { base: "#0f1411", glow: ["#163420", "#252e19", "#102e2d"], fill: "#218358", text: "#46d495" },
  },
  {
    id: "graphite", name: "素墨",
    light: { base: "#efeff1", glow: ["#e0e1e6", "#e9e6e2", "#e1e5e9"], fill: "#41454f", text: "#41454f" },
    dark: { base: "#111113", glow: ["#1d1e22", "#211f1d", "#1b1e22"], fill: "#5b6170", text: "#c7cad1" },
  },
];
export type AuraPaletteId = string;
export const DEFAULT_AURA = Object.freeze({ palette: "mist", scheme: "system" as AuraScheme });
export interface AuraPreferences { palette: AuraPaletteId; scheme: AuraScheme }

const isScheme = (value: unknown): value is AuraScheme => value === "light" || value === "dark" || value === "system";
const isPalette = (value: unknown): value is string => AURA_PALETTES.some(palette => palette.id === value);

export function normalizeAura(value: unknown): AuraPreferences {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { palette: isPalette(candidate.palette) ? candidate.palette : DEFAULT_AURA.palette, scheme: isScheme(candidate.scheme) ? candidate.scheme : DEFAULT_AURA.scheme };
}
export function readSavedAura(): AuraPreferences {
  try { return normalizeAura(JSON.parse(localStorage.getItem(AURA_STORAGE_KEY) || "null")); }
  catch { return { ...DEFAULT_AURA }; }
}

let current = readSavedAura();
export const getAura = () => current;
const systemQuery = () => typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
export function resolveAuraScheme(preferences: AuraPreferences = current): ResolvedAuraScheme {
  if (preferences.scheme !== "system") return preferences.scheme;
  return systemQuery()?.matches === false ? "light" : "dark";
}
export const auraPalette = (id: string = current.palette) => AURA_PALETTES.find(palette => palette.id === id) ?? AURA_PALETTES[0];
export const auraTone = (preferences: AuraPreferences = current) => auraPalette(preferences.palette)[resolveAuraScheme(preferences)];

/** 极细的颗粒：固定种子生成一次（128px PNG），抹掉大面积渐变的色带，截图也稳定。 */
let noise: string | undefined;
function noiseTile(): string {
  if (noise !== undefined) return noise;
  noise = "none";
  try {
    const size = 128, canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return noise;
    const image = context.createImageData(size, size);
    let seed = 0x2f6b9d;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const value = seed >>> 24;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value > 127 ? 255 : 0;
      image.data[i + 3] = (value & 63) >> 2; // 0–15 / 255
    }
    context.putImageData(image, 0, 0);
    noise = `url("${canvas.toDataURL("image/png")}")`;
    canvas.width = canvas.height = 0;
  } catch { /* 没有颗粒也完全可用。 */ }
  return noise;
}

const AURA_PROPERTIES = ["--aura-base", "--aura-glow-1", "--aura-glow-2", "--aura-glow-3", "--aura-noise"] as const;
export function applyAuraTokens(): ResolvedAuraScheme {
  const root = document.documentElement, tone = auraTone();
  root.dataset.auraPalette = auraPalette().id;
  root.style.setProperty("--aura-base", tone.base);
  tone.glow.forEach((color, index) => root.style.setProperty(`--aura-glow-${index + 1}`, color));
  root.style.setProperty("--aura-noise", noiseTile());
  return resolveAuraScheme();
}
export function clearAuraTokens(): void {
  const root = document.documentElement;
  delete root.dataset.auraPalette;
  AURA_PROPERTIES.forEach(property => root.style.removeProperty(property));
}

export function setAura(patch: Partial<AuraPreferences>): void {
  const next = normalizeAura({ ...current, ...patch });
  if (next.palette === current.palette && next.scheme === current.scheme) return;
  current = next;
  try { localStorage.setItem(AURA_STORAGE_KEY, JSON.stringify(next)); } catch { /* 本次会话仍然生效。 */ }
  window.dispatchEvent(new Event(AURA_EVENT));
}

/** 跟随系统时，系统明暗切换要即时反映到界面。 */
export function watchSystemScheme(onChange: () => void): () => void {
  const query = systemQuery();
  if (!query) return () => {};
  const listener = () => { if (current.scheme === "system") onChange(); };
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== AURA_STORAGE_KEY && event.key !== null) return;
    current = readSavedAura();
    callback();
  };
  window.addEventListener(AURA_EVENT, callback);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(AURA_EVENT, callback); window.removeEventListener("storage", storage); };
}
const serverSnapshot = () => DEFAULT_AURA as AuraPreferences;
export function useAura(): readonly [AuraPreferences, typeof setAura] {
  return [useSyncExternalStore(subscribe, getAura, serverSnapshot), setAura] as const;
}
/** 供 storage 事件后同步内存快照（其他窗口改了配色）。 */
export function reloadAura(): void { current = readSavedAura(); }
