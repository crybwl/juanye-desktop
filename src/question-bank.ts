import type { Exam, Question, QType } from "./types";
import { defaultLayout } from "./data";
import { parseProject, PROJECT_SCHEMA } from "./documents";

export const BANK_DRAG_MIME = "application/x-juanye-bank-id";
export interface BankEntry {
  id: string;
  question: Question;
  origin: { examTitle: string; questionId: string };
  contentKey: string;
  createdAt: string;
  version: number;
  previousVersionId?: string;
}
export interface BankDocument { schema: "juanye-bank/1"; revision: number; entries: BankEntry[] }
export interface BankFilters { query?: string; type?: QType | ""; knowledge?: string; difficulty?: Question["difficulty"] | "unset" | ""; source?: string }
export interface BankBridge {
  bankLoad(): Promise<unknown>;
  bankSave(input: { questions: Question[]; origin?: { examTitle: string } }): Promise<{ bank: unknown; added: number; duplicates: number }>;
  bankDelete(ids: string[]): Promise<unknown>;
  bankRestore(): Promise<unknown>;
}
export function bankBridge(): BankBridge {
  const bridge = window.juanye as (typeof window.juanye & Partial<BankBridge>);
  if (!bridge?.bankLoad || !bridge.bankSave || !bridge.bankDelete || !bridge.bankRestore) throw Error("请使用桌面应用打开本地题库");
  return bridge as BankBridge;
}
export function checkedBankDocument(raw: unknown): BankDocument {
  const doc = raw as BankDocument | undefined;
  if (!doc || doc.schema !== "juanye-bank/1" || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || !Array.isArray(doc.entries) || doc.entries.length > 10000) throw Error("本地题库格式不正确，原文件未被修改");
  const ids = new Set<string>();
  const entries = doc.entries.map(entry => {
    if (!entry || typeof entry.id !== "string" || !entry.id || entry.id.length > 200 || ids.has(entry.id) || typeof entry.createdAt !== "string" || typeof entry.contentKey !== "string" || !entry.origin || typeof entry.origin.examTitle !== "string" || typeof entry.origin.questionId !== "string") throw Error("本地题库记录无效");
    const version = entry.version ?? 1;
    if (!Number.isSafeInteger(version) || version < 1 || version > 10000 || entry.previousVersionId !== undefined && (typeof entry.previousVersionId !== "string" || !entry.previousVersionId || entry.previousVersionId.length > 200)) throw Error("题库版本记录无效");
    ids.add(entry.id);
    // Reuse the editable-project validator, including embedded-picture and formula rules.
    const exam: Exam = { title: "题库校验", subtitle: "", duration: 0, notice: [], sections: [{ id: "bank-validation", type: entry.question?.type, title: "", note: "", questions: [entry.question] }] };
    const question = parseProject(JSON.stringify({ schema: PROJECT_SCHEMA, exam, layout: defaultLayout })).exam.sections[0].questions[0];
    return { id: entry.id, question, origin: { examTitle: entry.origin.examTitle, questionId: entry.origin.questionId }, contentKey: entry.contentKey, createdAt: entry.createdAt, version, ...(entry.previousVersionId ? { previousVersionId: entry.previousVersionId } : {}) };
  });
  return { schema: "juanye-bank/1", revision: doc.revision, entries };
}
const folded = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
export function filterBankEntries(entries: readonly BankEntry[], filters: BankFilters): BankEntry[] {
  const query = folded(filters.query?.trim() ?? "");
  return entries.filter(entry => {
    const q = entry.question;
    if (filters.type && q.type !== filters.type) return false;
    if (filters.difficulty === "unset" ? Boolean(q.difficulty) : filters.difficulty && q.difficulty !== filters.difficulty) return false;
    if (filters.knowledge && !(q.knowledge ?? []).map(tag => tag.trim()).includes(filters.knowledge)) return false;
    if (filters.source && (q.source?.trim() || entry.origin.examTitle) !== filters.source) return false;
    return !query || folded([q.stem, ...q.options, ...q.answer, q.analysis, q.source, ...(q.knowledge ?? []), entry.origin.examTitle].join("\n")).includes(query);
  });
}
export function cloneBankQuestions(questions: readonly Question[], id = () => crypto.randomUUID()): Question[] {
  return questions.map(question => ({ ...structuredClone(question), id: id(), ...(question.figures ? { figures: question.figures.map(figure => ({ ...figure, id: id() })) } : {}) }));
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
  const entries = new Map(bank.entries.map(entry => [entry.id, entry.question]));
  return cloneBankQuestions(wanted.map(id => { const question = entries.get(id); if (!question) throw Error("拖入的题目已从题库移除，请刷新题库后重试"); return question; }));
}
