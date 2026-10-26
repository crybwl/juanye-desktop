import type { Exam, Layout } from "./types";

/** A true editable OOXML document. Nothing leaves the local desktop process. */
export async function exportWord(exam: Exam, layout: Layout): Promise<boolean> {
  const bridge = window.juanye as (Window["juanye"] & { exportDocx?: (value: { name: string; exam: Exam; layout: Layout }) => Promise<{ canceled: boolean; path?: string }> }) | undefined;
  if (!bridge?.exportDocx) throw new Error("请使用新版卷页桌面应用导出 Word");
  const result = await bridge.exportDocx({ name: exam.title, exam, layout });
  return !result.canceled;
}
