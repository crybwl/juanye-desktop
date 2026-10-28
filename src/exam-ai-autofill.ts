import { contentHash, type ExamAiReport } from './exam-ai';

export const AUTO_METADATA_STORAGE_KEY = 'juanye.exam-ai-metadata.applied.v1';
type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem'>;
const LIMIT = 200;

/** Record handling independently of dialog lifetime. Persist receipts only
 * after the workspace is saved, so a failed draft save cannot consume a fill. */
export class ExamMetadataReceipts {
  private readonly handled = new Set<string>();
  private readonly pending = new Map<string, number>();
  private serial = 0;
  constructor(private readonly storage?: ReceiptStorage) {
    try {
      const values: unknown = JSON.parse(storage?.getItem(AUTO_METADATA_STORAGE_KEY) || '[]');
      if (Array.isArray(values)) for (const value of values.slice(-LIMIT)) if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) this.handled.add(value);
    } catch { /* Invalid/unavailable storage must not block question editing. */ }
  }
  private key(report: ExamAiReport) { return contentHash(JSON.stringify([report.examKey, report.id, report.fingerprint])); }
  has(report: ExamAiReport) { return this.handled.has(this.key(report)); }
  mark(report: ExamAiReport) {
    const key = this.key(report);
    if (this.handled.has(key)) return;
    this.handled.add(key); this.pending.set(key, ++this.serial);
    if (this.handled.size > LIMIT) { const oldest = this.handled.values().next().value!; this.handled.delete(oldest); this.pending.delete(oldest); }
  }
  checkpoint() { return this.serial; }
  flush(checkpoint = this.serial) {
    if (![...this.pending.values()].some(serial => serial <= checkpoint)) return;
    try {
      this.storage?.setItem(AUTO_METADATA_STORAGE_KEY, JSON.stringify([...this.handled].filter(key => (this.pending.get(key) ?? 0) <= checkpoint)));
      for (const [key, serial] of this.pending) if (serial <= checkpoint) this.pending.delete(key);
    } catch { /* Session protection still works without localStorage. */ }
  }
}
