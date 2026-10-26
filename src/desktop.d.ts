export {};

declare global {
  interface Window {
    juanye?: {
      platform: string;
      renderDrawing(code: string): Promise<{ svg: string; width: number; height: number }>;
      setAppearance(appearance: { mode: "dark" | "light" | "telegram"; telegramScheme?: "dark" | "light"; opacity?: number }): Promise<{ nativeTransparency: boolean }>;
      windowControl(action: "min" | "max" | "close"): void;
      exportPdf(options: { name: string; widthMm: number; heightMm: number }): Promise<{ canceled: boolean; path?: string }>;
      saveText(options: { name: string; content: string; extension: string }): Promise<{ canceled: boolean; path?: string }>;
      loadDraft(): Promise<unknown>;
      saveDraft(draft: unknown): Promise<void>;
      getModel(): Promise<{ baseUrl: string; model: string; hasKey: boolean }>;
      saveModel(config: { baseUrl: string; model: string; key?: string }): Promise<void>;
      testModel(config: { baseUrl: string; model: string; key?: string }): Promise<{ latencyMs: number }>;
      recognize(options: { image: string; multiple: boolean }): Promise<string>;
      cancelRecognition(): Promise<void>;
      generateQuestion(options: { action: "variant" | "analysis"; question: import("./types").Question }): Promise<string>;
      bankLoad(): Promise<unknown>;
      bankSave(input: { questions: import("./types").Question[]; origin?: { examTitle: string; examId?: string } }): Promise<{ bank: unknown; added: number; duplicates: number }>;
      bankDelete(ids: string[]): Promise<unknown>;
      bankRestore(): Promise<unknown>;
      bankManage(input: import("./question-bank").BankManageInput): Promise<unknown>;
      bankRevise(input: import("./question-bank").BankReviseInput): Promise<{ bank: unknown; entry: import("./question-bank").BankEntry }>;
      bankReviseBatch(input: import("./question-bank").BankReviseInput[]): Promise<unknown>;
      bankImport(input: unknown): Promise<{ bank: unknown; added: number; duplicates: number }>;
      bankMarkUsed(ids: string[]): Promise<unknown>;
      analyzeExam(input: import("./exam-ai").ExamAiRequest): Promise<import("./exam-ai").ExamAiReport>;
      cancelExamAnalysis(taskId: string): Promise<void>;
      loadExamReports(examKey?: string): Promise<import("./exam-ai").ExamAiReport[]>;
      exportDocx(options: { name: string; exam: import("./types").Exam; layout: import("./types").Layout }): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
