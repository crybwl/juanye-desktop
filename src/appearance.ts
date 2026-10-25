import { useSyncExternalStore } from "react";
import { applyTelegramThemeTokens } from "./telegram-themes";

export type Appearance = "dark" | "light" | "telegram";
export const APPEARANCE_STORAGE_KEY = "juanye.appearance.v1";
const CHANGE_EVENT = "juanye:appearance";
let brand: [string, string] = ["#9db1ff", "#c4b2ff"];

const isAppearance = (value: unknown): value is Appearance => value === "dark" || value === "light" || value === "telegram";

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
  // All three themes use an opaque native window; only their UI palette changes.
  const update = window.juanye?.setAppearance?.({ mode: getAppearance() });
  update?.then((result) => {
    document.documentElement.dataset.nativeTransparency = String(result.nativeTransparency);
  }).catch(() => {
    document.documentElement.dataset.nativeTransparency = "false";
  });
}

/** Keep pastel button fills, but give accent text sufficient contrast on light surfaces. */
function readableAccent(hex: string): string {
  if (!/^#[\da-f]{6}$/i.test(hex)) return hex;
  const values = hex.slice(1).match(/../g)!.map((part) => Math.round(parseInt(part, 16) * 0.5));
  return `#${values.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export function getAppearance(): Appearance {
  if (typeof document === "undefined") return "dark";
  const theme = document.documentElement.dataset.theme;
  return isAppearance(theme) ? theme : "dark";
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
  const dark = getAppearance() === "dark";
  root.style.setProperty("--accent-fill", first);
  root.style.setProperty("--accent-fill-2", second);
  root.style.setProperty("--color-accent", dark ? first : readableAccent(first));
  root.style.setProperty("--color-accent-2", dark ? second : readableAccent(second));
}

function applyAppearance(value: Appearance): void {
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value === "light" ? "light" : "dark";
  document.documentElement.style.removeProperty("--glass-opacity");
  applyAccentPalette(...brand);
  syncDesktopAppearance();
}

/** Call before React renders and synchronize the opaque desktop host. */
export function initializeAppearance(): void {
  applyAppearance(readSavedAppearance());
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
