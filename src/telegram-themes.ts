import { useSyncExternalStore } from "react";
import studyPattern from "./assets/telegram-doodles-study.svg?raw";
import naturePattern from "./assets/telegram-doodles-nature.svg?raw";
import orbitPattern from "./assets/telegram-doodles-orbit.svg?raw";
import workspacePattern from "./assets/telegram-doodles-workspace.svg?raw";

export const TELEGRAM_THEME_STORAGE_KEY = "juanye.telegram-theme.v1";
const CHANGE_EVENT = "juanye:telegram-theme";
const definitions = [
  { id: "ocean", name: "海蓝", emoji: "🏠", accent: "#85c4ed", accent2: "#a3b8ed", fill: ["#126da8", "#2368a0"], ink: ["#5f88b9", "#888ac1"], pattern: orbitPattern },
  { id: "spring", name: "春芽", emoji: "🌱", accent: "#b0d58d", accent2: "#8cc6a0", fill: ["#35784b", "#526f2f"], ink: ["#8ca961", "#6f9a7d"], pattern: naturePattern },
  { id: "frost", name: "霜雪", emoji: "❄️", accent: "#98c8e0", accent2: "#b1bce4", fill: ["#356c86", "#4d5b9b"], ink: ["#79aab6", "#8a99bf"], pattern: naturePattern },
  { id: "gem", name: "宝石", emoji: "💎", accent: "#b1b4ef", accent2: "#8cc9d1", fill: ["#51469b", "#227789"], ink: ["#8d78bd", "#6e9dbb"], pattern: orbitPattern },
  { id: "classroom", name: "课堂", emoji: "📐", accent: "#9acbb1", accent2: "#87becb", fill: ["#37694b", "#25626d"], ink: ["#78a982", "#629eaa"], pattern: studyPattern },
  { id: "blossom", name: "花语", emoji: "🌷", accent: "#e3abb9", accent2: "#d8aad8", fill: ["#99514a", "#83467b"], ink: ["#bd9379", "#b17ba3"], pattern: naturePattern },
  { id: "dusk", name: "暮紫", emoji: "💜", accent: "#c9b0e8", accent2: "#d7a4c4", fill: ["#835478", "#51478b"], ink: ["#b19c8d", "#a18ac0"], pattern: orbitPattern },
  { id: "ember", name: "暖橙", emoji: "🍂", accent: "#ecb985", accent2: "#e4a28d", fill: ["#9a6330", "#a84d3c"], ink: ["#af9b66", "#b98164"], pattern: naturePattern },
  { id: "neon", name: "霓虹", emoji: "🎮", accent: "#cfadf5", accent2: "#f0b27d", fill: ["#7f39ab", "#a65c22"], ink: ["#a07fc1", "#789cba"], pattern: studyPattern },
] as const;
export type TelegramThemeId = typeof definitions[number]["id"];
export const DEFAULT_TELEGRAM_THEME: TelegramThemeId = "ember";
export const TELEGRAM_THEMES = definitions.map(theme => ({
  ...theme,
  wallpaper: `url("data:image/svg+xml,${encodeURIComponent(theme.pattern.replaceAll("#8da4b4", theme.ink[0]).replaceAll("#c7b092", theme.ink[1]))}")`,
  workspaceWallpaper: `url("data:image/svg+xml,${encodeURIComponent(workspacePattern.replaceAll("#8da4b4", theme.accent).replaceAll("#c7b092", theme.accent2))}")`,
}));
const isTheme = (value: unknown): value is TelegramThemeId => TELEGRAM_THEMES.some(theme => theme.id === value);
const readSaved = (): TelegramThemeId => {
  try { const value = localStorage.getItem(TELEGRAM_THEME_STORAGE_KEY); return isTheme(value) ? value : DEFAULT_TELEGRAM_THEME; }
  catch { return DEFAULT_TELEGRAM_THEME; }
};
export function getTelegramTheme(): TelegramThemeId {
  if (typeof document === "undefined") return DEFAULT_TELEGRAM_THEME;
  const value = document.documentElement.dataset.telegramTheme;
  return isTheme(value) ? value : readSaved();
}
export function applyTelegramThemeTokens(id: TelegramThemeId = getTelegramTheme()): void {
  if (typeof document === "undefined") return;
  const theme = TELEGRAM_THEMES.find(theme => theme.id === id) ?? TELEGRAM_THEMES[7];
  const root = document.documentElement;
  root.dataset.telegramTheme = theme.id;
  root.style.setProperty("--tg-accent", theme.accent);
  root.style.setProperty("--tg-accent-2", theme.accent2);
  root.style.setProperty("--tg-fill", theme.fill[0]);
  root.style.setProperty("--tg-fill-2", theme.fill[1]);
  root.style.setProperty("--tg-wallpaper", theme.wallpaper);
  root.style.setProperty("--tg-workspace-wallpaper", theme.workspaceWallpaper);
}
export function setTelegramTheme(value: TelegramThemeId): void {
  if (!isTheme(value)) return;
  applyTelegramThemeTokens(value);
  try { localStorage.setItem(TELEGRAM_THEME_STORAGE_KEY, value); } catch { /* Applying a palette still works with read-only storage. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === TELEGRAM_THEME_STORAGE_KEY || event.key === null) { applyTelegramThemeTokens(readSaved()); callback(); } };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(CHANGE_EVENT, callback); window.removeEventListener("storage", storage); };
}
export function useTelegramTheme(): readonly [TelegramThemeId, typeof setTelegramTheme] {
  return [useSyncExternalStore(subscribe, getTelegramTheme, () => DEFAULT_TELEGRAM_THEME), setTelegramTheme] as const;
}
