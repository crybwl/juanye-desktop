import type { Exam, Question, QType } from "./types";
import { defaultLayout } from "./data";
import { parseProject, PROJECT_SCHEMA } from "./documents";

export const BANK_DRAG_MIME = "application/x-juanye-bank-id";
export interface BankCollection { id: string; name: string; parentId?: string }
export interface BankEntry {
  id: string;
  libraryId: string;
  question: Question;
  origin: { examTitle: string; questionId: string; examId?: string };
  contentKey: string;
  createdAt: string;
  version: number;
  previousVersionId?: string;
  favorite: boolean;
  collectionIds: string[];
  usageCount: number;
  lastUsedAt?: string;
  trashedAt?: string;
}
export interface BankDocument { schema: "juanye-bank/1"; revision: number; entries: BankEntry[]; collections: BankCollection[] }
export interface BankFilters { query?: string; type?: QType | ""; knowledge?: string; difficulty?: Question["difficulty"] | "unset" | ""; source?: string; collectionId?: string; favorite?: boolean; trashed?: boolean; review?: boolean; sort?: "recent" | "used" | "score" }
export type BankManageInput = { action: "metadata"; ids: string[]; favorite?: boolean; collectionIds?: string[]; appendCollectionId?: string } | { action: "trash" | "restore-items"; ids: string[] } | { action: "collection-save"; collection: BankCollection } | { action: "collection-delete"; id: string };
export interface BankReviseInput { id: string; question: Question; expectedContentKey: string }
export interface BankImportResult { bank: unknown; added: number; duplicates: number }
export interface BankBridge {
  bankLoad(): Promise<unknown>;
  bankSave(input: { questions: Question[]; origin?: { examTitle: string; examId?: string } }): Promise<BankImportResult>;
  bankDelete(ids: string[]): Promise<unknown>;
  bankRestore(): Promise<unknown>;
  bankManage(input: BankManageInput): Promise<unknown>;
  bankRevise(input: BankReviseInput): Promise<{ bank: unknown; entry: BankEntry }>;
  bankReviseBatch(input: BankReviseInput[]): Promise<unknown>;
  bankImport(raw: unknown): Promise<BankImportResult>;
  bankMarkUsed(ids: string[]): Promise<unknown>;
}
export function bankBridge(): BankBridge {
  const bridge = window.juanye as (typeof window.juanye & Partial<BankBridge>);
  if (!bridge?.bankLoad || !bridge.bankSave || !bridge.bankDelete || !bridge.bankRestore) throw Error("请使用桌面应用打开本地题库");
  return bridge as BankBridge;
}
export function checkedBankDocument(raw: unknown): BankDocument {
  const doc = raw as BankDocument | undefined;
  if (!doc || doc.schema !== "juanye-bank/1" || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.entries) || doc.entries.length > 10000) throw Error("本地题库格式不正确，原文件未被修改");
  const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
  const validTime = (value: unknown): value is string => typeof value === "string" && value.length <= 100 && Number.isFinite(Date.parse(value));
  if (doc.collections !== undefined && (!Array.isArray(doc.collections) || doc.collections.length > 10000)) throw Error("题集列表无效");
  const collectionIds = new Set<string>();
  const collections: BankCollection[] = (doc.collections ?? []).map(collection => {
    if (!collection || !validId(collection.id) || collectionIds.has(collection.id) || typeof collection.name !== "string" || !collection.name.trim() || collection.name.length > 200 || collection.parentId !== undefined && !validId(collection.parentId)) throw Error("题集记录无效");
    collectionIds.add(collection.id);
    return { id: collection.id, name: collection.name.trim(), ...(collection.parentId === undefined ? {} : { parentId: collection.parentId }) };
  });
  const byCollection = new Map(collections.map(collection => [collection.id, collection]));
  for (const collection of collections) {
    const seen = new Set([collection.id]); let parent = collection.parentId;
    while (parent !== undefined) {
      if (!byCollection.has(parent) || seen.has(parent)) throw Error("题集层级无效");
      seen.add(parent); parent = byCollection.get(parent)!.parentId;
    }
  }
  const ids = new Set<string>();
  const entries = doc.entries.map(entry => {
    if (!entry || !validId(entry.id) || ids.has(entry.id) || typeof entry.createdAt !== "string" || entry.createdAt.length > 100 || typeof entry.contentKey !== "string" || entry.contentKey.length > 200 || !entry.origin || typeof entry.origin.examTitle !== "string" || entry.origin.examTitle.length > 1000 || typeof entry.origin.questionId !== "string" || entry.origin.questionId.length > 200 || entry.origin.examId !== undefined && !validId(entry.origin.examId)) throw Error("本地题库记录无效");
    const version = entry.version === undefined ? 1 : entry.version;
    if (!Number.isSafeInteger(version) || version < 1 || version > 10000 || entry.previousVersionId !== undefined && (typeof entry.previousVersionId !== "string" || !entry.previousVersionId || entry.previousVersionId.length > 200)) throw Error("题库版本记录无效");
    ids.add(entry.id);
    // Reuse the editable-project validator, including embedded-picture and formula rules.
    const exam: Exam = { title: "题库校验", subtitle: "", duration: 0, notice: [], sections: [{ id: "bank-validation", type: entry.question?.type, title: "", note: "", questions: [entry.question] }] };
    const question = parseProject(JSON.stringify({ schema: PROJECT_SCHEMA, exam, layout: defaultLayout })).exam.sections[0].questions[0];
    if (entry.libraryId !== undefined && !validId(entry.libraryId) || entry.favorite !== undefined && typeof entry.favorite !== "boolean" || entry.collectionIds !== undefined && (!Array.isArray(entry.collectionIds) || entry.collectionIds.length > 10000 || new Set(entry.collectionIds).size !== entry.collectionIds.length || entry.collectionIds.some(id => !validId(id) || !collectionIds.has(id))) || entry.usageCount !== undefined && (!Number.isSafeInteger(entry.usageCount) || entry.usageCount < 0) || entry.lastUsedAt !== undefined && !validTime(entry.lastUsedAt) || entry.trashedAt !== undefined && !validTime(entry.trashedAt)) throw Error("题库元数据无效");
    return { id: entry.id, question, origin: { examTitle: entry.origin.examTitle, questionId: entry.origin.questionId, ...(entry.origin.examId === undefined ? {} : { examId: entry.origin.examId }) }, contentKey: entry.contentKey, createdAt: entry.createdAt, version, ...(entry.previousVersionId ? { previousVersionId: entry.previousVersionId } : {}), ...(entry.libraryId === undefined ? {} : { libraryId: entry.libraryId }), ...(entry.favorite === undefined ? {} : { favorite: entry.favorite }), ...(entry.collectionIds === undefined ? {} : { collectionIds: [...entry.collectionIds] }), ...(entry.usageCount === undefined ? {} : { usageCount: entry.usageCount }), ...(entry.lastUsedAt === undefined ? {} : { lastUsedAt: entry.lastUsedAt }), ...(entry.trashedAt === undefined ? {} : { trashedAt: entry.trashedAt }) };
  });
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const groups = new Map<string, typeof entries>();
  const resolved = new Set<string>();
  for (const entry of entries) {
    const chain: typeof entries = [], seen = new Set<string>(); let current: (typeof entries)[number] | undefined = entry;
    while (current && !resolved.has(current.id)) {
      if (seen.has(current.id)) throw Error("题库版本链不能循环");
      seen.add(current.id); chain.push(current); current = current.previousVersionId ? byId.get(current.previousVersionId) : undefined;
    }
    for (const item of chain.reverse()) {
      const previous = item.previousVersionId ? byId.get(item.previousVersionId) : undefined;
      if (previous && (previous.version >= item.version || item.libraryId !== undefined && item.libraryId !== previous.libraryId)) throw Error("题库版本链无效");
      item.libraryId ??= previous?.libraryId ?? item.previousVersionId ?? item.id;
      resolved.add(item.id);
    }
    const libraryId = entry.libraryId!;
    const group = groups.get(libraryId) ?? []; group.push(entry); groups.set(libraryId, group);
  }
  const metadataKeys = ["favorite", "collectionIds", "usageCount", "lastUsedAt", "trashedAt"] as const;
  for (const group of groups.values()) {
    const versions = new Set<number>();
    const metadata: Pick<BankEntry, typeof metadataKeys[number]> = { favorite: false, collectionIds: [], usageCount: 0 };
    for (const key of metadataKeys) {
      const supplied = group.filter(entry => entry[key] !== undefined);
      if (supplied.some(entry => JSON.stringify(entry[key]) !== JSON.stringify(supplied[0][key]))) throw Error("同一题目的元数据不一致");
      if (supplied.length) Object.assign(metadata, { [key]: supplied[0][key] });
    }
    for (const entry of group) {
      if (versions.has(entry.version)) throw Error("同一题目的版本重复");
      versions.add(entry.version); Object.assign(entry, structuredClone(metadata));
    }
  }
  return { schema: "juanye-bank/1", revision: doc.revision, entries: entries as BankEntry[], collections };
}
const folded = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
export function latestBankEntries(entries: readonly BankEntry[]): BankEntry[] {
  const latest = new Map<string, BankEntry>();
  for (const entry of entries) {
    const key = entry.libraryId ?? entry.id, previous = latest.get(key);
    if (!previous || entry.version > previous.version) latest.set(key, entry);
  }
  return [...latest.values()];
}
export function sortBankEntries(entries: readonly BankEntry[], sort: BankFilters["sort"] = "recent"): BankEntry[] {
  const time = (value?: string) => value ? Date.parse(value) || 0 : 0;
  return [...entries].sort((a, b) => (sort === "used" ? (b.usageCount ?? 0) - (a.usageCount ?? 0) || time(b.lastUsedAt) - time(a.lastUsedAt) : sort === "score" ? b.question.score - a.question.score : 0) || time(b.createdAt) - time(a.createdAt));
}
export function filterBankEntries(entries: readonly BankEntry[], filters: BankFilters): BankEntry[] {
  const query = folded(filters.query?.trim() ?? "");
  return sortBankEntries(latestBankEntries(entries).filter(entry => {
    const q = entry.question;
    if (Boolean(entry.trashedAt) !== Boolean(filters.trashed)) return false;
    if (filters.collectionId && !(entry.collectionIds ?? []).includes(filters.collectionId)) return false;
    if (filters.favorite !== undefined && Boolean(entry.favorite) !== filters.favorite) return false;
    if (filters.review !== undefined && Boolean(q.flag?.trim()) !== filters.review) return false;
    if (filters.type && q.type !== filters.type) return false;
    if (filters.difficulty === "unset" ? Boolean(q.difficulty) : filters.difficulty && q.difficulty !== filters.difficulty) return false;
    if (filters.knowledge && !(q.knowledge ?? []).map(tag => tag.trim()).includes(filters.knowledge)) return false;
    if (filters.source && (q.source?.trim() || entry.origin.examTitle) !== filters.source) return false;
    return !query || folded([q.stem, ...q.options, ...q.answer, q.analysis, q.source, ...(q.knowledge ?? []), entry.origin.examTitle].join("\n")).includes(query);
  }), filters.sort);
}
export function cloneBankQuestions(questions: readonly Question[], id = () => crypto.randomUUID()): Question[] {
  return questions.map(question => ({ ...structuredClone(question), id: id(), ...(question.figures ? { figures: question.figures.map(figure => ({ ...figure, id: id() })) } : {}) }));
}
export function cloneBankEntries(entries: readonly BankEntry[], id = () => crypto.randomUUID()): Question[] {
  return cloneBankQuestions(entries.map(entry => ({ ...entry.question, bankOrigin: { libraryId: entry.libraryId ?? entry.id, revisionId: entry.id, version: entry.version } })), id);
}
export function parseBankDrag(value: string): string[] {
  if (value.length > 50000) throw Error("拖入的题目列表过长");
  let ids: unknown;
  try { ids = JSON.parse(value); } catch { throw Error("题库拖拽内容无效"); }
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== "string" || !id || id.length > 200)) throw Error("题库拖拽内容无效");
  return [...new Set(ids)] as string[];
}
export async function resolveBankDrag(ids: string[]): Promise<Question[]> {
  const wanted = parseBankDrag(JSON.stringify(ids));
  const bank = checkedBankDocument(await bankBridge().bankLoad());
  const entries = new Map(bank.entries.map(entry => [entry.id, entry]));
  return cloneBankEntries(wanted.map(id => { const entry = entries.get(id); if (!entry || entry.trashedAt) throw Error("拖入的题目已从题库移除，请刷新题库后重试"); return entry; }));
}
