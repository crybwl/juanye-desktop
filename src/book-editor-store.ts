import type { Question } from './types';

export interface BookQuestionSnapshot { question?: Question; number: string }

/** A chapter subscribes to its own question IDs, never the entire book on each
 * keypress. Existing snapshots stay referentially stable until their own data
 * or displayed number changes. */
export class BookQuestionStore {
  private values = new Map<string, BookQuestionSnapshot>();
  private listeners = new Map<string, Set<() => void>>();
  onChange: (id: string, patch: Partial<Question>) => void = () => {};
  editMath: (latex: string, position: number, block: boolean) => void = () => {};
  prepare(questions: Record<string, Question>, numbers: Record<string, string>, ids: readonly string[]) {
    for (const id of ids) if (!this.values.has(id)) this.values.set(id, { question: questions[id], number: numbers[id] || '' });
  }
  update(questions: Record<string, Question>, numbers: Record<string, string>, ids: readonly string[]) {
    const live = new Set(ids);
    for (const id of new Set([...ids, ...this.listeners.keys()])) {
      const previous = this.values.get(id), question = questions[id], number = numbers[id] || '';
      if (previous && previous.question === question && previous.number === number) continue;
      this.values.set(id, { question, number }); this.listeners.get(id)?.forEach(notify => notify());
    }
    for (const id of this.values.keys()) if (!live.has(id) && !this.listeners.has(id)) this.values.delete(id);
  }
  get(id: string) { return this.values.get(id); }
  subscribe(id: string, listener: () => void) {
    const listeners = this.listeners.get(id) ?? new Set(); listeners.add(listener); this.listeners.set(id, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
}
