import type { ExamAiConfig, ExamAiReport, ExamAiRequest } from './exam-ai';

export interface ExamAiSessionBridge {
  analyzeExam(input: ExamAiRequest): Promise<ExamAiReport>;
  cancelExamAnalysis(taskId: string): Promise<void>;
}
export interface ExamAiSessionSnapshot {
  phase: 'idle' | 'running' | 'success' | 'error' | 'cancelled';
  taskId: string;
  background: boolean;
  examKey: string;
  examTitle: string;
  fingerprint: string;
  config?: ExamAiConfig;
  report?: ExamAiReport;
  error: string;
  viewed: boolean;
}

/** A request belongs to the workspace, not the short-lived report dialog.
 * Like an external mutation observer, subscribing/unsubscribing only changes
 * observation. It never starts another request or cancels a background job.
 */
export class ExamAiSession {
  private snapshot: ExamAiSessionSnapshot = { phase: 'idle', taskId: '', background: false, examKey: '', examTitle: '', fingerprint: '', error: '', viewed: true };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly bridge: () => ExamAiSessionBridge | null | undefined, private readonly newTaskId = () => `exam-${crypto.randomUUID()}`) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: ExamAiSessionSnapshot) { this.snapshot = value; this.listeners.forEach(listener => listener()); }

  start(input: Omit<ExamAiRequest, 'taskId'>, background: boolean): boolean {
    if (this.snapshot.phase === 'running') return false;
    const bridge = this.bridge();
    if (!bridge) return false;
    // Freeze the request's data boundary at explicit confirmation. Subsequent
    // edits may make the report stale, but cannot change an in-flight payload.
    const request: ExamAiRequest = { ...structuredClone(input), taskId: this.newTaskId() };
    const current: ExamAiSessionSnapshot = { phase: 'running', taskId: request.taskId, background, examKey: request.examKey ?? '', examTitle: request.exam.title, fingerprint: request.expectedFingerprint, config: request.config, error: '', viewed: false };
    this.publish(current);
    void Promise.resolve().then(() => {
      if (this.snapshot.taskId !== request.taskId || this.snapshot.phase !== 'running') return undefined;
      return bridge.analyzeExam(request);
    }).then(report => {
      if (!report || this.snapshot.taskId !== request.taskId || this.snapshot.phase !== 'running') return;
      this.publish({ ...current, phase: 'success', report });
    }, error => {
      if (this.snapshot.taskId !== request.taskId || this.snapshot.phase !== 'running') return;
      this.publish({ ...current, phase: 'error', error: error instanceof Error ? error.message : String(error) });
    });
    return true;
  }

  cancel(taskId = this.snapshot.taskId) {
    if (this.snapshot.phase !== 'running' || this.snapshot.taskId !== taskId) return;
    // Late completion/error from this cancelled job must not replace a later job.
    this.publish({ ...this.snapshot, phase: 'cancelled', viewed: true });
    void this.bridge()?.cancelExamAnalysis(taskId).catch(() => {});
  }
  closeForeground(examKey: string) {
    if (!this.snapshot.background && this.snapshot.examKey === examKey) this.cancel();
  }
  acknowledge() {
    if (this.snapshot.phase !== 'running' && !this.snapshot.viewed) this.publish({ ...this.snapshot, viewed: true });
  }
}
