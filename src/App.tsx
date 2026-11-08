import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Eye, FileCode2, FileDown, FileInput, History as HistoryIcon, ListChecks, LoaderCircle, PenLine, Plus, ScanText, SlidersHorizontal, Sparkles, Hash, Undo2, Redo2, FolderTree, BookOpen, BarChart3, Shuffle, ChevronDown, NotebookPen, MountainSnow, Maximize2, Minimize2 } from "lucide-react";
import type { Exam, Mode, PreviewView, Question, QType } from "./types";
import { defaultLayout, sampleExam, uid, TYPE_META, PAPER_MM } from "./data";
import { plain } from "./math";
import { Button, IconButton, Segmented, ToastProvider, cx, softSpring, useToast } from "./ui";
import { SaveBadge, TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { PreviewPane } from "./components/PreviewPane";
import { LayoutPanel } from "./components/LayoutPanel";
import { ACCENTS } from "./accents";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { AnswerCard, PaperPages } from "./components/Paper";
import { applyAccentPalette, setAppearance, withThemeTransition } from "./appearance";
import { setAura } from "./aura";
import { setTelegramScheme } from "./telegram-scheme";
import { exportProject, exportTex, parseProject } from "./documents";
import { exportMarkdown } from "./markdown-export";
import type { ImportKind } from "./paper-import";
import { applySolutionMatches } from "./import-application";
import type { ImportCommit } from "./components/ImportDialog";
import { loadWorkspace, saveWorkspace, saveText, type Snapshot, type WorkspaceData } from "./storage";
import { useWorkspaceUndo } from "./useWorkspaceUndo";
import { copyQuestions, defaultOptions, defaultScore, transferQuestions } from "./structure";
import { prepareDrawings, waitForDrawings } from "./drawing";
import { BANK_DRAG_MIME, parseBankDrag, resolveBankDrag } from "./question-bank";
import type { GenerationAction } from "./generated-question";
import { isOcrPasteTarget } from "./ocr-queue";
import type { ExportFormat } from "./components/ExportCenter";
import { examSnapshotFingerprint, missingReportMetadataPatches, previewMetadataPatches, reportMatchesExam, type ExamAiReport, type ExamMetadataPatch } from "./exam-ai";
import { ExamMetadataReceipts } from "./exam-ai-autofill";
import { BankSourceNotice } from "./components/BankSourceNotice";
import { AUTO_SECTION, distributeByType, patchWorkspaceQuestion } from "./workspace-edits";
import { SceneBackdrop } from "./SceneBackdrop";
import { WorkspaceView } from "./components/WorkspaceView";
import type { WorkbookHandle } from "./workbook/WorkbookWorkspace";
import { ExamAiSession } from "./exam-ai-session";
import "./workspace-motion.css";
import "./components/workspace-tools.css";

const BankWorkspace = lazy(() => import("./components/BankWorkspace").then(module => ({ default: module.BankWorkspace })));
const WorkbookWorkspace = lazy(() => import("./workbook/WorkbookWorkspace").then(module => ({ default: module.WorkbookWorkspace })));
// 低频弹窗按需加载：首屏包只包含编辑与预览。
const SettingsDialog = lazy(() => import("./components/Settings").then(module => ({ default: module.SettingsDialog })));
const OcrDialog = lazy(() => import("./components/Ocr").then(module => ({ default: module.OcrDialog })));
const HistorySheet = lazy(() => import("./components/History").then(module => ({ default: module.HistorySheet })));
const ImportDialog = lazy(() => import("./components/ImportDialog").then(module => ({ default: module.ImportDialog })));
const StructurePanel = lazy(() => import("./components/StructurePanel").then(module => ({ default: module.StructurePanel })));
const BatchPanel = lazy(() => import("./components/BatchPanel").then(module => ({ default: module.BatchPanel })));
const QuestionBankDialog = lazy(() => import("./components/QuestionBank").then(module => ({ default: module.QuestionBankDialog })));
const ExamAnalysisDialog = lazy(() => import("./components/ExamTools").then(module => ({ default: module.ExamAnalysisDialog })));
const AbPaperDialog = lazy(() => import("./components/ExamTools").then(module => ({ default: module.AbPaperDialog })));
const GenerateQuestionDialog = lazy(() => import("./components/GenerateQuestion").then(module => ({ default: module.GenerateQuestionDialog })));
const ExportCenter = lazy(() => import("./components/ExportCenter").then(module => ({ default: module.ExportCenter })));
/** 打开过一次后保持挂载，关闭时仍能播放原有的退出动画。 */
function useEverTrue(value: boolean) {
  const [ever, setEver] = useState(value);
  if (value && !ever) setEver(true);
  return ever || value;
}
const WorkspaceSidebar = memo(Sidebar);
const WorkspaceLayoutPanel = memo(LayoutPanel);
const EMPTY_COMMANDS: Command[] = [];

const LAST_QUESTION_KEY = "juanye.last-question.v1";
const SESSION_KEY = "juanye.session.v1";
/** 应用重新打开时回到上次编辑的题目；窗口内重载（sessionStorage 仍在）照旧从第 1 题开始。 */
function resumeQuestion(exam: Exam): string | null {
  const ids = exam.sections.flatMap(section => section.questions.map(question => question.id));
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      const saved = JSON.parse(localStorage.getItem(LAST_QUESTION_KEY) || "null") as { examId?: string; questionId?: string } | null;
      if (saved && saved.examId === exam.id && saved.questionId && ids.includes(saved.questionId)) return saved.questionId;
    }
  } catch { /* 存储不可用时从第 1 题开始 */ }
  return ids[0] ?? null;
}
function markSessionStarted() { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ } }

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

/** 编辑 / 排版预览切换：独立 memo，打字时其高亮药丸不参与布局测量。 */
const MODE_OPTIONS = [{ value: "edit" as Mode, label: "编辑", icon: <PenLine size={13} /> }, { value: "preview" as Mode, label: "排版预览", icon: <Eye size={13} /> }];
const ModeSwitch = memo(function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <Segmented size="sm" value={mode} onChange={setMode} options={MODE_OPTIONS} />;
});

function Workspace({ motionPref, setMotionPref }: { motionPref: "full" | "reduced"; setMotionPref: (v: "full" | "reduced") => void }) {
  const toast = useToast();
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = motionPref === "reduced" || !!systemReducedMotion;
  const [initialExam] = useState(() => ({ ...sampleExam, id: uid() }));
  const { exam, layout, setExam, setLayout, reset: resetWorkspace, undo, redo, canUndo, canRedo } = useWorkspaceUndo(initialExam, defaultLayout);
  const [workArea, setWorkArea] = useState<"exam" | "bank" | "workbook">("exam");
  const [bankVisited, setBankVisited] = useState(false);
  const [workbookVisited, setWorkbookVisited] = useState(false);
  const workbookHandle = useRef<WorkbookHandle>(null);
  useEffect(() => { if (workArea === "bank") setBankVisited(true); if (workArea === "workbook") setWorkbookVisited(true); }, [workArea]);
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
  const [examAnalysisInitialTab, setExamAnalysisInitialTab] = useState<"overview" | "ai">("overview");
  const [examAiSession] = useState(() => new ExamAiSession(() => window.juanye));
  const examAiTask = useSyncExternalStore(examAiSession.subscribe, examAiSession.getSnapshot, examAiSession.getSnapshot);
  const examAiIndicatorVisible = examAiTask.background && (examAiTask.phase === "running" || !examAiTask.viewed && ["success", "error"].includes(examAiTask.phase));
  const examAiNotified = useRef("");
  const openExamAnalysis = useCallback(() => { setExamAnalysisInitialTab("overview"); setExamAnalysis(true); }, []);
  const closeExamAnalysis = useCallback(() => { if (!examAiSession.getSnapshot().background) examAiSession.cancel(); examAiSession.acknowledge(); setExamAnalysis(false); }, [examAiSession]);
  useEffect(() => () => examAiSession.cancel(), [examAiSession]);
  useEffect(() => {
    if (!examAiTask.background || !["success", "error"].includes(examAiTask.phase) || examAiNotified.current === examAiTask.taskId) return;
    examAiNotified.current = examAiTask.taskId;
    toast(examAiTask.phase === "success" ? examAiTask.report?.aggregateStatus === "unavailable"
      ? { title: "逐题评析完成，整卷综合未完成", desc: "结果已保留，点击左下角查看原因", tone: "warn" }
      : { title: "试卷分析完成", desc: "点击左下角查看报告" }
      : { title: "试卷分析失败", desc: "点击左下角查看原因", tone: "warn" });
  }, [examAiTask, toast]);
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
  // 专注编辑：收起目录与预览，只留编辑区；不持久化，重开应用恢复常规布局。
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    // v2：目录默认展开，能直接看到题号与题干摘要。
    try { const stored = localStorage.getItem("juanye.sidebar-expanded.v2"); return stored === null ? true : stored === "true"; }
    catch { return false; }
  });
  const importRef = useRef<HTMLInputElement>(null);
  const lastSaved = useRef("");
  const lastSavedFrame = useRef<{ exam: Exam; layout: typeof layout }>();
  const persistRef = useRef<() => Promise<void>>(async () => {});
  const [metadataReceipts] = useState(() => { try { return new ExamMetadataReceipts(window.localStorage); } catch { return new ExamMetadataReceipts(); } });
  const autoMetadataNotice = useRef<{ fingerprint: string; count: number }>();
  const currentExam = useRef(exam); currentExam.current = exam;
  const autoFillReportMetadata = useCallback((report: ExamAiReport) => {
    const current = currentExam.current;
    if (!ready || metadataReceipts.has(report) || !reportMatchesExam(report, current)) return;
    const patches = missingReportMetadataPatches(report, current);
    metadataReceipts.mark(report);
    if (!patches.length) {
      if (lastSavedFrame.current?.exam === current) metadataReceipts.flush();
      return;
    }
    const expected = examSnapshotFingerprint(current);
    autoMetadataNotice.current = { fingerprint: examSnapshotFingerprint(previewMetadataPatches(current, patches)), count: patches.length };
    // Check again in the reducer, not just in the completion effect: queued
    // edits must never be overwritten by an older successful request.
    setExam(previous => examSnapshotFingerprint(previous) === expected ? previewMetadataPatches(previous, patches) : previous);
  }, [ready, metadataReceipts, setExam]);
  useEffect(() => {
    if (examAiTask.phase === "success" && examAiTask.report) autoFillReportMetadata(examAiTask.report);
  }, [examAiTask.phase, examAiTask.report, autoFillReportMetadata]);
  useEffect(() => {
    const notice = autoMetadataNotice.current;
    if (!notice) return;
    autoMetadataNotice.current = undefined;
    if (examSnapshotFingerprint(exam) === notice.fingerprint) toast({ title: `已自动补全 ${notice.count} 道题的属性`, desc: "已有属性保留，可撤销" });
  }, [exam, toast]);

  /* ---------- 派生数据 ---------- */
  const flat = useMemo(() => exam.sections.flatMap((s, si) => s.questions.map((q) => ({ q, s, si }))), [exam.sections]);
  const score = useMemo(() => flat.reduce((a, x) => a + x.q.score, 0), [flat]);
  const count = flat.length;
  const bankSelection = useMemo(() => flat.filter(({ q }) => selected.has(q.id)).map(({ q }) => q), [flat, selected]);
  const indexById = useMemo(() => new Map(flat.map((item, index) => [item.q.id, index])), [flat]);
  const idx = activeId ? indexById.get(activeId) ?? -1 : -1;
  const cur = idx >= 0 ? flat[idx] : null;
  useEffect(() => {
    if (activeId && !indexById.has(activeId)) setActiveId(flat[0]?.q.id ?? null);
    setSelected(previous => {
      const next = new Set([...previous].filter(id => indexById.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [flat, indexById, activeId]);

  // 记住正在编辑的题目：下次打开应用时回到这里（同一窗口内重载不改变原有行为）。
  useEffect(() => {
    if (!ready || !activeId) return;
    try { localStorage.setItem(LAST_QUESTION_KEY, JSON.stringify({ examId: exam.id, questionId: activeId })); } catch { /* 只是便利功能 */ }
  }, [ready, activeId, exam.id]);
  // 任务栏与 Alt+Tab 里显示当前试卷名。
  useEffect(() => { const title = exam.title?.trim(); document.title = title ? `${title} - 卷页` : "卷页"; }, [exam.title]);

  const select = useCallback(
    (id: string | null) => {
      if (id) {
        const ni = indexById.get(id) ?? -1;
        setDir(ni >= idx ? 1 : -1);
      }
      setActiveId(id);
    },
    [indexById, idx],
  );
  const go = useCallback((d: number) => {
    const n = flat[idx + d];
    if (n) select(n.q.id);
  }, [flat, idx, select]);

  const setMode = useCallback((m: Mode) => {
    setWorkArea("exam");
    if (m === mode) return;
    setAnimating(true);
    setModeRaw(m);
    window.setTimeout(() => setAnimating(false), 750);
  }, [mode]);
  // 预览模式下按专注编辑：直接进入编辑区专注；再按一次回到常规三栏。
  const toggleFocus = useCallback(() => {
    if (mode !== "edit") { setMode("edit"); setFocusMode(true); return; }
    setAnimating(true);
    window.setTimeout(() => setAnimating(false), 750);
    setFocusMode(value => !value);
  }, [mode, setMode]);

  const updateQ = useCallback((id: string, patch: Partial<Question>) => {
    setExam(e => patchWorkspaceQuestion(e, id, patch));
  }, [setExam]);

  const addQuestions = useCallback((qs: Question[]) => {
    setExam((e) => {
      const sections = e.sections.map((s) => ({ ...s, questions: [...s.questions] }));
      qs.forEach((q) => {
        const s = sections.find((x) => x.type === q.type);
        if (s) s.questions.push(q);
        else sections.push({ id: uid(), type: q.type, title: TYPE_META[q.type].label, note: "", questions: [q] });
      });
      return { ...e, sections };
    });
  }, [setExam]);

  const insertBankQuestions = useCallback((questions: Question[], targetSectionId: string) => {
    if (targetSectionId === AUTO_SECTION) {
      if (!questions.length) throw Error("选题篮为空");
      if (count + questions.length > 2000) throw Error("整卷最多2000道题，请分卷导入");
      setExam(previous => distributeByType(previous, questions));
      setActiveId(questions[0].id); setMode("edit");
      toast({ title: `已按题型加入 ${questions.length} 道题` });
      return;
    }
    const target = exam.sections.find(section => section.id === targetSectionId);
    if (!questions.length || !target) throw Error("请选择有效的目标大题");
    if (target.questions.length + questions.length > 1000 || count + questions.length > 2000) throw Error("单个大题最多1000道题，整卷最多2000道题，请分卷导入");
    setExam(previous => ({ ...previous, sections: previous.sections.map(section => section.id === targetSectionId ? { ...section, questions: [...section.questions, ...questions] } : section) }));
    setActiveId(questions[0].id); setMode("edit");
    toast({ title: `已从题库加入 ${questions.length} 道题` });
  }, [exam.sections, count, setExam, setMode, toast]);

  const createExamFromBank = useCallback(async (questions: Question[]) => {
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
  }, [exam, layout, snapshots, setExam, setMode, toast]);

  const applyExamMetadata = (patches: ExamMetadataPatch[], expectedFingerprint: string) => {
    if (examSnapshotFingerprint(exam) !== expectedFingerprint) { toast({ title: "试卷已变更，请刷新分析后再采用", tone: "warn" }); return false; }
    setExam(previous => examSnapshotFingerprint(previous) === expectedFingerprint ? previewMetadataPatches(previous, patches) : previous);
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

  const newQuestion = useCallback((sectionId?: string) => {
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
  }, [exam.sections, cur?.s, addQuestions, mode, setMode, setExam]);

  const removeQuestions = useCallback((ids: Set<string>) => {
    setExam((e) => ({ ...e, sections: e.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => !ids.has(q.id)) })) }));
    if (activeId && ids.has(activeId)) setActiveId(null);
  }, [activeId, setExam]);

  /** 校对：把误识别为选择题的题目转成解答题，并从题干提取分值 */
  const convertToEssay = useCallback((id: string) => {
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
  }, [flat, setExam, toast]);

  /* ---------- 本地草稿与可恢复历史 ---------- */
  useEffect(() => {
    let live = true;
    loadWorkspace().then(raw => {
      if (!live) return;
      if (raw) {
        const data = raw as WorkspaceData;
        if (data.version !== 1 || !Array.isArray(data.exam?.sections) || !data.layout?.paper || !Array.isArray(data.history)) throw new Error("本地草稿格式无效，未覆盖原文件");
        const loadedExam = { ...data.exam, id: data.exam.id || uid() };
        resetWorkspace({ exam: loadedExam, layout: data.layout }); setSnapshots(data.history);
        setActiveId(resumeQuestion(loadedExam));
        lastSaved.current = JSON.stringify({ exam: data.exam, layout: data.layout });
        // Legacy drafts still need one save to persist their newly assigned ID.
        if (data.exam.id) lastSavedFrame.current = { exam: loadedExam, layout: data.layout };
      }
      markSessionStarted();
      setReady(true);
    }).catch(error => { if (live) { setSaveError(String(error.message || error)); toast({ title: "草稿载入失败", desc: String(error.message || error), tone: "warn" }); } });
    return () => { live = false; };
  }, []);

  persistRef.current = async () => {
    if (!ready) return;
    // UI-only updates and repeated flush events cannot dirty an immutable frame.
    if (lastSavedFrame.current?.exam === exam && lastSavedFrame.current.layout === layout) { setSaving(false); return; }
    const serialized = JSON.stringify({ exam, layout });
    if (serialized === lastSaved.current) { lastSavedFrame.current = { exam, layout }; setSaving(false); return; }
    setSaving(true);
    const snapshot: Snapshot = { id: uid(), at: Date.now(), label: `${exam.title} · ${count} 题 · ${score} 分`, exam: structuredClone(exam), layout: { ...layout } };
    const nextHistory = [snapshot, ...snapshots].slice(0, 50);
    const metadataCheckpoint = metadataReceipts.checkpoint();
    try {
      await saveWorkspace({ version: 1, exam, layout, history: nextHistory });
      lastSaved.current = serialized;
      lastSavedFrame.current = { exam, layout };
      metadataReceipts.flush(metadataCheckpoint);
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
        // Final page DOM is mounted after geometry is resolved. A cached TikZ
        // result still needs its new <img> to decode in that final print tree.
        await waitForDrawings(document.querySelector("#print-root") ?? document);
        if (canceled) return;
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

  const exportSource = useCallback(async (name = exam.title) => {
    try { if (await saveText(name, exportTex(exam, layout), "tex")) toast({ title: "已导出 LaTeX 源文件" }); }
    catch (error) { toast({ title: "导出失败", desc: String(error), tone: "warn" }); }
  }, [exam, layout, toast]);
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
      if (e.defaultPrevented) return;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPalette(v => !v);
      }
      else if (mod && e.key === ",") (e.preventDefault(), setSettings(true));
      else if (workArea !== "exam") return;
      else if (mod && e.key === "1") (e.preventDefault(), setMode("edit"));
      else if (mod && e.key === "2") (e.preventDefault(), setMode("preview"));
      else if (mod && e.shiftKey && e.key.toLowerCase() === "f") (e.preventDefault(), toggleFocus());
      else if (e.key === "Escape" && focusMode && !editing && !document.querySelector('[role="dialog"],[data-select-menu]')) (e.preventDefault(), setFocusMode(false));
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
  const outlineFull = W < 1280 ? 304 : 312;
  const outlineWidth = sidebarExpanded ? outlineFull : 76;
  // 预览宽度按比例分配（可拖动分隔线调整并记住），编辑区至少保留 520px。
  const [previewRatio, setPreviewRatio] = useState(() => { try { const value = Number(localStorage.getItem("juanye.preview-ratio.v1")); return value >= 0.25 && value <= 0.72 ? value : 0.5; } catch { return 0.5; } });
  const [resizing, setResizing] = useState(false);
  const availableWidth = W - outlineWidth;
  const previewEdit = W < 1060 || availableWidth - 520 < 320 ? 0 : Math.round(Math.min(availableWidth - 520, Math.max(360, availableWidth * previewRatio)));
  const editorFull = Math.max(520, W - outlineWidth - previewEdit);
  const cols =
    mode === "edit"
      ? focusMode
        ? { outline: 0, layout: 0, editor: W, preview: 0 }
        : { outline: outlineWidth, layout: 0, editor: W - outlineWidth - previewEdit, preview: previewEdit }
      : { outline: 0, layout: 340, editor: 0, preview: W - 340 };
  const colT = resizing ? { duration: 0 } : animating ? { type: "spring" as const, stiffness: 210, damping: 30 } : { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] as const };
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !main.current) return;
    event.preventDefault();
    const handle = event.currentTarget, right = main.current.getBoundingClientRect().right;
    handle.setPointerCapture(event.pointerId);
    setResizing(true);
    let ratio = previewRatio;
    const move = (e: PointerEvent) => { ratio = Math.min(0.72, Math.max(0.25, (right - e.clientX) / Math.max(1, availableWidth))); setPreviewRatio(ratio); };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      setResizing(false);
      try { localStorage.setItem("juanye.preview-ratio.v1", ratio.toFixed(3)); } catch { /* 偏好仅本机便利 */ }
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  };
  const expandSidebar = useCallback((expanded: boolean) => {
    setSidebarExpanded(expanded);
    if (!expanded) { setBatch(false); setSelected(new Set()); }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("juanye.sidebar-expanded.v2", String(sidebarExpanded)); }
    catch { /* UI state remains usable when preference storage is unavailable. */ }
  }, [sidebarExpanded]);

  const openPalette = useCallback(() => setPalette(true), []);
  const openSettings = useCallback(() => setSettings(true), []);

  const settingsMounted = useEverTrue(settings);
  const ocrMounted = useEverTrue(ocr);
  const historyMounted = useEverTrue(history);

  /* ---------- 命令面板 ---------- */
  // Avoid formatting every question's search title on each keystroke while closed.
  // Retain the last committed list so the palette's exit animation keeps its content.
  const lastCommands = useRef<Command[]>(EMPTY_COMMANDS);
  const commands: Command[] = useMemo(
    () => palette ? [
      { id: "ocr", group: "功能", title: "一图多题识别", icon: <ScanText size={15} />, run: () => setOcr(true) },
      { id: "import-questions", group: "导入", title: "导入题目文件", icon: <FileInput size={15} />, run: () => setImportKind("questions") },
      { id: "import-solutions", group: "导入", title: "导入解析文件", icon: <FileInput size={15} />, run: () => setImportKind("solutions") },
      { id: "import-annotated", group: "导入", title: "导入解析版试卷", icon: <FileInput size={15} />, run: () => setImportKind("annotated") },
      { id: "batch", group: "功能", title: "批量编辑", icon: <ListChecks size={15} />, run: () => { setMode("edit"); setSidebarExpanded(true); setBatch(true); } },
      { id: "structure", group: "功能", title: "管理大题", icon: <FolderTree size={15} />, run: () => { setSidebarExpanded(true); setStructure(true); } },
      { id: "bank", group: "功能", title: "本地题库", icon: <BookOpen size={15} />, run: () => setWorkArea("bank") },
      { id: "workbook", group: "功能", title: "教辅编辑台", icon: <NotebookPen size={15} />, run: () => setWorkArea("workbook") },
      { id: "bank-picker", group: "功能", title: "从题库选题", icon: <BookOpen size={15} />, run: () => { setWorkArea("exam"); setBank(true); } },
      { id: "exam-analysis", group: "功能", title: "试卷分析与双向细目表", icon: <BarChart3 size={15} />, run: openExamAnalysis },
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
      { id: "theme-dark", group: "外观", title: "深色模式", icon: <Eye size={15} />, run: () => withThemeTransition(() => setAppearance("dark")) },
      { id: "theme-light", group: "外观", title: "淡色模式", icon: <Eye size={15} />, run: () => withThemeTransition(() => setAppearance("light")) },
      { id: "theme-aura-light", group: "外观", title: "晴岚 浅色", icon: <MountainSnow size={15} />, run: () => withThemeTransition(() => { setAura({ scheme: "light" }); setAppearance("aura"); }) },
      { id: "theme-aura-dark", group: "外观", title: "晴岚 深色", icon: <MountainSnow size={15} />, run: () => withThemeTransition(() => { setAura({ scheme: "dark" }); setAppearance("aura"); }) },
      { id: "theme-telegram", group: "外观", title: "Telegram 深色", icon: <Sparkles size={15} />, run: () => withThemeTransition(() => { setTelegramScheme("dark"); setAppearance("telegram"); }) },
      { id: "theme-telegram-light", group: "外观", title: "Telegram 浅色", icon: <Sparkles size={15} />, run: () => withThemeTransition(() => { setTelegramScheme("light"); setAppearance("telegram"); }) },
      { id: "edit", group: "视图", title: "切换到编辑", icon: <PenLine size={15} />, kbd: "Ctrl 1", run: () => setMode("edit") },
      { id: "focus", group: "视图", title: focusMode && mode === "edit" ? "退出专注编辑" : "专注编辑（收起目录和预览）", icon: <Maximize2 size={15} />, kbd: "Ctrl Shift F", run: toggleFocus },
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
    ] : lastCommands.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [palette, flat, exam, layout, mode, ready, printing, activeId],
  );
  useLayoutEffect(() => { if (palette) lastCommands.current = commands; }, [commands, palette]);

  const previousQuestion = flat[idx - 1]?.q;
  const nextQuestion = flat[idx + 1]?.q;
  const neighbors = useMemo(() => ({
    prev: previousQuestion ? { num: idx, stem: plain(previousQuestion.stem) } : undefined,
    next: nextQuestion ? { num: idx + 2, stem: plain(nextQuestion.stem) } : undefined,
  }), [idx, previousQuestion, nextQuestion]);
  const changeCurrent = useCallback((patch: Partial<Question>) => { if (activeId) updateQ(activeId, patch); }, [activeId, updateQ]);
  const previous = useCallback(() => go(-1), [go]);
  const next = useCallback(() => go(1), [go]);
  const convertCurrent = useCallback(() => { if (activeId) convertToEssay(activeId); }, [activeId, convertToEssay]);
  const deleteCurrent = useCallback(() => {
    if (activeId) { removeQuestions(new Set([activeId])); toast({ title: "已删除题目" }); }
  }, [activeId, removeQuestions, toast]);
  const duplicateCurrent = useCallback(() => { if (activeId) setExam(exam => copyQuestions(exam, new Set([activeId]))); }, [activeId, setExam]);
  const moveCurrent = useCallback((sectionId: string) => { if (activeId) setExam(exam => transferQuestions(exam, new Set([activeId]), sectionId)); }, [activeId, setExam]);
  const start = useCallback(() => { if (flat[0]) select(flat[0].q.id); }, [flat, select]);
  const openOcr = useCallback(() => setOcr(true), []);
  const openStructure = useCallback(() => setStructure(true), []);
  const editMode = useCallback(() => setMode("edit"), [setMode]);
  // 编辑模式下排版面板宽度为 0：沿用进入编辑前的试卷，打字时不重渲染（其分段控件会触发整树布局测量）。
  const layoutPanelSnapshot = useRef(exam);
  if (mode === "preview") layoutPanelSnapshot.current = exam;
  const layoutPanelExam = layoutPanelSnapshot.current;
  const toggleLayout = useCallback(() => setMode(mode === "edit" ? "preview" : "edit"), [setMode, mode]);
  const previewTex = useCallback(() => { void exportSource(); }, [exportSource]);
  const reorder = useCallback((sectionId: string, questions: Question[]) => setExam(exam => ({ ...exam, sections: exam.sections.map(section => section.id === sectionId ? { ...section, questions } : section) })), [setExam]);
  const changeBatch = useCallback((value: boolean) => { if (value) setSidebarExpanded(true); setBatch(value); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((id: string) => setSelected(previous => {
    const next = new Set(previous);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);
  const selectSection = useCallback((sectionId: string) => {
    const ids = exam.sections.find(section => section.id === sectionId)?.questions.map(question => question.id) ?? [];
    setSelected(previous => {
      const next = new Set(previous);
      const allSelected = ids.every(id => next.has(id));
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }, [exam.sections]);
  const jumpFlag = useCallback(() => {
    const found = flat.find(item => item.q.flag);
    if (found) select(found.q.id);
  }, [flat, select]);

  return (
    <div className="app-bg flex h-full min-w-[960px] flex-col" data-interface-motion={motionPref} data-exam-ai-background={examAiIndicatorVisible ? "active" : undefined}
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
      <SceneBackdrop />
      <TitleBar workspace={workArea} onWorkspace={setWorkArea} onPalette={openPalette} onSettings={openSettings}>
        {/* 当前工作区工具：与标题栏同一行，只放当前工作区自己的内容 */}
        <div key={workArea} className="workspace-nav-tools flex h-full min-w-0 flex-1 items-center gap-1">{workArea === "exam" ? <>
          <span className="app-header-sep" aria-hidden="true" />
          <button onClick={() => setPalette(true)} aria-label="项目与功能" title="切换项目、新建或导入" className="app-doc-title flex min-w-0 items-center gap-1 rounded-[6px] px-2 py-1 text-[13px] font-medium text-fg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50">
            <span className="truncate">{exam.title}</span>
            <ChevronDown size={13} className="shrink-0 text-faint" />
          </button>
          <SaveBadge saving={saving || !ready} error={saveError} />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ModeSwitch mode={mode} setMode={setMode} />
            <IconButton label={focusMode ? "退出专注编辑" : "专注编辑"} kbd="Ctrl Shift F" active={focusMode && mode === "edit"} aria-pressed={focusMode && mode === "edit"} onClick={toggleFocus}>{focusMode && mode === "edit" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
            <span className="app-header-sep" aria-hidden="true" />
            <Button variant="ghost" size="sm" aria-label="从题库选题" icon={<BookOpen size={14} />} onClick={() => setBank(true)}><span><span className="nav-secondary-label">从题库</span>选题</span></Button>
            <IconButton label="试卷分析" onClick={openExamAnalysis}><BarChart3 size={16} /></IconButton>
            <IconButton label="生成 B 卷" onClick={() => setAbPaper(true)}><Shuffle size={16} /></IconButton>
            <IconButton label="历史记录" onClick={() => setHistory(true)}><HistoryIcon size={16} /></IconButton>
            <div className="export-split ml-1 flex items-center">
              <Button variant="primary" size="sm" icon={<FileDown size={14} />} onClick={() => exportPdf()}>导出 PDF</Button>
              <IconButton label="导出中心" className="export-split-more" onClick={() => setExportCenter(true)}><ChevronDown size={14} /></IconButton>
            </div>
          </div>
        </> : workArea === "workbook" ? <>
          <span className="app-header-sep" aria-hidden="true" />
          <div id="workbook-nav-slot" className="flex h-full min-w-0 flex-1 items-center" />
        </> : <>
          <span className="app-header-sep" aria-hidden="true" />
          <span className="truncate text-[12px] text-faint">当前试卷：{exam.title} · {count} 题 · {score} 分</span>
        </>}</div>
      </TitleBar>

      <div ref={main} className="workspace-stage relative flex min-h-0 flex-1 overflow-hidden">
        <div className="workspace-wallpaper" aria-hidden="true" />
        <WorkspaceView name="exam" active={workArea === "exam"} offset={-14} reducedMotion={reducedMotion} className="workspace-exam-area">
        {/* 左：试卷结构 */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ width: cols.outline, opacity: cols.outline ? 1 : 0, x: 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 }, x: softSpring }}
          className="workspace-outline-stage shrink-0 overflow-hidden border-r border-line bg-panel/80"
          style={{ "--sidebar-expanded-width": `${outlineFull}px` } as CSSProperties}
        >
            <WorkspaceSidebar
              expanded={sidebarExpanded}
              onExpandedChange={expandSidebar}
              requestedSectionId={requestedSectionId}
              exam={exam}
              activeId={activeId}
              onSelect={select}
              onReorder={reorder}
              batch={batch}
              setBatch={changeBatch}
              selected={selected}
              toggleSelect={toggleSelected}
              score={score}
              count={count}
              onAdd={newQuestion}
              onOcr={openOcr}
              onManageSections={openStructure}
              onSelectSection={selectSection}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onJumpFlag={jumpFlag}
            />
        </motion.div>

        {/* 左：排版面板（预览模式） */}
        <motion.div
          initial={false}
          animate={{ width: cols.layout, opacity: cols.layout ? 1 : 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 } }}
          className="workspace-outline-stage shrink-0 overflow-hidden border-r border-line bg-panel/80"
        >
          <WorkspaceLayoutPanel layout={layout} setLayout={setLayout} exam={layoutPanelExam} setExam={setExam} onDone={editMode} />
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
              onChange={changeCurrent}
              onPrev={previous}
              onNext={next}
              onConvert={convertCurrent}
              onDelete={deleteCurrent}
              onDuplicate={duplicateCurrent}
              onMove={moveCurrent}
              sections={exam.sections}
              onStart={start}
              onOcr={openOcr}
              neighbors={neighbors}
            />
            </div>
          </div>
        </motion.div>

        {/* 右：实时预览 */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ width: cols.preview, opacity: cols.preview ? 1 : 0, x: 0 }}
          transition={{ ...colT, opacity: { duration: 0.25 }, x: { ...softSpring, delay: 0.1 } }}
          className={cx("workspace-preview-stage relative shrink-0 overflow-hidden", mode === "edit" && "border-l border-line")}
        >
          {mode === "edit" && cols.preview > 0 && <div className="preview-resizer" data-resizing={resizing || undefined} role="separator" aria-orientation="vertical" aria-label="拖动调整编辑区与预览宽度" title="拖动调整宽度，双击恢复默认" onPointerDown={startResize} onDoubleClick={() => { setPreviewRatio(0.5); try { localStorage.removeItem("juanye.preview-ratio.v1"); } catch { /* ignore */ } }} />}
          <PreviewPane
            exam={exam}
            layout={layout}
            view={view}
            setView={setView}
            mode={mode}
            activeId={activeId}
            onPick={select}
            onLayout={toggleLayout}
            onTex={previewTex}
            score={score}
            count={count}
          />
        </motion.div>
        </WorkspaceView>
        {bankVisited && <WorkspaceView name="bank" active={workArea === "bank"} offset={16} reducedMotion={reducedMotion}><Suspense fallback={<div className="relative m-auto text-muted">正在打开题库…</div>}><BankWorkspace active={workArea === "bank"} exam={exam} examId={exam.id} currentQuestion={cur?.q} currentSelection={bankSelection} onInsert={insertBankQuestions} onCreateExam={createExamFromBank} /></Suspense></WorkspaceView>}
        {workbookVisited && <WorkspaceView name="workbook" active={workArea === "workbook"} offset={18} reducedMotion={reducedMotion}><Suspense fallback={<div className="relative m-auto text-muted">正在打开教辅…</div>}><WorkbookWorkspace active={workArea === "workbook"} handle={workbookHandle} /></Suspense></WorkspaceView>}
      </div>

      <AnimatePresence initial={false}>
      {batch && <Suspense key="batch-panel" fallback={null}><BatchPanel paperMode={layout.paperMode} exam={exam} selected={selected} onSelection={setSelected} onChange={setExam} onClose={() => { setBatch(false); setSelected(new Set()); }} /></Suspense>}
      {structure && <Suspense key="structure-panel" fallback={null}><StructurePanel exam={exam} onChange={setExam} onClose={() => setStructure(false)} onSelect={id => { setMode("edit"); setSidebarExpanded(true); setRequestedSectionId(id); }} /></Suspense>}
      {bank && <Suspense key="bank-picker" fallback={null}><QuestionBankDialog open={bank} onClose={() => setBank(false)} exam={exam} sections={exam.sections} currentQuestion={cur?.q} onInsert={insertBankQuestions} /></Suspense>}
      {examAnalysis && <Suspense key="exam-analysis" fallback={null}><ExamAnalysisDialog open={examAnalysis} onClose={closeExamAnalysis} exam={exam} session={examAiSession} initialTab={examAnalysisInitialTab} onLocate={id => { closeExamAnalysis(); setMode("edit"); select(id); }} onApplyMetadata={applyExamMetadata} onReportAvailable={autoFillReportMetadata} /></Suspense>}
      {abPaper && <Suspense key="ab-paper" fallback={null}><AbPaperDialog open={abPaper} onClose={() => setAbPaper(false)} exam={exam} onApply={next => { void applyBPaper(next); }} /></Suspense>}
      {aiTask && <Suspense key="generate-question" fallback={null}><GenerateQuestionDialog open source={aiTask.question} action={aiTask.action} onClose={() => setAiTask(undefined)} onApply={applyGenerated} /></Suspense>}
      {exportCenter && <Suspense key="export-center" fallback={null}><ExportCenter exam={exam} layout={layout} view={view} onClose={() => setExportCenter(false)} onExport={async (format: ExportFormat, name, target) => { if (format === "pdf") exportPdf(target, name); else if (format === "docx") await exportWord(name); else if (format === "md") await exportMd(name); else if (format === "tex") await exportSource(name); else await exportWorkspace(name); }} /></Suspense>}
      </AnimatePresence>

      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <AnimatePresence>{examAiIndicatorVisible && <motion.button
        key="exam-ai-background-task" type="button" data-testid="exam-ai-background-task" data-phase={examAiTask.phase} data-ui-button="icon" className="exam-ai-task-indicator"
        aria-label={examAiTask.phase === "running" ? "查看后台试卷分析" : examAiTask.phase === "success" ? "查看试卷分析报告" : "查看试卷分析失败原因"}
        title={examAiTask.phase === "running" ? "正在后台分析试卷" : examAiTask.phase === "success" ? "试卷分析完成" : "试卷分析失败"}
        initial={reducedMotion ? false : { opacity: 0, transform: "translateY(6px) scale(.9)" }} animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }} exit={{ opacity: 0, transform: "translateY(4px) scale(.9)" }} transition={reducedMotion ? { duration: 0 } : softSpring}
        onClick={() => { setExamAnalysisInitialTab("ai"); setExamAnalysis(true); examAiSession.acknowledge(); }}
      >{examAiTask.phase === "running" ? <LoaderCircle size={17} className="exam-ai-task-spinner" /> : examAiTask.phase === "success" ? <Check size={17} /> : <AlertTriangle size={17} />}</motion.button>}</AnimatePresence>
      {importKind && <Suspense fallback={null}><ImportDialog kind={importKind} exam={exam} onClose={() => setImportKind(undefined)} onCommit={commitImport} /></Suspense>}
      {settingsMounted && <Suspense fallback={null}><SettingsDialog open={settings} onClose={() => setSettings(false)} accent={accent} setAccent={setAccent} motionPref={motionPref} setMotionPref={setMotionPref} /></Suspense>}
      {ocrMounted && <Suspense fallback={null}><OcrDialog
        open={ocr}
        incomingPaste={incomingPaste}
        onClose={() => { setOcr(false); setIncomingPaste(undefined); }}
        onAdd={(qs) => {
          addQuestions(qs);
          toast({ title: `已添加 ${qs.length} 道题` });
          setTimeout(() => select(qs[0].id), 50);
        }}
      /></Suspense>}
      {historyMounted && <Suspense fallback={null}><HistorySheet open={history} onClose={() => setHistory(false)} items={snapshots} onRestore={snapshot => {
        if (!window.confirm("恢复该版本？当前内容将保留为历史快照。")) return;
        void persistRef.current().then(() => { setExam({ ...structuredClone(snapshot.exam), id: snapshot.exam.id || uid() }); setLayout({ ...snapshot.layout }); setActiveId(snapshot.exam.sections.flatMap(s => s.questions)[0]?.id ?? null); setWorkArea("exam"); setHistory(false); toast({ title: "已恢复历史版本" }); });
      }} /></Suspense>}
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
