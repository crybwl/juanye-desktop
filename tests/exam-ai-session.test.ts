import test from 'node:test';
import assert from 'node:assert/strict';
import type { Exam } from '../src/types';
import { DEFAULT_EXAM_AI_CONFIG, snapshotExam, type ExamAiReport, type ExamAiRequest } from '../src/exam-ai';
import { ExamAiSession, type ExamAiSessionBridge } from '../src/exam-ai-session';

const exam: Exam = { id: 'session-exam', title: '原始试卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 's1', title: '单项选择题', type: 'single', note: '', questions: [{ id: 'q1', type: 'single', score: 5, stem: '已知 $x=1$。', options: ['$1$', '$2$'], answer: ['A'], analysis: '' }] }] };
const input = () => ({ exam: structuredClone(exam), config: { ...DEFAULT_EXAM_AI_CONFIG }, expectedFingerprint: 'original-fingerprint', examKey: 'original-key' });
function report(id = 'report-one'): ExamAiReport {
  return { version: 1, id, examKey: 'original-key', createdAt: '2026-10-27T00:00:00Z', promptVersion: 'test', fingerprint: 'original-fingerprint', contextHash: 'context', config: { ...DEFAULT_EXAM_AI_CONFIG }, snapshot: snapshotExam(exam), model: { name: 'offline-mock', endpoint: 'http://localhost' }, requestCount: 1, cacheHits: 0, checkedImageQuestionIds: [], summary: '隔离报告', recommendations: [], findings: [], questionReviews: [] };
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function harness() {
  const calls: ExamAiRequest[] = [], cancels: string[] = [], jobs: { resolve: (value: ExamAiReport) => void; reject: (reason: Error) => void }[] = [];
  let serial = 0;
  const bridge: ExamAiSessionBridge = { analyzeExam(request) { calls.push(request); return new Promise((resolve, reject) => jobs.push({ resolve, reject })); }, cancelExamAnalysis: async taskId => { cancels.push(taskId); } };
  return { session: new ExamAiSession(() => bridge, () => `test-task-${++serial}`), calls, cancels, jobs };
}

test('background analysis survives observer removal; reopening observes the same request and immutable snapshot', async () => {
  const { session, calls, cancels, jobs } = harness();
  let updates = 0;
  const stop = session.subscribe(() => updates++), request = input();
  assert.equal(session.start(request, true), true);
  request.exam.title = '随后编辑的新标题'; request.exam.sections[0].questions[0].stem = '随后编辑的新题干'; request.config.scope = '随后更改范围';
  stop(); session.closeForeground('original-key');
  await flush();
  assert.equal(calls.length, 1); assert.equal(cancels.length, 0); assert.equal(updates, 1);
  assert.equal(calls[0].exam.title, '原始试卷'); assert.equal(calls[0].exam.sections[0].questions[0].stem, '已知 $x=1$。'); assert.equal(calls[0].config.scope, DEFAULT_EXAM_AI_CONFIG.scope);
  assert.equal(session.start(input(), true), false, 'Reopening or a second confirmation must not start a duplicate');
  const stopAgain = session.subscribe(() => updates++);
  jobs[0].resolve(report()); await flush();
  assert.equal(session.getSnapshot().phase, 'success'); assert.equal(session.getSnapshot().report?.id, 'report-one'); assert.equal(updates, 2);
  session.acknowledge(); assert.equal(session.getSnapshot().viewed, true); assert.equal(calls.length, 1);
  stopAgain();
});

test('foreground close cancels only its matching task and late completion cannot overwrite a replacement', async () => {
  const { session, calls, cancels, jobs } = harness();
  session.start(input(), false); await flush();
  session.closeForeground('another-paper'); assert.equal(session.getSnapshot().phase, 'running');
  session.closeForeground('original-key'); assert.equal(session.getSnapshot().phase, 'cancelled'); assert.deepEqual(cancels, ['test-task-1']);
  session.start(input(), true); await flush(); assert.equal(calls.length, 2);
  jobs[0].resolve(report('cancelled-old-report')); await flush();
  assert.equal(session.getSnapshot().phase, 'running'); assert.equal(session.getSnapshot().taskId, 'test-task-2');
  jobs[1].resolve(report('replacement')); await flush(); assert.equal(session.getSnapshot().report?.id, 'replacement');
});

test('cancel before queued dispatch never sends a request and cannot dispatch after replacement', async () => {
  const { session, calls, cancels, jobs } = harness();
  session.start(input(), true); session.cancel();
  await flush(); assert.equal(calls.length, 0); assert.deepEqual(cancels, ['test-task-1']);
  session.start(input(), false); session.cancel(); session.start(input(), true);
  await flush(); assert.equal(calls.length, 1); assert.equal(calls[0].taskId, 'test-task-3');
  jobs[0].resolve(report('third')); await flush(); assert.equal(session.getSnapshot().report?.id, 'third');
});

test('explicit background cancellation ignores late errors; failures remain inspectable without automatic retry', async () => {
  const { session, calls, cancels, jobs } = harness();
  session.start(input(), true); await flush(); session.cancel('not-this-job'); assert.equal(cancels.length, 0);
  session.cancel(); jobs[0].reject(new Error('late canceled failure')); await flush();
  assert.equal(session.getSnapshot().phase, 'cancelled'); assert.equal(session.getSnapshot().error, '');
  session.start(input(), true); await flush(); jobs[1].reject(new Error('测试服务不可用')); await flush();
  assert.equal(session.getSnapshot().phase, 'error'); assert.equal(session.getSnapshot().error, '测试服务不可用'); assert.equal(session.getSnapshot().viewed, false); assert.equal(calls.length, 2);
  const before = session.getSnapshot(), unsubscribe = session.subscribe(() => {}); unsubscribe(); await flush();
  assert.equal(session.getSnapshot(), before); assert.equal(calls.length, 2);
});
