import type { Exam, Layout } from "./types";

export interface Snapshot {
  id: string;
  at: number;
  label: string;
  exam: Exam;
  layout: Layout;
}
export interface WorkspaceData {
  version: 1;
  exam: Exam;
  layout: Layout;
  history: Snapshot[];
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("juanye-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadWorkspace(): Promise<unknown> {
  if (window.juanye) return window.juanye.loadDraft();
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("workspace").objectStore("workspace").get("current");
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveWorkspace(data: WorkspaceData): Promise<void> {
  if (window.juanye) return window.juanye.saveDraft(data);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function saveText(name: string, content: string, extension: string): Promise<boolean> {
  if (window.juanye) return !(await window.juanye.saveText({ name, content, extension })).canceled;
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[<>:"/\\|?*]/g, "_")}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
