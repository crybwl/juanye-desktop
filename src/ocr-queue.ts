/** Imports are committed in user action order, regardless of file decoding speed. */
export class OrderedOcrImports<T> {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private pending = 0;

  constructor(private readonly options: {
    limit: number;
    count: () => number;
    append: (items: T[]) => void;
    onPending: (count: number) => void;
  }) {}

  reset() {
    this.epoch++;
    this.pending = 0;
    this.tail = Promise.resolve();
    this.options.onPending(0);
  }

  enqueue(read: (remaining: number) => Promise<T[]>): Promise<T[]> {
    const epoch = this.epoch;
    this.options.onPending(++this.pending);
    const task = this.tail.then(async () => {
      if (epoch !== this.epoch) return [];
      const remaining = this.options.limit - this.options.count();
      if (remaining <= 0) throw new Error(`最多 ${this.options.limit} 页，请删除部分页面后再添加。`);
      const items = await read(remaining);
      if (epoch !== this.epoch) return [];
      if (items.length > this.options.limit - this.options.count()) throw new Error(`最多 ${this.options.limit} 页，请拆分文件后添加。`);
      this.options.append(items);
      return items;
    });
    // A failed file must not poison later imports or remove already imported pages.
    this.tail = task.catch(() => {});
    return task.catch((error) => {
      if (epoch !== this.epoch) return [];
      throw error;
    }).finally(() => {
      if (epoch === this.epoch) this.options.onPending(--this.pending);
    });
  }
}

export function removeOcrPage<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function pendingOcrPages<T extends { id: string; status: string }>(items: T[], ids?: string[]) {
  return items.filter((item) => item.status !== "done" && item.status !== "running" && (!ids || ids.includes(item.id)));
}

export function isOcrPasteTarget(target: EventTarget | null) {
  return !(target instanceof Element && target.closest('textarea,input,[contenteditable=""],[contenteditable="true"],[role="textbox"]'));
}
