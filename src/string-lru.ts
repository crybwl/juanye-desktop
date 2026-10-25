/** An entry-count AND UTF-16 payload budget prevents a few long solutions from retaining unbounded HTML. */
export class StringLruCache {
  private readonly entries = new Map<string, { value: string; bytes: number }>();
  private bytes = 0;

  constructor(private readonly maxEntries: number, private readonly maxBytes: number) {}

  get size(): number { return this.entries.size; }
  get payloadBytes(): number { return this.bytes; }

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Map iteration is insertion ordered. Touch a hit instead of flushing the entire working set.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.bytes -= previous.bytes; }
    const bytes = (key.length + value.length) * 2;
    if (bytes > this.maxBytes || this.maxEntries <= 0) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
}
