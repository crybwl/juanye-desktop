import type { Question } from "./types";

export interface SidebarRowData { q: Question; num: number; active: boolean; batch: boolean; checked: boolean }

/** Stable reorder IDs keep Motion's group context unchanged while typing.
 * Notify only the row whose immutable content/selection actually changed. */
export class SidebarRowStore {
  private snapshots = new Map<string, SidebarRowData>();
  private listeners = new Map<string, Set<() => void>>();
  private live = new Set<string>();
  constructor(rows: SidebarRowData[]) { this.update(rows); }
  get = (id: string) => this.snapshots.get(id)!;
  // A newly inserted Row renders before its parent's layout effect publishes.
  // Seed only unsubscribed/new identities; never change existing snapshots or
  // notify another component from render.
  seed(rows: SidebarRowData[]) { for (const row of rows) if (!this.snapshots.has(row.q.id)) this.snapshots.set(row.q.id, row); }
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set(); listeners.add(listener); this.listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) { this.listeners.delete(id); if (!this.live.has(id)) this.snapshots.delete(id); } };
  }
  update(rows: SidebarRowData[]) {
    this.live = new Set(rows.map(row => row.q.id));
    for (const row of rows) {
      const previous = this.snapshots.get(row.q.id);
      if (previous && previous.q === row.q && previous.num === row.num && previous.active === row.active && previous.batch === row.batch && previous.checked === row.checked) continue;
      this.snapshots.set(row.q.id, row); this.listeners.get(row.q.id)?.forEach(notify => notify());
    }
    // Keep a removed row only while AnimatePresence still owns its subscriber.
    for (const id of this.snapshots.keys()) if (!this.live.has(id) && !this.listeners.has(id)) this.snapshots.delete(id);
  }
}
