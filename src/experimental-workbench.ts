import { useSyncExternalStore } from "react";

export const WORKBENCH_STORAGE_KEY = "juanye.experimental-workbench.v1";
export const WORKBENCH_EVENT = "juanye:experimental-workbench";

export function readSavedExperimentalWorkbench(): boolean {
  try { return localStorage.getItem(WORKBENCH_STORAGE_KEY) === "true"; }
  catch { return false; }
}

// This is a device preference, not exam data. A failed disk write must not
// prevent switching or trigger a draft save/history entry.
let enabled = readSavedExperimentalWorkbench();
export function getExperimentalWorkbench(): boolean { return enabled; }

export function setExperimentalWorkbench(value: boolean): void {
  if (typeof value !== "boolean") return;
  enabled = value;
  try { localStorage.setItem(WORKBENCH_STORAGE_KEY, String(value)); } catch { /* Session-only fallback. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKBENCH_EVENT));
}

function subscribe(callback: () => void): () => void {
  const fromStorage = (event: StorageEvent) => {
    if (event.key !== WORKBENCH_STORAGE_KEY && event.key !== null) return;
    enabled = readSavedExperimentalWorkbench();
    callback();
  };
  window.addEventListener(WORKBENCH_EVENT, callback);
  window.addEventListener("storage", fromStorage);
  return () => {
    window.removeEventListener(WORKBENCH_EVENT, callback);
    window.removeEventListener("storage", fromStorage);
  };
}

export function useExperimentalWorkbench(): readonly [boolean, typeof setExperimentalWorkbench] {
  return [useSyncExternalStore(subscribe, getExperimentalWorkbench, () => false), setExperimentalWorkbench] as const;
}
