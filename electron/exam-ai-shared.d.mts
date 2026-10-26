import type { Exam } from '../src/types';
export interface SharedExamAiConfig { grade: string; scope: string; purpose: string; mode: 'quick' | 'deep'; maxRequests: number; maxOutputTokens: number; includeImages: boolean; imageBudget: number }
export interface SnapshotQuestion { id: string; number: number; type: string; score: number; stem: string; options: string[]; answer: string[]; analysis: string; knowledge: string[]; difficulty: string; source: string; flag: string; mediaHashes: string[]; figureCaptions: string[]; image: string | null; section?: string; sectionNote?: string }
export interface ExamSnapshot { title: string; subtitle: string; duration: number; notice: string[]; sections: { id: string; title: string; type: string; note: string; questions: SnapshotQuestion[] }[] }
export const PROMPT_VERSION: string;
export const DEFAULT_EXAM_AI_CONFIG: Readonly<SharedExamAiConfig>;
export function stableStringify(value: unknown): string;
export function contentHash(value: string): string;
export function normalizeExamAiConfig(input?: Partial<SharedExamAiConfig>): SharedExamAiConfig;
export function snapshotExam(exam: Exam): ExamSnapshot;
export function examSnapshotFingerprint(exam: Exam): string;
export function examContextHash(config: Partial<SharedExamAiConfig>): string;
export function examReportKey(exam: Exam): string;
export function planExamAnalysis(exam: Exam, input?: Partial<SharedExamAiConfig>): { config: SharedExamAiConfig; snapshot: ExamSnapshot; chunks: SnapshotQuestion[][]; images: {questionId:string;source:string}[]; questionCount: number; charCount: number; chunkCount: number; maxRequests: number; maxOutputTokens: number; maxTotalOutputTokens: number; exceedsBudget: boolean; fingerprint: string; contextHash: string; examKey: string };
