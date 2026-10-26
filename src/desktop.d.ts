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
      bankSave(input: { questions: import("./types").Question[]; origin?: { examTitle: string } }): Promise<{ bank: unknown; added: number; duplicates: number }>;
      bankDelete(ids: string[]): Promise<unknown>;
      bankRestore(): Promise<unknown>;
      exportDocx(options: { name: string; exam: import("./types").Exam; layout: import("./types").Layout }): Promise<{ canceled: boolean; path?: string }>;
    };
  }
}
