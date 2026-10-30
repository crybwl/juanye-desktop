declare module 'pagedjs' {
  export class Previewer {
    chunker: { destroy(): void; hooks: {
      renderNode: { register(callback: (rendered: Node, source: Node) => void): void };
      onBreakToken: { register(callback: (token: { node: Node; offset: number } | undefined, overflow: Range | undefined) => void): void };
    } };
    polisher: { destroy(): void };
    preview(content: string | DocumentFragment | HTMLElement, styles: (string | Record<string, string>)[], target: HTMLElement): Promise<{ total: number }>;
  }
}
