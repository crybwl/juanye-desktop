import type { Editor } from "@tiptap/core";
import { useSyncExternalStore } from "react";

/** 当前唯一挂载的 Tiptap 实例；浮动工具栏与公式面板订阅它，不触发整本重渲染。 */
export interface ActiveEditor { editor: Editor; blockId: string; field: string }
interface Snapshot { active: ActiveEditor | null; version: number }

let snapshot: Snapshot = { active: null, version: 0 };
const listeners = new Set<() => void>();
let frame = 0;
const emit = () => listeners.forEach(listener => listener());

export const activeEditorStore = {
  get: () => snapshot,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  set(active: ActiveEditor | null) {
    cancelAnimationFrame(frame); frame = 0;
    snapshot = { active, version: snapshot.version + 1 };
    emit();
  },
  release(editor: Editor) { if (snapshot.active?.editor === editor) activeEditorStore.set(null); },
  /** 选区/内容变化：合并到下一帧，避免逐键多次渲染工具栏。 */
  bump() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; snapshot = { ...snapshot, version: snapshot.version + 1 }; emit(); });
  },
};

export const useActiveEditor = () => useSyncExternalStore(activeEditorStore.subscribe, activeEditorStore.get);
