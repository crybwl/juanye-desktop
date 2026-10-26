import type { Exam } from './types';
import { DEFAULT_EXAM_AI_CONFIG, contentHash, examContextHash, examReportKey, examSnapshotFingerprint, normalizeExamAiConfig, planExamAnalysis, snapshotExam, stableStringify, type SharedExamAiConfig, type ExamSnapshot } from '../electron/exam-ai-shared.mjs';

export { DEFAULT_EXAM_AI_CONFIG, contentHash, examContextHash, examReportKey, examSnapshotFingerprint, normalizeExamAiConfig, planExamAnalysis, snapshotExam, stableStringify };
export type ExamAiConfig = SharedExamAiConfig;
export interface ExamMetadataPatch { id: string; knowledge?: string[]; difficulty?: 'easy' | 'medium' | 'hard' }
export interface ExamAiFinding { kind: 'answer' | 'ambiguity' | 'coverage' | 'difficulty' | 'other'; severity: 'info' | 'warning' | 'critical'; questionIds: string[]; message: string; evidence: string; suggestion: string }
export interface ExamAiQuestionReview { questionId: string; knowledge: string[]; estimatedDifficulty: 'easy' | 'medium' | 'hard' | 'not_checked'; rationale: string; answerCheck: 'consistent' | 'suspect' | 'not_checked'; visualCheck: 'checked' | 'not_checked' }
export interface ExamAiReport {
  version: 1; id: string; examKey: string; createdAt: string; promptVersion: string;
  fingerprint: string; contextHash: string; config: ExamAiConfig; snapshot: ExamSnapshot;
  model: {name: string; endpoint: string}; requestCount: number; cacheHits: number; checkedImageQuestionIds: string[];
  summary: string; recommendations: string[]; findings: ExamAiFinding[]; questionReviews: ExamAiQuestionReview[];
}
export interface ExamAiRequest { taskId: string; exam: Exam; config: ExamAiConfig; expectedFingerprint: string; examKey?: string }
export type ApplyExamMetadata = (patches: ExamMetadataPatch[], expectedFingerprint: string) => boolean | void;

export function isExamReportStale(report: ExamAiReport, exam: Exam, config: ExamAiConfig): boolean {
  return report.fingerprint !== examSnapshotFingerprint(exam) || report.contextHash !== examContextHash(config);
}
export function reportMetadataProposals(report: ExamAiReport, exam: Exam): ExamMetadataPatch[] {
  const questions = new Map(exam.sections.flatMap(section => section.questions).map(question => [question.id, question]));
  return report.questionReviews.flatMap(review => {
    const question = questions.get(review.questionId); if (!question) return [];
    const knowledge = [...new Set(review.knowledge.map(value => value.trim()).filter(Boolean))];
    const patch: ExamMetadataPatch = {id: question.id};
    if (knowledge.length && JSON.stringify(knowledge) !== JSON.stringify(question.knowledge ?? [])) patch.knowledge = knowledge;
    if (review.estimatedDifficulty !== 'not_checked' && review.estimatedDifficulty !== question.difficulty) patch.difficulty = review.estimatedDifficulty;
    return patch.knowledge || patch.difficulty ? [patch] : [];
  });
}
// Exact metadata snapshots preserve unset values on undo (undefined explicitly clears).
export function invertMetadataPatches(exam: Exam, patches: ExamMetadataPatch[]): ExamMetadataPatch[] {
  const questions = new Map(exam.sections.flatMap(section => section.questions).map(question => [question.id, question]));
  return patches.flatMap(patch => { const question=questions.get(patch.id); if(!question)return[]; return [{id:patch.id,...('knowledge' in patch ? {knowledge:question.knowledge ? [...question.knowledge] : undefined}:{}),...('difficulty' in patch ? {difficulty:question.difficulty}: {})}]; });
}
export function previewMetadataPatches(exam: Exam, patches: ExamMetadataPatch[]): Exam {
  const byId = new Map(patches.map(patch => [patch.id,patch]));
  return {...exam,sections:exam.sections.map(section=>({...section,questions:section.questions.map(question=>{const patch=byId.get(question.id);return patch?{...question,...patch}:question;})}))};
}

export function knowledgeDifficultyMatrix(exam: Exam) {
  const keys = ['easy','medium','hard','unset'] as const;
  const rows = new Map<string,{name:string;score:number;cells:Record<typeof keys[number],{score:number;numbers:number[]}>}>();
  let number=0;
  for(const question of exam.sections.flatMap(section=>section.questions)) {
    number++;
    const knowledge=[...new Set(question.knowledge?.map(value=>value.trim()).filter(Boolean)??[])];
    for(const name of knowledge.length?knowledge:['未设置']) {
      const row=rows.get(name)??{name,score:0,cells:{easy:{score:0,numbers:[]},medium:{score:0,numbers:[]},hard:{score:0,numbers:[]},unset:{score:0,numbers:[]}}};
      const score=question.score/Math.max(1,knowledge.length),cell=row.cells[question.difficulty??'unset'];
      cell.score+=score;cell.numbers.push(number);row.score+=score;rows.set(name,row);
    }
  }
  return {keys,rows:[...rows.values()]};
}
