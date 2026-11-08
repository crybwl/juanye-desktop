import { useSyncExternalStore } from "react";
import { applyTelegramThemeTokens } from "./telegram-themes";
import { getTelegramScheme, readSavedTelegramScheme, TELEGRAM_SCHEME_EVENT, TELEGRAM_SCHEME_STORAGE_KEY } from "./telegram-scheme";
import { applyAuraTokens, AURA_EVENT, AURA_STORAGE_KEY, auraTone, clearAuraTokens, reloadAura, resolveAuraScheme, watchSystemScheme } from "./aura";

/**
 * 界面模式（data-appearance）与配色主题（data-theme）分开：
 * - dark / light / telegram：两者相同；
 * - aura（晴岚）：data-theme 取浅色或深色，复用整套明暗令牌，再叠加 data-appearance="aura" 的外框与底色。
 */
export type Appearance = "dark" | "light" | "telegram" | "aura";
export const APPEARANCE_STORAGE_KEY = "juanye.appearance.v1";
const CHANGE_EVENT = "juanye:appearance";
let brand: [string, string] = ["#3e63dd", "#9eb1ff"];
let listenersInitialized = false;

const isAppearance = (value: unknown): value is Appearance => value === "dark" || value === "light" || value === "telegram" || value === "aura";

function readSavedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (value === "glass") {
      // The former transparent style has been replaced, not kept as a fourth mode.
      try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, "telegram");
        localStorage.removeItem("juanye.glass-opacity.v1");
      } catch {
        // The in-memory migration still works when storage is read-only.
      }
      return "telegram";
    }
    return isAppearance(value) ? value : "dark";
  } catch {
    // The interface remains usable if browser storage is unavailable.
    return "dark";
  }
}

function syncDesktopAppearance(): void {
  // All modes use an opaque native window; only their UI palette changes.
  const mode = getAppearance();
  const update = window.juanye?.setAppearance?.({
    mode,
    ...(mode === "telegram" ? { telegramScheme: getTelegramScheme() } : {}),
    ...(mode === "aura" ? { auraScheme: resolveAuraScheme() } : {}),
  });
  update?.then((result) => {
    document.documentElement.dataset.nativeTransparency = String(result.nativeTransparency);
  }).catch(() => {
    document.documentElement.dataset.nativeTransparency = "false";
  });
}

const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => { const [r, g, b] = hex.slice(1).match(/../g)!.map(part => channel(parseInt(part, 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** 浅色界面上的强调文字：在白底上至少 4.5:1（WCAG AA），不够就逐步压暗。 */
function readableAccent(hex: string): string {
  if (!/^#[\da-f]{6}$/i.test(hex)) return hex;
  let values = hex.slice(1).match(/../g)!.map(part => parseInt(part, 16));
  for (let i = 0; i < 12; i++) {
    const current = `#${values.map(part => part.toString(16).padStart(2, "0")).join("")}`;
    if (1.05 / (luminance(current) + 0.05) >= 4.5) return current;
    values = values.map(part => Math.round(part * 0.9));
  }
  return `#${values.map(part => part.toString(16).padStart(2, "0")).join("")}`;
}

export function getAppearance(): Appearance {
  if (typeof document === "undefined") return "dark";
  const root = document.documentElement;
  const mode = root.dataset.appearance;
  if (isAppearance(mode)) return mode;
  return isAppearance(root.dataset.theme) ? root.dataset.theme : "dark";
}

/** 当前实际是不是深色表面（晴岚按其明暗方案计算）。 */
export function isDarkSurface(): boolean {
  if (typeof document === "undefined") return true;
  const theme = document.documentElement.dataset.theme;
  return theme === "telegram" ? getTelegramScheme() !== "light" : theme !== "light";
}

export function applyAccentPalette(first: string, second: string): void {
  brand = [first, second];
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (getAppearance() === "telegram") {
    applyTelegramThemeTokens();
    root.style.setProperty("--accent-fill", "var(--tg-fill)");
    root.style.setProperty("--accent-fill-2", "var(--tg-fill-2)");
    root.style.setProperty("--color-accent", "var(--tg-accent)");
    root.style.setProperty("--color-accent-2", "var(--tg-accent-2)");
    return;
  }
  const dark = isDarkSurface();
  // 晴岚的强调色随配色走，保证与底色协调；其余模式用设置里的强调色。
  const tone = getAppearance() === "aura" ? auraTone() : undefined;
  const fill = readableAccent(tone ? tone.fill : first);
  const text = tone ? (dark ? tone.text : readableAccent(tone.text)) : (dark ? second : fill);
  // 实色填充：主按钮、选中态与勾选框都用同一色；文字色按主题保证对比度。
  root.style.setProperty("--accent-fill", fill);
  root.style.setProperty("--accent-fill-2", fill);
  root.style.setProperty("--color-accent", text);
  root.style.setProperty("--color-accent-2", text);
}

function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  root.dataset.appearance = value;
  if (value === "aura") {
    root.dataset.theme = applyAuraTokens();
  } else {
    clearAuraTokens();
    root.dataset.theme = value;
  }
  root.style.colorScheme = isDarkSurface() ? "dark" : "light";
  root.style.removeProperty("--glass-opacity");
  applyAccentPalette(...brand);
  syncDesktopAppearance();
}

/**
 * 切换外观时整页淡入淡出（View Transitions，参考 VitePress 的外观切换示例，MIT）。
 * 只在窗口有焦点、可见且用户没有要求减少动效时启用；否则直接切换，状态读取保持同步。
 */
export function withThemeTransition(update: () => void): void {
  const doc = typeof document === "undefined" ? undefined : document as Document & { startViewTransition?: (callback: () => void) => unknown };
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
    || doc?.querySelector('[data-interface-motion="reduced"]') !== null;
  if (!doc?.startViewTransition || reduced || doc.visibilityState !== "visible" || !doc.hasFocus()) { update(); return; }
  try { doc.startViewTransition(update); } catch { update(); }
}

/** Call before React renders and synchronize the opaque desktop host. */
export function initializeAppearance(): void {
  document.documentElement.dataset.telegramScheme = readSavedTelegramScheme();
  applyAppearance(readSavedAppearance());
  if (!listenersInitialized) {
    listenersInitialized = true;
    const reapply = () => applyAppearance(getAppearance());
    window.addEventListener(TELEGRAM_SCHEME_EVENT, reapply);
    window.addEventListener(AURA_EVENT, () => { if (getAppearance() === "aura") reapply(); });
    watchSystemScheme(() => { if (getAppearance() === "aura") reapply(); });
    window.addEventListener("storage", (event: StorageEvent) => {
      if (event.key === TELEGRAM_SCHEME_STORAGE_KEY || event.key === null) {
        document.documentElement.dataset.telegramScheme = readSavedTelegramScheme();
        window.dispatchEvent(new Event(TELEGRAM_SCHEME_EVENT));
      }
      if (event.key === AURA_STORAGE_KEY || event.key === null) { reloadAura(); if (getAppearance() === "aura") reapply(); }
      if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) applyAppearance(readSavedAppearance());
    });
  }
}

export function setAppearance(value: Appearance): void {
  if (!isAppearance(value)) return;
  applyAppearance(value);
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    // Applying a theme must not fail when storage is blocked or full.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const syncFromStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
    applyAppearance(readSavedAppearance());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", syncFromStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", syncFromStorage);
  };
}

export function useAppearance(): readonly [Appearance, typeof setAppearance] {
  const value = useSyncExternalStore(subscribe, getAppearance, () => "dark" as const);
  return [value, setAppearance] as const;
}
