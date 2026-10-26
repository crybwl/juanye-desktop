import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Eye, FileCode2, FileDown, FileInput, History as HistoryIcon, ListChecks, PenLine, Plus, ScanText, SlidersHorizontal, Sparkles, Hash, Undo2, Redo2, FolderTree, BookOpen, BarChart3, Shuffle } from "lucide-react";
import type { Exam, Mode, PreviewView, Question, QType } from "./types";
import { defaultLayout, sampleExam, uid, TYPE_META, PAPER_MM } from "./data";
import { plain } from "./math";
import { Button, RollingNumber, SharedPill, ToastProvider, cx, softSpring, spring, useToast } from "./ui";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { PreviewPane } from "./components/PreviewPane";
import { LayoutPanel } from "./components/LayoutPanel";
import { SettingsDialog, ACCENTS } from "./components/Settings";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { OcrDialog } from "./components/Ocr";
import { HistorySheet } from "./components/History";
import { AnswerCard, PaperPages } from "./components/Paper";
import { applyAccentPalette, setAppearance } from "./appearance";
import { setTelegramScheme } from "./telegram-scheme";
import { exportProject, exportTex, parseProject } from "./documents";
import { exportMarkdown } from "./markdown-export";
import type { ImportKind } from "./paper-import";
import { applySolutionMatches } from "./import-application";
import { ImportDialog, type ImportCommit } from "./components/ImportDialog";
import { loadWorkspace, saveWorkspace, saveText, type Snapshot, type WorkspaceData } from "./storage";
import { useWorkspaceUndo } from "./useWorkspaceUndo";
import { copyQuestions, defaultOptions, defaultScore, transferQuestions } from "./structure";
import { StructurePanel } from "./components/StructurePanel";
import { BatchPanel } from "./components/BatchPanel";
import { prepareDrawings, waitForDrawings } from "./drawing";
import { QuestionBankDialog } from "./components/QuestionBank";
import { BANK_DRAG_MIME, parseBankDrag, resolveBankDrag } from "./question-bank";
import { AbPaperDialog, ExamAnalysisDialog } from "./components/ExamTools";
import { GenerateQuestionDialog } from "./components/GenerateQuestion";
import type { GenerationAction } from "./generated-question";
import { isOcrPasteTarget } from "./ocr-queue";
import { ExportCenter, type ExportFormat } from "./components/ExportCenter";
import { examSnapshotFingerprint, type ExamMetadataPatch } from "./exam-ai";
import { BankSourceNotice } from "./components/BankSourceNotice";
import "./workspace-motion.css";

const BankWorkspace = lazy(() => import("./components/BankWorkspace").then(module => ({ default: module.BankWorkspace })));

export default function App() {
  const [motionPref, setMotionPref] = useState<"full" | "reduced">("full");
  return (
    <MotionConfig reducedMotion={motionPref === "reduced" ? "always" : "user"}>
      <ToastProvider>
        <Workspace motionPref={motionPref} setMotionPref={setMotionPref} />
      </ToastProvider>
    </MotionConfig>
  );
}

function Workspace({ motionPref, setMotionPref }: { motionPref: "full" | "reduced"; setMotionPref: (v: "full" | "reduced") => void }) {
  const toast = useToast();
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = motionPref === "reduced" || !!systemReducedMotion;
  const [initialExam] = useState(() => ({ ...sampleExam, id: uid() }));
  const { exam, layout, setExam, setLayout, reset: resetWorkspace, undo, redo, canUndo, canRedo } = useWorkspaceUndo(initialExam, defaultLayout);
  const [workArea, setWorkArea] = useState<"exam" | "bank">("exam");
  const [bankVisited, setBankVisited] = useState(false);
  useEffect(() => { if (workArea === "bank") setBankVisited(true); }, [workArea]);
  const [exportCenter, setExportCenter] = useState(false);
  const [printName, setPrintName] = useState("");
  const wordExporting = useRef(false);
  const [mode, setModeRaw] = useState<Mode>("edit");
  const [view, setView] = useState<PreviewView>("paper");
  const [activeId, setActiveId] = useState<string | null>("q1");
  const [dir, setDir] = useState(1);
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind>();
  const [history, setHistory] = useState(false);
  const [structure, setStructure] = useState(false);
  const [bank, setBank] = useState(false);
  const [examAnalysis, setExamAnalysis] = useState(false);
  const [abPaper, setAbPaper] = useState(false);
  const [aiTask, setAiTask] = useState<{ action: GenerationAction; question: Question }>();
  const [incomingPaste, setIncomingPaste] = useState<{ id: string; files: File[] }>();
  const [requestedSectionId, setRequestedSectionId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [ready, setReady] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [printing, setPrinting] = useState(false);
  const [accent, setAccent] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem("juanye.sidebar-expanded.v1") === "true"; }
    catch { return false; }
  });
  const importRef = useRef<HTMLInputElement>(null);
  const lastSaved = useRef("");
  const persistRef = useRef<() => Promise<void>>(async () => {});

  /* ---------- 派生数据 ---------- */
  const flat = useMemo(() => exam.sections.flatMap((s, si) => s.questions.map((q) => ({ q, s, si }))), [exam]);
  const score = flat.reduce((a, x) => a + x.q.score, 0);
  const count = flat.length;
  const idx = flat.findIndex((x) => x.q.id === activeId);
  const cur = idx >= 0 ? flat[idx] : null;
  useEffect(() => {
    const existing = new Set(flat.map(item => item.q.id));
    if (activeId && !existing.has(activeId)) setActiveId(flat[0]?.q.id ?? null);
    setSelected(previous => {
      const next = new Set([...previous].filter(id => existing.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [flat, activeId]);

  const select = useCallback(
    (id: string | null) => {
      if (id) {
        const ni = flat.findIndex((x) => x.q.id === id);
        setDir(ni >= idx ? 1 : -1);
      }
      setActiveId(id);
    },
    [flat, idx],
  );
  const go = (d: number) => {
    const n = flat[idx + d];
    if (n) select(n.q.id);
  };

  const setMode = (m: Mode) => {
    setWorkArea("exam");
    if (m === mode) return;
    setAnimating(true);
    setModeRaw(m);
    window.setTimeout(() => setAnimating(false), 750);
  };

  const updateQ = useCallback((id: string, patch: Partial<Question>) => {
    setExam((e) => {
      const original = e.sections.flatMap(s => s.questions).find(q => q.id === id);
      if (!original) return e;
      const updated = { ...original, ...patch };
      if (!patch.type || patch.type === original.type) return { ...e, sections: e.sections.map(s => ({ ...s, questions: s.questions.map(q => q.id === id ? updated : q) })) };
      const sections = e.sections.map(s => ({ ...s, questions: s.questions.filter(q => q.id !== id) }));
      let target = sections.find(s => s.type === updated.type);
      if (!target) { target = { id: uid(), type: updated.type, title: TYPE_META[updated.type].label, note: "", questions: [] }; sections.push(target); }
      target.questions.push(updated);
      return { ...e, sections };
    });
  }, []);

  const addQuestions = (qs: Question[]) => {
    setExam((e) => {
      const sections = e.sections.map((s) => ({ ...s, questions: [...s.questions] }));
      qs.forEach((q) => {
        const s = sections.find((x) => x.type === q.type);
        if (s) s.questions.push(q);
        else sections.push({ id: uid(), type: q.type, title: TYPE_META[q.type].label, note: "", questions: [q] });
      });
      return { ...e, sections };
    });
  };

  const insertBankQuestions = (questions: Question[], targetSectionId: string) => {
    const target = exam.sections.find(section => section.id === targetSectionId);
    if (!questions.length || !target) throw Error("请选择有效的目标大题");
    if (target.questions.length + questions.length > 1000 || count + questions.length > 2000) throw Error("单个大题最多1000道题，整卷最多2000道题，请分卷导入");
    setExam(previous => ({ ...previous, sections: previous.sections.map(section => section.id === targetSectionId ? { ...section, questions: [...section.questions, ...questions] } : section) }));
    setActiveId(questions[0].id); setMode("edit");
    toast({ title: `已从题库加入 ${questions.length} 道题` });
  };

  const createExamFromBank = async (questions: Question[]) => {
    if (!questions.length || questions.length > 2000) throw Error("请选择 1–2000 道题");
    if (!window.confirm("用选题篮新建试卷？当前卷会保留在历史记录中。")) throw Error("已取消新建试卷");
    const snapshot: Snapshot = { id: uid(), at: Date.now(), label: `${exam.title} · 从题库新建前`, exam: structuredClone(exam), layout: { ...layout } };
    const nextHistory = [snapshot, ...snapshots].slice(0, 50);
    await saveWorkspace({ version: 1, exam, layout, history: nextHistory });
    const sections: Exam["sections"] = [];
    for (const question of questions) {
      let section = sections.find(value => value.type === question.type);
      if (!section) { section = { id: uid(), type: question.type, title: TYPE_META[question.type].label, note: "", questions: [] }; sections.push(section); }
      if (section.questions.length >= 1000) throw Error("同题型最多 1000 道题，请分卷创建");
      section.questions.push(question);
    }
    setSnapshots(nextHistory); setExam({ id: uid(), title: "题库选题试卷", subtitle: "", duration: 120, notice: [], sections });
    setActiveId(questions[0].id); setMode("edit");
    toast({ title: `已用 ${questions.length} 道题新建试卷` });
  };

  const applyExamMetadata = (patches: ExamMetadataPatch[], expectedFingerprint: string) => {
    if (examSnapshotFingerprint(exam) !== expectedFingerprint) { toast({ title: "试卷已变更，请刷新分析后再采用", tone: "warn" }); return false; }
    const updates = new Map(patches.map(patch => [patch.id, patch]));
    setExam(previous => ({ ...previous, sections: previous.sections.map(section => ({ ...section, questions: section.questions.map(question => { const patch = updates.get(question.id); return patch ? { ...question, ...("knowledge" in patch ? { knowledge: patch.knowledge } : {}), ...("difficulty" in patch ? { difficulty: patch.difficulty } : {}) } : question; }) })) }));
    toast({ title: `已更新 ${patches.length} 道题的属性`, desc: "可撤销" }); return true;
  };

  const applyBPaper = async (next: Exam) => {
    const snapshot: Snapshot = { id: uid(), at: Date.now(), label: `${exam.title} · 生成B卷前`, exam: structuredClone(exam), layout: { ...layout } };
    const nextHistory = [snapshot, ...snapshots].slice(0, 50);
    try {
      await saveWorkspace({ version: 1, exam, layout, history: nextHistory });
      setSnapshots(nextHistory); setExam(next);
      toast({ title: "B 卷已生成", desc: "原卷保留在历史记录，可撤销" });
    } catch (error) { toast({ title: "原卷备份失败，未生成 B 卷", desc: String(error), tone: "warn" }); }
  };

  const applyGenerated = (question: Question) => {
    if (!aiTask) return;
    const current = exam.sections.flatMap(section => section.questions).find(value => value.id === aiTask.question.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(aiTask.question)) { toast({ title: "原题已更改，请重新生成", tone: "warn" }); return; }
    if (aiTask.action === "analysis") updateQ(current.id, { analysis: question.analysis, flag: question.flag });
    else {
      setExam(previous => ({ ...previous, sections: previous.sections.map(section => ({ ...section, questions: section.questions.flatMap(value => value.id === current.id ? [value, question] : [value]) })) }));
      setActiveId(question.id);
    }
    setAiTask(undefined); toast({ title: "草稿已加入 · 待核对" });
  };

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (workArea !== "exam" || !ready || ocr || settings || palette || bank || history || structure || batch || importKind || aiTask || abPaper || examAnalysis || exportCenter) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter(file => /^image\/(png|jpeg|webp)$/.test(file.type));
      if (!files.length || event.defaultPrevented) return;
      // A pure screenshot works even when the stem editor has focus. A mixed
      // text+image clipboard still belongs to the focused text field.
      if (!isOcrPasteTarget(event.target) && event.clipboardData?.getData("text/plain")) return;
      event.preventDefault(); setIncomingPaste({ id: uid(), files }); setOcr(true);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [workArea, ready, ocr, settings, palette, bank, history, structure, batch, importKind, aiTask, abPaper, examAnalysis, exportCenter]);

  const newQuestion = (sectionId?: string) => {
    const sec = exam.sections.find(section => section.id === sectionId) ?? cur?.s ?? exam.sections[0];
    if (!sec) {
      const q: Question = { id: uid(), type: "essay", score: 12, stem: "", options: [], answer: [], analysis: "" };
      addQuestions([q]); setActiveId(q.id); return;
    }
    const q: Question = { id: uid(), type: sec.type, score: sec.questions[0]?.score ?? defaultScore(sec.type), stem: "", options: defaultOptions(sec.type), answer: [], analysis: "" };
    setExam((e) => ({ ...e, sections: e.sections.map((s) => (s.id === sec.id ? { ...s, questions: [...s.questions, q] } : s)) }));
    setDir(1);
    setActiveId(q.id);
    if (mode !== "edit") setMode("edit");
  };

  const removeQuestions = (ids: Set<string>) => {
    setExam((e) => ({ ...e, sections: e.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => !ids.has(q.id)) })) }));
    if (activeId && ids.has(activeId)) setActiveId(null);
  };

  /** 校对：把误识别为选择题的题目转成解答题，并从题干提取分值 */
  const convertToEssay = (id: string) => {
    const found = flat.find((x) => x.q.id === id);
    if (!found) return;
    const m = found.q.stem.match(/^\s*[(（](\d+)\s*分[)）]\s*/);
    const moved: Question = {
      ...found.q,
      type: "essay",
      score: m ? Number(m[1]) : found.q.score,
      stem: m ? found.q.stem.slice(m[0].length) : found.q.stem,
      options: [],
      answer: [],
      flag: undefined,
    };
    setExam((e) => {
      const sections = e.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== id) }));
      let target = sections.find((s) => s.type === "essay");
      if (!target) { target = { id: uid(), type: "essay", title: "解答题", note: "", questions: [] }; sections.push(target); }
      if (target) target.questions = [moved, ...target.questions];
      return { ...e, sections };
    });
    toast({ title: "已转为解答题", desc: m ? `并从题干识别出分值 ${m[1]} 分` : "已移动到解答题" });
  };

  /* ---------- 本地草稿与可恢复历史 ---------- */
  useEffect(() => {
    let live = true;
    loadWorkspace().then(raw => {
      if (!live) return;
      if (raw) {
        const data = raw as WorkspaceData;
        if (data.version !== 1 || !Array.isArray(data.exam?.sections) || !data.layout?.paper || !Array.isArray(data.history)) throw new Error("本地草稿格式无效，未覆盖原文件");
        resetWorkspace({ exam: { ...data.exam, id: data.exam.id || uid() }, layout: data.layout }); setSnapshots(data.history);
        setActiveId(data.exam.sections.flatMap(s => s.questions)[0]?.id ?? null);
        lastSaved.current = JSON.stringify({ exam: data.exam, layout: data.layout });
      }
      setReady(true);
    }).catch(error => { if (live) { setSaveError(String(error.message || error)); toast({ title: "草稿载入失败", desc: String(error.message || error), tone: "warn" }); } });
    return () => { live = false; };
  }, []);

  persistRef.current = async () => {
    if (!ready) return;
    const serialized = JSON.stringify({ exam, layout });
    if (serialized === lastSaved.current) { setSaving(false); return; }
    setSaving(true);
    const snapshot: Snapshot = { id: uid(), at: Date.now(), label: `${exam.title} · ${count} 题 · ${score} 分`, exam: structuredClone(exam), layout: { ...layout } };
    const nextHistory = [snapshot, ...snapshots].slice(0, 50);
    try {
      await saveWorkspace({ version: 1, exam, layout, history: nextHistory });
      lastSaved.current = serialized;
      setSnapshots(nextHistory); setSaveError("");
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    if (!ready) return;
    setSaving(true);
    const t = setTimeout(() => { void persistRef.current(); }, 600);
    return () => clearTimeout(t);
  }, [exam, layout, ready]);
  useEffect(() => {
    const flush = () => { void persistRef.current(); };
    window.addEventListener("juanye:flush", flush);
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("juanye:flush", flush); window.removeEventListener("pagehide", flush); };
  }, []);

  /* ---------- 强调色 ---------- */
  useEffect(() => {
    const [a, b] = ACCENTS[accent].c;
    applyAccentPalette(a, b);
  }, [accent]);

  /* ---------- 导出 PDF：渲染打印专用 DOM → window.print()（Electron 换成 webContents.printToPDF） ---------- */
  const exportPdf = (target: PreviewView = view, name = exam.title) => {
    if (printing) return;
    setView(target); setPrintName(name);
    setPrinting(true);
  };
  useEffect(() => {
    if (!printing) return;
    const [w, h] = PAPER_MM[layout.paper];
    const [pw, ph] = layout.orientation === "portrait" ? [w, h] : [h, w];
    const style = document.createElement("style");
    style.textContent = `@page { size: ${pw}mm ${ph}mm; margin: 0 }`;
    document.head.appendChild(style);
    let canceled = false;
    const run = async () => {
      try {
        await prepareDrawings(flat.flatMap(({ q }) => [q.stem, ...q.options, ...q.answer, q.analysis, q.drawing ?? ""]));
        await document.fonts.ready;
        await waitForDrawings(document.querySelector("#print-root") ?? document);
        const deadline = Date.now() + 12000;
        while (!canceled && Date.now() < deadline) {
          const pages = document.querySelectorAll("#print-root [data-pagination-ready='true']");
          if (pages.length) break;
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        if (canceled) return;
        if (!document.querySelector("#print-root [data-pagination-ready='true']")) throw new Error("分页未完成，请稍后重试");
        await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>("#print-root img")).map(image => image.decode().catch(() => {})));
        if (window.juanye) {
          const result = await window.juanye.exportPdf({ name: `${printName || exam.title}${view === "card" ? "_答题卡" : ""}`, widthMm: pw, heightMm: ph });
          if (!result.canceled) toast({ title: "PDF 已导出", desc: result.path });
        } else window.print();
      } catch (error) {
        toast({ title: "导出失败", desc: error instanceof Error ? error.message : String(error), tone: "warn" });
      } finally {
        if (!canceled) setPrinting(false);
        style.remove();
      }
    };
    const t = setTimeout(() => { void run(); }, 100);
    return () => { canceled = true; clearTimeout(t); style.remove(); };
  }, [printing]);

  const exportSource = async (name = exam.title) => {
    try { if (await saveText(name, exportTex(exam, layout), "tex")) toast({ title: "已导出 LaTeX 源文件" }); }
    catch (error) { toast({ title: "导出失败", desc: String(error), tone: "warn" }); }
  };
  const exportMd = async (name = exam.title) => {
    try { if (await saveText(name, exportMarkdown(exam, layout), "md")) toast({ title: "Markdown 已导出" }); }
    catch (error) { toast({ title: "导出失败", desc: error instanceof Error ? error.message : String(error), tone: "warn" }); }
  };
  const exportWord = async (name = exam.title) => {
    if (wordExporting.current) return;
    wordExporting.current = true;
    try {
      if (!window.juanye) throw Error("请使用桌面应用导出 Word");
      const result = await window.juanye.exportDocx({ name, exam, layout });
      if (!result.canceled) toast({ title: "Word 已导出" });
    } catch (error) { toast({ title: "Word 导出失败", desc: error instanceof Error ? error.message : String(error), tone: "warn" }); }
    finally { wordExporting.current = false; }
  };
  const exportWorkspace = async (name = exam.title) => {
    try { if (await saveText(name, exportProject(exam, layout), "juanye")) toast({ title: "项目已另存" }); }
    catch (error) { toast({ title: "另存失败", desc: String(error), tone: "warn" }); }
  };
  const importFile = async (file: File) => {
    try {
      const result = parseProject(await file.text());
      if (!window.confirm("打开该项目将替换当前工作区。当前版本会保留在历史记录中，是否继续？")) return;
      await persistRef.current();
      setExam({ ...result.exam, id: result.exam.id || uid() }); setLayout(result.layout); setWorkArea("exam");
      setActiveId(result.exam.sections.flatMap(s => s.questions)[0]?.id ?? null);
      toast({ title: "项目已打开" });
    } catch (error) { toast({ title: "导入失败", desc: error instanceof Error ? error.message : String(error), tone: "warn" }); }
  };
  const commitImport = (value: ImportCommit) => {
    if (value.kind === "solutions") {
      const result = applySolutionMatches(exam, value.matches, value.selected, value.overwrite);
      if (result.issues.length) throw new Error(result.issues.join("；"));
      if (!result.applied) throw new Error("没有可应用的答案或解析。");
      setExam(result.exam);
      const first = value.matches.find(match => value.selected.has(match.index) && match.target)?.target;
      if (first) { setActiveId(first.id); setMode("edit"); }
      toast({ title: `已应用 ${result.applied} 道解析` });
    } else {
      if (!value.questions.length) return;
      addQuestions(value.questions); setActiveId(value.questions[0].id); setMode("edit");
      toast({ title: `已导入 ${value.questions.length} 道题` });
    }
    setImportKind(undefined);
  };

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const editing = e.target instanceof HTMLElement && Boolean(e.target.closest("input,textarea,[contenteditable='true']"));
      if (mod && e.key.toLowerCase() === "k") (e.preventDefault(), setPalette((v) => !v));
      else if (mod && e.key === ",") (e.preventDefault(), setSettings(true));
      else if (workArea === "bank") return;
      else if (mod && e.key === "1") (e.preventDefault(), setMode("edit"));
      else if (mod && e.key === "2") (e.preventDefault(), setMode("preview"));
      else if (mod && e.key.toLowerCase() === "e") (e.preventDefault(), exportPdf());
      else if (mod && e.key.toLowerCase() === "n") (e.preventDefault(), newQuestion());
      else if (mod && e.key.toLowerCase() === "z" && !editing) (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if (mod && e.key.toLowerCase() === "y" && !editing) (e.preventDefault(), redo());
      else if (e.altKey && e.key === "ArrowDown") (e.preventDefault(), go(1));
      else if (e.altKey && e.key === "ArrowUp") (e.preventDefault(), go(-1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  /* ---------- 分栏宽度（数值驱动的弹簧动画，内容宽度固定避免重排） ---------- */
  const main = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1440);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width > 0) setW(e.contentRect.width); });
    ro.observe(main.current!);
    return () => ro.disconnect();
  }, []);
  const outlineFull = W < 1280 ? 340 : 364;
  const outlineWidth = sidebarExpanded ? outlineFull : 76;
  const previewCandidate = Math.round(Math.min(620, Math.max(400, W * 0.36)));
  const previewEdit = W < 1060 || W - outlineWidth - 520 < 320 ? 0 : Math.min(previewCandidate, W - outlineWidth - 520);
  const editorFull = Math.max(520, W - outlineWidth - previewEdit);
  const cols =
    mode === "edit"
      ? { outline: outlineWidth, layout: 0, editor: W - outlineWidth - previewEdit, preview: previewEdit }
      : { outline: 0, layout: 340, editor: 0, preview: W - 340 };
  const colT = animating ? { type: "spring" as const, stiffness: 210, damping: 30 } : { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] as const };
  const expandSidebar = (expanded: boolean) => {
    setSidebarExpanded(expanded);
    if (!expanded) { setBatch(false); setSelected(new Set()); }
  };
  useEffect(() => {
    try { localStorage.setItem("juanye.sidebar-expanded.v1", String(sidebarExpanded)); }
    catch { /* UI state remains usable when preference storage is unavailable. */ }
  }, [sidebarExpanded]);

  /* ---------- 命令面板 ---------- */
  const commands: Command[] = useMemo(
    () => [
      { id: "ocr", group: "功能", title: "一图多题识别", icon: <ScanText size={15} />, run: () => setOcr(true) },
      { id: "import-questions", group: "导入", title: "导入题目文件", icon: <FileInput size={15} />, run: () => setImportKind("questions") },
      { id: "import-solutions", group: "导入", title: "导入解析文件", icon: <FileInput size={15} />, run: () => setImportKind("solutions") },
      { id: "import-annotated", group: "导入", title: "导入解析版试卷", icon: <FileInput size={15} />, run: () => setImportKind("annotated") },
      { id: "batch", group: "功能", title: "批量编辑", icon: <ListChecks size={15} />, run: () => { setMode("edit"); setSidebarExpanded(true); setBatch(true); } },
      { id: "structure", group: "功能", title: "管理大题", icon: <FolderTree size={15} />, run: () => { setSidebarExpanded(true); setStructure(true); } },
      { id: "bank", group: "功能", title: "本地题库", icon: <BookOpen size={15} />, run: () => setWorkArea("bank") },
      { id: "bank-picker", group: "功能", title: "从题库选题", icon: <BookOpen size={15} />, run: () => { setWorkArea("exam"); setBank(true); } },
      { id: "exam-analysis", group: "功能", title: "试卷分析与双向细目表", icon: <BarChart3 size={15} />, run: () => setExamAnalysis(true) },
      { id: "ab-paper", group: "功能", title: "生成 B 卷（选项乱序）", icon: <Shuffle size={15} />, run: () => setAbPaper(true) },
      ...(cur ? [
        { id: "generate-variant", group: "当前题目", title: "生成变式题", icon: <Sparkles size={15} />, run: () => setAiTask({ action: "variant", question: structuredClone(cur.q) }) },
        { id: "generate-analysis", group: "当前题目", title: "补写解析草稿", icon: <Sparkles size={15} />, run: () => setAiTask({ action: "analysis", question: structuredClone(cur.q) }) },
      ] : []),
      { id: "undo", group: "编辑", title: "撤销", icon: <Undo2 size={15} />, kbd: "Ctrl Z", run: undo },
      { id: "redo", group: "编辑", title: "重做", icon: <Redo2 size={15} />, kbd: "Ctrl Shift Z", run: redo },
      { id: "history", group: "功能", title: "历史记录", icon: <HistoryIcon size={15} />, run: () => setHistory(true) },
      { id: "layout", group: "功能", title: "排版设置", icon: <SlidersHorizontal size={15} />, kbd: "Ctrl 2", run: () => setMode("preview") },
      { id: "new", group: "功能", title: "新建题目", icon: <Plus size={15} />, kbd: "Ctrl N", run: newQuestion },
      { id: "pdf", group: "导出", title: "导出 PDF", icon: <FileDown size={15} />, kbd: "Ctrl E", run: () => exportPdf() },
      { id: "export-center", group: "导出", title: "导出中心", icon: <FileDown size={15} />, run: () => setExportCenter(true) },
      { id: "word", group: "导出", title: "导出 Word（可编辑公式）", icon: <FileDown size={15} />, run: () => { void exportWord(); } },
      { id: "tex", group: "导出", title: "导出 .tex", icon: <FileCode2 size={15} />, run: () => { void exportSource(); } },
      { id: "markdown", group: "导出", title: "导出 Markdown", icon: <FileCode2 size={15} />, run: () => { void exportMd(); } },
      { id: "open-project", group: "项目", title: "打开项目", icon: <FileInput size={15} />, run: () => importRef.current?.click() },
      { id: "save", group: "项目", title: "另存可编辑项目", icon: <FileDown size={15} />, run: () => { void exportWorkspace(); } },
      { id: "blank", group: "项目", title: "新建空白试卷", icon: <Plus size={15} />, run: () => {
        if (!window.confirm("新建空白试卷？当前试卷会保留在历史记录中。")) return;
        void persistRef.current().then(() => { setExam({ id: uid(), title: "未命名试卷", subtitle: "", duration: 120, notice: [], sections: (["single", "multi", "blank", "essay"] as QType[]).map(type => ({ id: uid(), type, title: TYPE_META[type].label, note: "", questions: [] })) }); setActiveId(null); setWorkArea("exam"); });
      } },
      { id: "theme-dark", group: "外观", title: "深色模式", icon: <Eye size={15} />, run: () => setAppearance("dark") },
      { id: "theme-light", group: "外观", title: "淡色模式", icon: <Eye size={15} />, run: () => setAppearance("light") },
      { id: "theme-telegram", group: "外观", title: "Telegram 深色", icon: <Sparkles size={15} />, run: () => { setTelegramScheme("dark"); setAppearance("telegram"); } },
      { id: "theme-telegram-light", group: "外观", title: "Telegram 浅色", icon: <Sparkles size={15} />, run: () => { setTelegramScheme("light"); setAppearance("telegram"); } },
      { id: "edit", group: "视图", title: "切换到编辑", icon: <PenLine size={15} />, kbd: "Ctrl 1", run: () => setMode("edit") },
      { id: "prev", group: "视图", title: "切换到排版预览", icon: <Eye size={15} />, run: () => setMode("preview") },
      { id: "model", group: "设置", title: "Qwen 模型设置", icon: <Sparkles size={15} />, kbd: "Ctrl ,", run: () => setSettings(true) },
      ...flat.map((x, i) => ({
        id: x.q.id,
        group: "题目",
        title: `第 ${i + 1} 题 · ${plain(x.q.stem) || "（空题干）"}`,
        hint: x.s.title,
        icon: <Hash size={15} />,
        run: () => (setMode("edit"), select(x.q.id)),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flat, exam, layout, mode, ready, printing, activeId],
  );

  const neighbor = (d: number) => {
    const n = flat[idx + d];
    return n ? { num: idx + d + 1, stem: plain(n.q.stem) } : undefined;
  };

  return (
    <div className="app-bg flex h-full min-w-[960px] flex-col" data-interface-motion={motionPref}
      onDragOverCapture={event => { if (event.dataTransfer.types.includes(BANK_DRAG_MIME) && event.target instanceof Element && event.target.closest("[data-section-id],[data-section-target],.workspace-editor-stage,.workspace-preview-stage")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
      onDropCapture={event => {
        if (!event.dataTransfer.types.includes(BANK_DRAG_MIME) || !(event.target instanceof Element)) return;
        const target = event.target.closest("[data-section-id],[data-section-target],.workspace-editor-stage,.workspace-preview-stage");
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        const sectionId = target.getAttribute("data-section-id") || target.getAttribute("data-section-target") || cur?.s.id || exam.sections[0]?.id;
        if (!sectionId) { toast({ title: "请先创建一个大题", tone: "warn" }); return; }
        try { const ids = parseBankDrag(event.dataTransfer.getData(BANK_DRAG_MIME)); void resolveBankDrag(ids).then(questions => insertBankQuestions(questions, sectionId)).catch(error => toast({ title: "题库拖入失败", desc: String(error), tone: "warn" })); }
        catch (error) { toast({ title: "题库拖入失败", desc: String(error), tone: "warn" }); }
      }}>
      <TitleBar
        title={exam.title}
        mode={mode}
        setMode={setMode}
        saving={saving || !ready}
        saveError={saveError}
        onPalette={() => setPalette(true)}
        onHistory={() => setHistory(true)}
        onSettings={() => setSettings(true)}
        onExport={() => exportPdf()}
        onExportMore={() => setExportCenter(true)}
        workspace={workArea}
      />

      <nav aria-label="工作区" className="workspace-nav relative z-20 flex h-11 shrink-0 items-center gap-1 border-b border-line px-4">
        {([{ id: "exam", label: "组卷", icon: PenLine }, { id: "bank", label: "本地题库", icon: BookOpen }] as const).map(item => <Button key={item.id} size="sm" variant="ghost" className="workspace-tab" aria-current={workArea === item.id ? "page" : undefined} onClick={() => setWorkArea(item.id)}>
          {workArea === item.id && <SharedPill layoutId="workspace-main-tab" transition={spring} className="workspace-tab-indicator" />}
          <item.icon size={15} /><span>{item.label}</span>
        </Button>)}
        <div className="ml-auto flex items-center gap-1">{workArea === "exam" ? <>
          <Button variant="ghost" size="sm" icon={<BookOpen size={14} />} onClick={() => setBank(true)}>从题库选题</Button>
          <Button variant="ghost" size="sm" icon={<BarChart3 size={14} />} onClick={() => setExamAnalysis(true)}>试卷分析</Button>
          <Button variant="ghost" size="sm" icon={<Shuffle size={14} />} onClick={() => setAbPaper(true)}><span className="nav-secondary-label">生成 </span>B 卷</Button>
        </> : <motion.span key="bank-exam-summary" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={softSpring} className="workspace-paper-summary"><span>{exam.title}</span><span className="workspace-paper-summary-count"><RollingNumber value={count} /> 题 · <RollingNumber value={score} /> 分</span></motion.span>}</div>
      </nav>

      <div ref={main} className="workspace-stage relative flex min-h-0 flex-1 overflow-hidden">
        <div className="workspace-wallpaper" aria-hidden="true" />
        <motion.div className="workspace-view workspace-view-exam" data-workspace-view="exam" aria-hidden={workArea !== "exam"} {...(workArea !== "exam" ? { inert: "" } : {})} initial={false}
          animate={workArea === "exam" ? { opacity: 1, x: 0, visibility: "visible" } : { opacity: 0, x: reducedMotion ? 0 : -14, transitionEnd: { visibility: "hidden" } }}
          transition={{ opacity: { duration: workArea === "exam" ? 0.22 : 0.14 }, x: softSpring }} style={{ pointerEvents: workArea === "exam" ? "auto" : "none", zIndex: workArea === "exam" ? 2 : 1 }}>
        {/* 左：试卷结构 */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ width: cols.outline, opacity: cols.outline ? 1 : 0, x: 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 }, x: softSpring }}
          className="shrink-0 overflow-hidden border-r border-line bg-panel/80"
          style={{ "--sidebar-expanded-width": `${outlineFull}px` } as CSSProperties}
        >
            <Sidebar
              expanded={sidebarExpanded}
              onExpandedChange={expandSidebar}
              requestedSectionId={requestedSectionId}
              exam={exam}
              activeId={activeId}
              onSelect={select}
              onReorder={(sid, qs) => setExam((e) => ({ ...e, sections: e.sections.map((s) => (s.id === sid ? { ...s, questions: qs } : s)) }))}
              batch={batch}
              setBatch={(v) => { if (v) setSidebarExpanded(true); setBatch(v); setSelected(new Set()); }}
              selected={selected}
              toggleSelect={(id) =>
                setSelected((s) => {
                  const n = new Set(s);
                  n.has(id) ? n.delete(id) : n.add(id);
                  return n;
                })
              }
              score={score}
              count={count}
              onAdd={newQuestion}
              onOcr={() => setOcr(true)}
              onManageSections={() => setStructure(true)}
              onSelectSection={(sectionId) => {
                const ids = exam.sections.find(section => section.id === sectionId)?.questions.map(q => q.id) ?? [];
                setSelected(previous => {
                  const next = new Set(previous);
                  const allSelected = ids.every(id => next.has(id));
                  ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
                  return next;
                });
              }}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onJumpFlag={() => {
                const f = flat.find((x) => x.q.flag);
                if (f) select(f.q.id);
              }}
            />
        </motion.div>

        {/* 左：排版面板（预览模式） */}
        <motion.div
          initial={false}
          animate={{ width: cols.layout, opacity: cols.layout ? 1 : 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 } }}
          className="shrink-0 overflow-hidden border-r border-line bg-panel/80"
        >
          <LayoutPanel layout={layout} setLayout={setLayout} exam={exam} setExam={setExam} onDone={() => setMode("edit")} />
        </motion.div>

        {/* 中：题目编辑 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ width: cols.editor, opacity: cols.editor ? 1 : 0, y: 0 }}
          transition={{ ...colT, opacity: { duration: 0.2 }, y: { ...softSpring, delay: 0.05 } }}
          className="workspace-editor-stage shrink-0 overflow-hidden"
        >
          <div style={{ width: mode === "edit" ? cols.editor : editorFull }} className="flex h-full flex-col">
            {cur?.q.bankOrigin && <div className="shrink-0 px-5 pt-3"><BankSourceNotice question={cur.q} active={workArea === "exam" && mode === "edit"} onAdopt={incoming => {
              const current = cur.q;
              updateQ(current.id, {
                bankOrigin: undefined, image: undefined, sourceImage: undefined, figure: undefined, figures: undefined, drawing: undefined,
                source: undefined, knowledge: undefined, difficulty: undefined, flag: undefined, pageBreakBefore: undefined,
                answerSpace: undefined, paperAnswerSpace: undefined, importNumber: undefined,
                ...incoming, id: current.id,
              });
              toast({ title: "已采用题库新版本", desc: "可撤销" });
            }} /></div>}
            <div className="min-h-0 flex-1">
            <Editor
              q={cur?.q ?? null}
              paperMode={layout.paperMode}
              dataReady={ready}
              sec={cur?.s ?? null}
              secIndex={cur?.si ?? 0}
              num={idx + 1}
              total={count}
              dir={dir}
              onChange={(p) => activeId && updateQ(activeId, p)}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onConvert={() => activeId && convertToEssay(activeId)}
              onDelete={() => activeId && (removeQuestions(new Set([activeId])), toast({ title: "已删除题目" }))}
              onDuplicate={() => activeId && setExam(exam => copyQuestions(exam, new Set([activeId])))}
              onMove={(sectionId) => activeId && setExam(exam => transferQuestions(exam, new Set([activeId]), sectionId))}
              sections={exam.sections}
              onStart={() => flat[0] && select(flat[0].q.id)}
              onOcr={() => setOcr(true)}
              neighbors={{ prev: neighbor(-1), next: neighbor(1) }}
            />
            </div>
          </div>
        </motion.div>

        {/* 右：实时预览 */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ width: cols.preview, opacity: cols.preview ? 1 : 0, x: 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 }, x: { ...softSpring, delay: 0.1 } }}
          className={cx("workspace-preview-stage shrink-0 overflow-hidden", mode === "edit" && "border-l border-line")}
        >
          <PreviewPane
            exam={exam}
            layout={layout}
            view={view}
            setView={setView}
            mode={mode}
            activeId={activeId}
            onPick={(id) => select(id)}
            onLayout={() => setMode(mode === "edit" ? "preview" : "edit")}
            onTex={() => { void exportSource(); }}
            score={score}
            count={count}
          />
        </motion.div>
        </motion.div>
        {bankVisited && <motion.div className="workspace-view workspace-view-bank" data-workspace-view="bank" aria-hidden={workArea !== "bank"} {...(workArea !== "bank" ? { inert: "" } : {})}
          initial={{ opacity: 0, x: reducedMotion ? 0 : 16 }} animate={workArea === "bank" ? { opacity: 1, x: 0, visibility: "visible" } : { opacity: 0, x: reducedMotion ? 0 : 16, transitionEnd: { visibility: "hidden" } }}
          transition={{ opacity: { duration: workArea === "bank" ? 0.22 : 0.14 }, x: softSpring }} style={{ pointerEvents: workArea === "bank" ? "auto" : "none", zIndex: workArea === "bank" ? 2 : 1 }}><Suspense fallback={<div className="relative m-auto text-muted">正在打开题库…</div>}><BankWorkspace active={workArea === "bank"} exam={exam} examId={exam.id} currentQuestion={cur?.q} currentSelection={flat.filter(({ q }) => selected.has(q.id)).map(({ q }) => q)} onInsert={insertBankQuestions} onCreateExam={createExamFromBank} onBack={() => setWorkArea("exam")} /></Suspense></motion.div>}
      </div>

      <AnimatePresence initial={false}>
      {batch && <BatchPanel key="batch-panel" paperMode={layout.paperMode} exam={exam} selected={selected} onSelection={setSelected} onChange={setExam} onClose={() => { setBatch(false); setSelected(new Set()); }} />}
      {structure && <StructurePanel key="structure-panel" exam={exam} onChange={setExam} onClose={() => setStructure(false)} onSelect={id => { setMode("edit"); setSidebarExpanded(true); setRequestedSectionId(id); }} />}
      {bank && <QuestionBankDialog key="bank-picker" open={bank} onClose={() => setBank(false)} exam={exam} sections={exam.sections} currentQuestion={cur?.q} onInsert={insertBankQuestions} />}
      {examAnalysis && <ExamAnalysisDialog key="exam-analysis" open={examAnalysis} onClose={() => setExamAnalysis(false)} exam={exam} onLocate={id => { setExamAnalysis(false); setMode("edit"); select(id); }} onApplyMetadata={applyExamMetadata} />}
      {abPaper && <AbPaperDialog key="ab-paper" open={abPaper} onClose={() => setAbPaper(false)} exam={exam} onApply={next => { void applyBPaper(next); }} />}
      {aiTask && <GenerateQuestionDialog key="generate-question" open source={aiTask.question} action={aiTask.action} onClose={() => setAiTask(undefined)} onApply={applyGenerated} />}
      {exportCenter && <ExportCenter key="export-center" exam={exam} layout={layout} view={view} onClose={() => setExportCenter(false)} onExport={async (format: ExportFormat, name, target) => { if (format === "pdf") exportPdf(target, name); else if (format === "docx") await exportWord(name); else if (format === "md") await exportMd(name); else if (format === "tex") await exportSource(name); else await exportWorkspace(name); }} />}
      </AnimatePresence>

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
      {importKind && <ImportDialog kind={importKind} exam={exam} onClose={() => setImportKind(undefined)} onCommit={commitImport} />}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} accent={accent} setAccent={setAccent} motionPref={motionPref} setMotionPref={setMotionPref} />
      <OcrDialog
        open={ocr}
        incomingPaste={incomingPaste}
        onClose={() => { setOcr(false); setIncomingPaste(undefined); }}
        onAdd={(qs) => {
          addQuestions(qs);
          toast({ title: `已添加 ${qs.length} 道题` });
          setTimeout(() => select(qs[0].id), 50);
        }}
      />
      <HistorySheet open={history} onClose={() => setHistory(false)} items={snapshots} onRestore={snapshot => {
        if (!window.confirm("恢复该版本？当前内容将保留为历史快照。")) return;
        void persistRef.current().then(() => { setExam({ ...structuredClone(snapshot.exam), id: snapshot.exam.id || uid() }); setLayout({ ...snapshot.layout }); setActiveId(snapshot.exam.sections.flatMap(s => s.questions)[0]?.id ?? null); setWorkArea("exam"); setHistory(false); toast({ title: "已恢复历史版本" }); });
      }} />
      <input
        ref={importRef}
        type="file"
        hidden
        aria-label="打开卷页项目"
        accept=".juanye,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = "";
        }}
      />

      {/* 打印专用 DOM：1:1 尺寸，不带缩放 */}
      {printing &&
        createPortal(
          <div id="print-root" aria-hidden="true" style={{ position: "fixed", left: -100000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
            {view === "paper" ? (
              <PaperPages exam={exam} layout={layout} totalScore={score} qCount={count} print render={(p) => p} />
            ) : (
              <AnswerCard exam={exam} layout={layout} print />
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
