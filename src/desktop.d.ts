export {};

declare global {
  interface Window {
    juanye?: {
      platform: string;
      renderDrawing(code: string): Promise<{ svg: string; width: number; height: number }>;
      setAppearance(appearance: { mode: "dark" | "light" | "telegram"; opacity?: number }): Promise<{ nativeTransparency: boolean }>;
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
    };
  }
}
