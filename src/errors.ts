/** Electron wraps IPC errors with its transport name; show only actionable text. */
export function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
    .replace(/^Error:\s*/, "");
}
