import { sampleWorkbook, sanitizeWorkbook, type Workbook } from "./model";

const LOCAL_KEY = "juanye-workbook";

/** 桌面端写入用户数据目录的 workbook.json（原子替换）；浏览器开发模式退回 localStorage。 */
export async function loadWorkbook(): Promise<Workbook> {
  let raw: unknown = null;
  if (window.juanye?.workbookLoad) raw = await window.juanye.workbookLoad();
  else { try { raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null"); } catch { raw = null; } }
  return sanitizeWorkbook(raw) ?? sampleWorkbook();
}

export async function saveWorkbook(book: Workbook): Promise<void> {
  if (window.juanye?.workbookSave) return window.juanye.workbookSave(book);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(book));
}
