import { useSyncExternalStore } from "react";

export type TelegramScheme = "dark" | "light";
export const TELEGRAM_SCHEME_STORAGE_KEY = "juanye.telegram-scheme.v1";
export const TELEGRAM_SCHEME_EVENT = "juanye:telegram-scheme";
const isScheme = (value: unknown): value is TelegramScheme => value === "dark" || value === "light";

export function readSavedTelegramScheme(): TelegramScheme {
  try {
    const value = localStorage.getItem(TELEGRAM_SCHEME_STORAGE_KEY);
    return isScheme(value) ? value : "dark";
  } catch { return "dark"; }
}

export function getTelegramScheme(): TelegramScheme {
  if (typeof document === "undefined") return "dark";
  const value = document.documentElement.dataset.telegramScheme;
  return isScheme(value) ? value : readSavedTelegramScheme();
}

export function setTelegramScheme(value: TelegramScheme): void {
  if (!isScheme(value)) return;
  document.documentElement.dataset.telegramScheme = value;
  try { localStorage.setItem(TELEGRAM_SCHEME_STORAGE_KEY, value); } catch { /* Read-only storage must not prevent switching. */ }
  window.dispatchEvent(new Event(TELEGRAM_SCHEME_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(TELEGRAM_SCHEME_EVENT, callback);
  return () => window.removeEventListener(TELEGRAM_SCHEME_EVENT, callback);
}

export function useTelegramScheme(): readonly [TelegramScheme, typeof setTelegramScheme] {
  return [useSyncExternalStore(subscribe, getTelegramScheme, () => "dark"), setTelegramScheme] as const;
}
