import { useSyncExternalStore } from "react";
import { DEFAULT_SCENE_PREFERENCES, normalizeScenePreferences, type ScenePreferences } from "./scene-patterns";

export const SCENE_PREFERENCES_STORAGE_KEY = "juanye.scene-pattern.v1";
export const SCENE_PREFERENCES_EVENT = "juanye:scene-pattern";
export function readSavedScenePreferences(): ScenePreferences {
  try { return normalizeScenePreferences(JSON.parse(localStorage.getItem(SCENE_PREFERENCES_STORAGE_KEY) || "null")); }
  catch { return { ...DEFAULT_SCENE_PREFERENCES }; }
}
let current = readSavedScenePreferences();
export const getScenePreferences = () => current;
const serverSnapshot = () => DEFAULT_SCENE_PREFERENCES;
const equal = (a: ScenePreferences, b: ScenePreferences) => a.pattern === b.pattern && a.size === b.size && a.density === b.density;

function reflect() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.scenePattern = current.pattern;
  root.dataset.sceneSize = current.size;
  root.dataset.sceneDensity = current.density;
}
export function initializeScenePreferences() { reflect(); }
export function setScenePreferences(patch: Partial<ScenePreferences>) {
  const next = normalizeScenePreferences({ ...current, ...patch });
  if (equal(current, next)) return;
  current = next; reflect();
  try { localStorage.setItem(SCENE_PREFERENCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the session choice when storage is unavailable. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SCENE_PREFERENCES_EVENT));
}
export function subscribeScenePreferences(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== SCENE_PREFERENCES_STORAGE_KEY && event.key !== null) return;
    const next = readSavedScenePreferences();
    if (!equal(current, next)) { current = next; reflect(); }
    // Every observer must see a cross-window update even if an earlier
    // subscription already refreshed the shared snapshot for this same event.
    callback();
  };
  window.addEventListener(SCENE_PREFERENCES_EVENT, callback);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(SCENE_PREFERENCES_EVENT, callback); window.removeEventListener("storage", storage); };
}
export function useScenePreferences(): readonly [ScenePreferences, typeof setScenePreferences] {
  return [useSyncExternalStore(subscribeScenePreferences, getScenePreferences, serverSnapshot), setScenePreferences] as const;
}
