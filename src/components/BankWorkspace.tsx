import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FilePlus2, Flame, Folder, FolderPlus, GripVertical, HardDrive, History, LayoutGrid, LayoutList, Library, Lightbulb, ListChecks, Loader2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, RefreshCw, RotateCcw, ScanText, Search, ShoppingBasket, Sparkles, Star, Tag, Trash2, Upload, X, ZoomIn } from "lucide-react";
import type { CSSProperties } from "react";
import type { Exam, QType, Question, Section } from "../types";
import { TYPE_META } from "../data";
import { MathText, plain } from "../math";
import { extractTikzBlocks, stripTikzBlocks } from "../drawing";
import { questionFigures } from "../figures";
import { TikzDrawing } from "../TikzDrawing";
import { parseProject } from "../documents";
import { changeQuestionType } from "../structure";
import { bankBridge, BANK_DRAG_MIME, checkedBankDocument, cloneBankEntries, latestBankEntries, parseBankDrag, sortBankEntries, type BankDocument, type BankEntry, type BankFilters } from "../question-bank";
import { planCollectionDrop } from "../collection-drop";
import { Button, Field, IconButton, Modal, SharedPill, inputCls, useToast } from "../ui";
import { Select } from "./Select";
import { Checkbox } from "./Checkbox";
import { Editor } from "./Editor";
import { ImportDialog } from "./ImportDialog";
import { OcrDialog } from "./Ocr";
import { PlotSvg } from "./Paper";
import { QuestionTypeIcon } from "./QuestionTypeIcon";
import { AnimatedNumber, DifficultyMeter, EmptyArt, FigureLightbox, FlightLayer, Reveal, StarBurst, TypeSpectrum, cardSpring, cardVariants, listVariants, useRichMotion, type Flight, type ZoomFigure } from "./bank-motion";
import "./bank-workspace.css";

const DIFFICULTY = { easy: "基础", medium: "中等", hard: "较难" } as const;
const EMPTY_BANK: BankDocument = { schema: "juanye-bank/1", revision: 0, entries: [], collections: [] };
const PAGE_SIZE = 25;
type LibraryView = "all" | "favorites" | "review" | "trash" | `collection:${string}`;
type EditTarget = "question" | "answer" | "analysis";
type Draft = { question: Question; entry?: BankEntry; original: string; focusTarget: EditTarget };
type Collection = BankDocument["collections"][number];
type PackageImport = { name: string; bank?: BankDocument; questions?: Question[] };
type BankCardActions = {
  preview: (id: string) => void;
  select: (id: string, checked: boolean) => void;
  favorite: (entry: BankEntry) => void;
  knowledge: (value: string) => void;
  pick: (id: string, source: Element) => void;
  restore: (id: string) => void;
  drag: (entry: BankEntry, selected: boolean, transfer: DataTransfer) => boolean;
  dragEnd: () => void;
};
const instantMotion = { duration: 0 } as const;

export interface BankWorkspaceProps {
  active?: boolean;
  exam: Exam;
  currentQuestion?: Question | null;
  currentSelection?: Question[];
  examId?: string;
  onInsert: (questions: Question[], targetSectionId: string) => void | Promise<void>;
  onCreateExam: (questions: Question[]) => void | Promise<void>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const dateText = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "未使用";
const scoreText = (value: number) => String(Number(value.toFixed(2)));
const hueStyle = (type: QType) => ({ "--type-hue": TYPE_META[type].hue }) as CSSProperties;
const TYPE_ORDER = Object.keys(TYPE_META) as QType[];
const typeSegments = (entries: readonly BankEntry[]) => {
  const counts = new Map<QType, number>();
  for (const entry of entries) counts.set(entry.question.type, (counts.get(entry.question.type) ?? 0) + 1);
  return TYPE_ORDER.map(key => ({ key, label: TYPE_META[key].short, hue: TYPE_META[key].hue, count: counts.get(key) ?? 0 }));
};
const foldSearch = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
const searchTextCache = new WeakMap<Question, string>();
function questionSearchText(q: Question) {
  let text = searchTextCache.get(q);
  if (text === undefined) {
    text = foldSearch([q.stem, ...q.options, ...q.answer, q.analysis, q.source, ...(q.knowledge ?? [])].join("\n"));
    searchTextCache.set(q, text);
  }
  return text;
}
// Validated bank snapshots include unchanged content. Share their immutable
// references so a favorite/usage update never remounts every formula/figure.
function sameBankValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameBankValue(a[key], b[key]));
}
const css = (value: string) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
/** A compact native drag image; the default ghost of a full card is noisy and hides the drop target. */
function dragGhost(transfer: DataTransfer, count: number, type: QType) {
  try {
    const ghost = document.createElement("div"), badge = document.createElement("b"), text = document.createElement("span");
    ghost.className = "bank-drag-ghost"; ghost.style.setProperty("--type-hue", TYPE_META[type].hue);
    badge.textContent = TYPE_META[type].short; text.textContent = `${count} 道题`;
    ghost.append(badge, text); document.body.append(ghost);
    transfer.setDragImage(ghost, 24, 22);
    setTimeout(() => ghost.remove(), 0);
  } catch { /* the native drag image remains available */ }
}
const blankQuestion = (): Question => ({ id: crypto.randomUUID(), type: "single", stem: "", options: ["", "", "", ""], answer: [], analysis: "", score: 5 });

/** A library workspace, deliberately separate from the paper being edited. */
export const BankWorkspace = memo(function BankWorkspace({ active = true, exam, currentQuestion, currentSelection = [], examId, onInsert, onCreateExam }: BankWorkspaceProps) {
  const toast = useToast();
  const [bank, setBank] = useState<BankDocument>(EMPTY_BANK);
  const bankRef = useRef(bank);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<LibraryView>("all");
  const [filters, setFilters] = useState<BankFilters>({ sort: "recent" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [basket, setBasket] = useState<string[]>([]);
  const [basketExpanded, setBasketExpanded] = useState(true);
  const [previewId, setPreviewId] = useState("");
  const [rightOpen, setRightOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState(exam.sections[0]?.id ?? "");
  const [fileImport, setFileImport] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [packageImport, setPackageImport] = useState<PackageImport | null>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const moreDetails = useRef<HTMLDetailsElement>(null);
  const [collectionEdit, setCollectionEdit] = useState<Collection | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState({ knowledge: "", difficulty: "keep", source: "", applyKnowledge: false, applySource: false });
  const [collectionTarget, setCollectionTarget] = useState("");
  const [density, setDensity] = useState<"list" | "grid">(() => { try { return localStorage.getItem("juanye.bankDensity") === "grid" ? "grid" : "list"; } catch { return "list"; } });
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pulse, setPulse] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [collectionDropId, setCollectionDropId] = useState("");
  const [bursts, setBursts] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState<ZoomFigure | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarHovered = useRef(false);
  const sidebarTouch = useRef(false);
  const sidebarPanelId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const flightSeq = useRef(0);
  const rich = useRichMotion();
  const motionTransition = rich ? cardSpring : instantMotion;

  const latest = useMemo(() => latestBankEntries(bank.entries), [bank.entries]);
  const live = useMemo(() => latest.filter(entry => !entry.trashedAt), [latest]);
  const collectionId = view.startsWith("collection:") ? view.slice(11) : "";
  const activeCollection = bank.collections.find(collection => collection.id === collectionId);
  const viewFilters = useMemo<BankFilters>(() => ({ ...(collectionId ? { collectionId } : {}), ...(view === "favorites" ? { favorite: true } : {}), ...(view === "review" ? { review: true } : {}), trashed: view === "trash" }), [view, collectionId]);
  const deferredQuery = useDeferredValue(filters.query ?? "");
  const query = useMemo(() => foldSearch(deferredQuery.trim()), [deferredQuery]);
  const sortedLatest = useMemo(() => sortBankEntries(latest, filters.sort), [latest, filters.sort]);
  const searchIndex = useMemo(() => new Map(latest.map(entry => [entry.id, `${questionSearchText(entry.question)}\n${foldSearch(entry.origin.examTitle)}`])), [latest]);
  // Normalize rich question text and sort once per snapshot, not twice per key.
  // Deferred query updates keep typing responsive while the bounded page settles.
  const typeBase = useMemo(() => sortedLatest.filter(entry => {
    const q = entry.question;
    if (Boolean(entry.trashedAt) !== Boolean(viewFilters.trashed)) return false;
    if (viewFilters.collectionId && !entry.collectionIds.includes(viewFilters.collectionId)) return false;
    if (viewFilters.favorite !== undefined && entry.favorite !== viewFilters.favorite) return false;
    if (viewFilters.review !== undefined && Boolean(q.flag?.trim()) !== viewFilters.review) return false;
    if (filters.difficulty === "unset" ? Boolean(q.difficulty) : filters.difficulty && q.difficulty !== filters.difficulty) return false;
    if (filters.knowledge && !(q.knowledge ?? []).some(tag => tag.trim() === filters.knowledge)) return false;
    if (filters.source && (q.source?.trim() || entry.origin.examTitle) !== filters.source) return false;
    return !query || searchIndex.get(entry.id)!.includes(query);
  }), [sortedLatest, viewFilters, filters.difficulty, filters.knowledge, filters.source, query, searchIndex]);
  const filtered = useMemo(() => filters.type ? typeBase.filter(entry => entry.question.type === filters.type) : typeBase, [typeBase, filters.type]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = useMemo(() => filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), [filtered, currentPage]);
  const visibleLayoutKey = visible.map(entry => entry.id).join("|");
  const byId = useMemo(() => new Map(bank.entries.map(entry => [entry.id, entry])), [bank.entries]);
  const preview = byId.get(previewId) ?? visible[0];
  const versions = useMemo(() => preview ? bank.entries.filter(entry => entry.libraryId === preview.libraryId).sort((a, b) => b.version - a.version) : [], [bank.entries, preview?.libraryId]);
  const newest = versions[0];
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const basketIds = useMemo(() => new Set(basket), [basket]);
  const selectedEntries = useMemo(() => selected.map(id => byId.get(id)).filter((entry): entry is BankEntry => !!entry), [selected, byId]);
  const basketEntries = useMemo(() => basket.map(id => byId.get(id)).filter((entry): entry is BankEntry => !!entry && !entry.trashedAt), [basket, byId]);
  const totalScore = basketEntries.reduce((sum, entry) => sum + entry.question.score, 0);
  const targetId = exam.sections.some(section => section.id === target) ? target : exam.sections[0]?.id ?? "";
  const knowledge = useMemo(() => [...new Set(live.flatMap(entry => entry.question.knowledge ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")), [live]);
  const sources = useMemo(() => [...new Set(live.map(entry => entry.question.source?.trim() || entry.origin.examTitle).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")), [live]);
  const title = view === "favorites" ? "我的收藏" : view === "review" ? "待核对" : view === "trash" ? "回收站" : activeCollection?.name ?? "全部题目";
  const dirty = !!draft && JSON.stringify(draft.question) !== draft.original;
  const typeCounts = useMemo(() => typeSegments(typeBase), [typeBase]);
  const librarySegments = useMemo(() => typeSegments(live), [live]);
  const basketSegments = useMemo(() => typeSegments(basketEntries), [basketEntries]);
  const { favoriteCount, reviewCount, trashCount, usageTotal, collectionCounts } = useMemo(() => {
    let favoriteCount = 0, reviewCount = 0, trashCount = 0, usageTotal = 0;
    const collectionCounts = new Map<string, number>();
    for (const entry of latest) {
      if (entry.trashedAt) { trashCount++; continue; }
      if (entry.favorite) favoriteCount++;
      if (entry.question.flag) reviewCount++;
      usageTotal += entry.usageCount;
      for (const id of entry.collectionIds) collectionCounts.set(id, (collectionCounts.get(id) ?? 0) + 1);
    }
    return { favoriteCount, reviewCount, trashCount, usageTotal, collectionCounts };
  }, [latest]);
  const listKey = [view, filters.type, filters.knowledge, filters.difficulty, filters.source, filters.sort, currentPage, density].join("|");
  const chips = [
    filters.query?.trim() ? { key: "query", label: `“${filters.query.trim()}”`, clear: () => updateFilters({ query: "" }) } : null,
    filters.type ? { key: "type", label: TYPE_META[filters.type].label, clear: () => updateFilters({ type: "" }) } : null,
    filters.knowledge ? { key: "knowledge", label: `知识点 · ${filters.knowledge}`, clear: () => updateFilters({ knowledge: "" }) } : null,
    filters.difficulty ? { key: "difficulty", label: `难度 · ${filters.difficulty === "unset" ? "未设置" : DIFFICULTY[filters.difficulty]}`, clear: () => updateFilters({ difficulty: "" }) } : null,
    filters.source ? { key: "source", label: `来源 · ${filters.source}`, clear: () => updateFilters({ source: "" }) } : null,
  ].filter((chip): chip is { key: string; label: string; clear: () => void } => !!chip);
  const tree = useMemo(() => {
    const result: { collection: Collection; depth: number }[] = [], visited = new Set<string>();
    const walk = (parentId: string | undefined, depth: number) => bank.collections.filter(item => item.parentId === parentId).forEach(collection => {
      if (visited.has(collection.id)) return;
      visited.add(collection.id); result.push({ collection, depth }); walk(collection.id, depth + 1);
    });
    walk(undefined, 0);
    bank.collections.filter(item => !visited.has(item.id)).forEach(collection => result.push({ collection, depth: 0 }));
    return result;
  }, [bank.collections]);

  function acceptBank(raw: unknown) {
    const next = checkedBankDocument(raw), previous = bankRef.current;
    const oldById = new Map(previous.entries.map(entry => [entry.id, entry]));
    next.entries = next.entries.map(entry => {
      const old = oldById.get(entry.id);
      if (!old) return entry;
      if (sameBankValue(old.question, entry.question)) entry.question = old.question;
      return sameBankValue(old, entry) ? old : entry;
    });
    if (next.entries.length === previous.entries.length && next.entries.every((entry, index) => entry === previous.entries[index])) next.entries = previous.entries;
    if (sameBankValue(previous.collections, next.collections)) next.collections = previous.collections;
    const newestByLibrary = new Map(latestBankEntries(next.entries).map(entry => [entry.libraryId, entry]));
    const nextById = new Map(next.entries.map(entry => [entry.id, entry]));
    const reconcile = (ids: string[]) => [...new Set(ids.map(id => {
      const old = oldById.get(id), entry = old ? newestByLibrary.get(old.libraryId) : nextById.get(id);
      return entry && !entry.trashedAt ? entry.id : "";
    }).filter(Boolean))];
    const reconcileStable = (ids: string[]) => { const result = reconcile(ids); return result.length === ids.length && result.every((id, index) => id === ids[index]) ? ids : result; };
    bankRef.current = next; setBank(next); setSelected(reconcileStable); setBasket(reconcileStable);
    return next;
  }

  async function task(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(message(cause)); toast({ title: "题库操作未完成", desc: message(cause), tone: "warn" }); }
    finally { running.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setBusy(true);
    Promise.resolve().then(() => bankBridge().bankLoad()).then(raw => { if (alive) acceptBank(raw); }).catch(cause => { if (alive) setError(message(cause)); }).finally(() => { if (alive) { setBusy(false); setLoaded(true); } });
    return () => { alive = false; };
  }, [active]);

  useEffect(() => {
    if (!active) { setSidebarOpen(false); return; }
    const outside = (event: PointerEvent) => { if (!sidebarRef.current?.contains(event.target as Node)) setSidebarOpen(false); };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [active]);

  useEffect(() => { try { localStorage.setItem("juanye.bankDensity", density); } catch { /* preference only */ } }, [density]);

  // Keep the patch's native menu appearance and dismiss it on outside clicks.
  useEffect(() => {
    if (!active) return;
    const dismiss = (event: PointerEvent) => {
      if (!moreDetails.current?.contains(event.target as Node)) moreDetails.current?.removeAttribute("open");
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [active]);
  useEffect(() => {
    if (!active || !rich) { setFlights([]); setDragging(false); setDropActive(false); setCollectionDropId(""); }
  }, [active, rich]);

  // "/" focuses search; ↑/↓ walk the visible list while previewing (never while editing a draft).
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='listbox'], [role='dialog'], .bank-question-editor, .bank-more")) return;
      if (document.querySelector("[aria-modal='true'], .bank-lightbox, [data-select-menu]")) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !draft && visible.length) {
        event.preventDefault();
        const index = visible.findIndex(entry => entry.id === preview?.id);
        const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
        if (!next || next.id === preview?.id) return;
        setPreviewId(next.id); setHistoryOpen(false); setRightOpen(true);
        requestAnimationFrame(() => mainRef.current?.querySelector(`[data-bank-id="${css(next.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: rich ? "smooth" : "auto" }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, draft, visible, preview?.id, rich]);

  function canLeaveDraft() { return !dirty || window.confirm("放弃未保存的题库修改？"); }
  function choosePreview(id: string) {
    if (draft && !canLeaveDraft()) return;
    setDraft(null); setPreviewId(id); setHistoryOpen(false); setRightOpen(true);
  }
  function changeView(next: LibraryView) { setView(next); setPage(0); setSelected([]); }
  function updateFilters(patch: Partial<BankFilters>) { setFilters(value => ({ ...value, ...patch })); setPage(0); }
  function toggleSelected(id: string, checked: boolean) { setSelected(value => checked ? [...new Set([...value, id])] : value.filter(item => item !== id)); }
  function addToBasket(ids: string[], sourceFor?: (id: string) => Element | null | undefined) {
    const additions = ids.filter(id => { const entry = byId.get(id); return entry && !entry.trashedAt; });
    const fresh = additions.filter(id => !basket.includes(id));
    const origins = fresh.flatMap(id => { const source = sourceFor?.(id); return source ? [{ id, from: source.getBoundingClientRect() }] : []; }).slice(0, 8);
    setBasket(value => [...new Set([...value, ...additions])]); setRightOpen(true); setBasketExpanded(true);
    if (!fresh.length) return;
    if (!rich || !origins.length) { setPulse(value => value + 1); return; }
    // Wait one frame: opening the detail pane may be what creates the basket target.
    requestAnimationFrame(() => {
      const anchor = mainRef.current?.querySelector("[data-basket-anchor]");
      if (!anchor) { setPulse(value => value + 1); return; }
      const to = anchor.getBoundingClientRect();
      setFlights(value => [...value, ...origins.map(({ id, from }, index) => { const type = byId.get(id)?.question.type ?? "single"; return { id: ++flightSeq.current, from, to, hue: TYPE_META[type].hue, label: TYPE_META[type].short, delay: index * 0.07 }; })]);
    });
  }
  const cardSource = (id: string) => mainRef.current?.querySelector(`[data-bank-id="${css(id)}"] .bank-type-tag`);
  function arrive(id: number) { setFlights(value => value.filter(flight => flight.id !== id)); setPulse(value => value + 1); }
  function toggleFavorite(entry: BankEntry) {
    if (!entry.favorite) setBursts(value => ({ ...value, [entry.id]: (value[entry.id] ?? 0) + 1 }));
    void metadata([entry.id], { favorite: !entry.favorite });
  }
  function resetFilters() { setFilters(value => ({ sort: value.sort })); setPage(0); }
  function moveBasket(index: number, delta: number) { setBasket(value => { const next = [...value], to = index + delta; if (to < 0 || to >= next.length) return value; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  async function saveQuestions(questions: Question[], source = exam.title) {
    const originExamId = examId ?? exam.id;
    const result = await bankBridge().bankSave({ questions, origin: { examTitle: source || "本地题库", ...(source === exam.title && originExamId ? { examId: originExamId } : {}) } });
    acceptBank(result.bank);
    toast({ title: `已保存 ${result.added} 道题`, ...(result.duplicates ? { desc: `${result.duplicates} 道重复题已跳过` } : {}) });
  }
  function editEntry(entry?: BankEntry, target: EditTarget = "question") {
    if (!canLeaveDraft()) return;
    const question = entry ? structuredClone(entry.question) : blankQuestion();
    setDraft({ question, entry, original: JSON.stringify(question), focusTarget: target }); setHistoryOpen(false); setRightOpen(true);
  }
  const editPreview = useCallback((target: EditTarget) => { if (preview) editEntry(preview, target); }, [preview, dirty]);
  const saveDraft = () => task(async () => {
    if (!draft) return;
    if (!draft.question.stem.trim() && !questionFigures(draft.question).length && !draft.question.drawing && !draft.question.image) throw Error("请填写题干或添加题图");
    if (draft.entry) {
      const result = await bankBridge().bankRevise({ id: draft.entry.id, question: draft.question, expectedContentKey: draft.entry.contentKey });
      acceptBank(result.bank); setPreviewId(result.entry.id); toast({ title: `已保存版本 ${result.entry.version}` });
    } else {
      await saveQuestions([draft.question], "本地题库");
      setView("all"); setFilters({ sort: "recent" }); setPage(0);
      setPreviewId(latestBankEntries(bankRef.current.entries).find(entry => entry.question.id === draft.question.id)?.id ?? "");
    }
    setDraft(null);
  });

  const metadata = (ids: string[], patch: { favorite?: boolean; collectionIds?: string[] }) => task(async () => {
    acceptBank(await bankBridge().bankManage({ action: "metadata", ids, ...patch }));
  });
  const trashItems = (ids: string[]) => task(async () => {
    if (!ids.length || !window.confirm(`将 ${ids.length} 道题移入回收站？历史版本一并保留，试卷不受影响。`)) return;
    acceptBank(await bankBridge().bankManage({ action: "trash", ids })); setSelected([]);
    toast({ title: "已移入回收站", desc: "可在回收站恢复" });
  });
  const restoreItems = (ids: string[]) => task(async () => { acceptBank(await bankBridge().bankManage({ action: "restore-items", ids })); setSelected([]); toast({ title: "题目已恢复" }); });
  const insertBasket = (create: boolean) => task(async () => {
    if (!basketEntries.length || (!create && !targetId)) return;
    if (draft && !canLeaveDraft()) return;
    const entries = [...basketEntries];
    const questions = cloneBankEntries(entries);
    if (create) await onCreateExam(questions); else await onInsert(questions, targetId);
    setBasket([]); setDraft(null);
    // Count usage only after the paper operation succeeds. An accounting failure must not invite duplicate insertion.
    try { acceptBank(await bankBridge().bankMarkUsed(entries.map(entry => entry.id))); }
    catch (cause) { setError(`题目已加入试卷，但使用记录未更新：${message(cause)}`); }
  });
  const deleteCollection = (collection: Collection) => task(async () => {
    if (bank.collections.some(item => item.parentId === collection.id)) throw Error("请先移动或删除子收藏夹");
    if (!window.confirm(`删除收藏夹“${collection.name}”？题目和其他收藏夹均会保留。`)) return;
    acceptBank(await bankBridge().bankManage({ action: "collection-delete", id: collection.id }));
    if (collectionId === collection.id) changeView("all");
  });
  const batchMetadata = () => task(async () => {
    const entries = [...selectedEntries];
    if (!entries.length || (!batch.applyKnowledge && !batch.applySource && batch.difficulty === "keep")) return;
    const revisions = entries.map(entry => {
        const question = { ...entry.question,
          ...(batch.applyKnowledge ? { knowledge: [...new Set(batch.knowledge.split(/[,，、;；\n]/).map(tag => tag.trim()).filter(Boolean))] } : {}),
          ...(batch.applySource ? { source: batch.source.trim() } : {}),
          ...(batch.difficulty !== "keep" ? { difficulty: batch.difficulty === "unset" ? undefined : batch.difficulty as Question["difficulty"] } : {}),
        };
        return { id: entry.id, question, expectedContentKey: entry.contentKey };
    });
    acceptBank(await bankBridge().bankReviseBatch(revisions));
    setBatchOpen(false); toast({ title: `已更新 ${entries.length} 道题`, desc: "原版本已保留" });
  });
  const assignCollection = () => task(async () => {
    if (!collectionTarget) return;
    acceptBank(await bankBridge().bankManage({ action: "metadata", ids: selectedEntries.map(entry => entry.id), appendCollectionId: collectionTarget }));
    setCollectionTarget(""); toast({ title: "已加入收藏夹" });
  });
  const dropIntoCollection = (raw: string, targetId: string) => task(async () => {
    const plan = planCollectionDrop(bankRef.current, raw, targetId);
    if (!plan.ids.length) { toast({ title: `题目已在“${plan.name}”中` }); return; }
    // Append in one atomic backend operation. Never replace memberships, move
    // the source question, create a content revision, or add it to the paper.
    acceptBank(await bankBridge().bankManage({ action: "metadata", ids: plan.ids, appendCollectionId: targetId }));
    toast({ title: `已将 ${plan.ids.length} 道题加入“${plan.name}”`, ...(plan.already ? { desc: `${plan.already} 道已有题目已跳过` } : {}) });
  });
  async function readPackage(file: File) {
    if (file.size > 250 * 1024 * 1024) throw Error("题库备份超过 250 MB，请拆分后导入");
    const content = await file.text();
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { throw Error("请选择完整的卷页题库或项目 JSON 文件"); }
    if ((raw as { schema?: string })?.schema === "juanye-bank/1") setPackageImport({ name: file.name, bank: checkedBankDocument(raw) });
    else { const project = parseProject(content); setPackageImport({ name: file.name, questions: project.exam.sections.flatMap(section => section.questions) }); }
  }
  const commitPackage = () => task(async () => {
    if (!packageImport) return;
    if (packageImport.bank) {
      const result = await bankBridge().bankImport(packageImport.bank); acceptBank(result.bank);
      toast({ title: `已导入 ${result.added} 道题`, ...(result.duplicates ? { desc: `${result.duplicates} 道重复题已跳过` } : {}) });
    } else await saveQuestions(packageImport.questions ?? [], packageImport.name);
    setPackageImport(null);
  });
  const exportBank = () => task(async () => {
    if (!window.juanye) throw Error("请使用桌面应用导出题库备份");
    const result = await window.juanye.saveText({ name: `卷页题库-${new Date().toISOString().slice(0, 10)}`, content: JSON.stringify(bank), extension: "json" });
    if (!result.canceled) toast({ title: "题库备份已导出", desc: "包含历史版本、收藏夹和嵌入题图" });
  });

  // One stable channel into the memoized cards. Events always read the current
  // selection/basket without forcing every card to receive new closures.
  const cardActions = useRef<BankCardActions>(null!);
  cardActions.current = {
    preview: choosePreview, select: toggleSelected, favorite: toggleFavorite,
    knowledge: knowledge => updateFilters({ knowledge }),
    pick: (id, source) => addToBasket([id], () => source),
    restore: id => { void restoreItems([id]); },
    drag: (entry, isSelected, transfer) => {
      if (busy) return false;
      const ids = isSelected ? selected : [entry.id];
      if (ids.length > 200) { toast({ title: "单次最多拖入 200 道题", tone: "warn" }); return false; }
      transfer.effectAllowed = "copy"; transfer.setData(BANK_DRAG_MIME, JSON.stringify(ids)); dragGhost(transfer, ids.length, entry.question.type); setDragging(true); setSidebarOpen(true); return true;
    },
    dragEnd: () => { setDragging(false); setDropActive(false); setCollectionDropId(""); if (!sidebarHovered.current && !sidebarRef.current?.contains(document.activeElement)) setSidebarOpen(false); },
  };
  const nav = (id: LibraryView, label: string, icon: ReactNode, count: number, tone: string) => <button key={id} className="bank-nav-item" data-active={view === id} data-bank-view={id} data-tone={tone} aria-label={`${label}，${count} 道题`} title={label} aria-pressed={view === id} onClick={() => changeView(id)}>
    {view === id && <SharedPill layoutId="bank-nav-pill" className="bank-nav-pill" transition={motionTransition} />}
    <span className="bank-nav-icon">{icon}</span><span className="bank-nav-label">{label}</span><small><AnimatedNumber value={count} /></small>
  </button>;
  const draftSection: Section | null = draft ? { id: "bank-edit", type: draft.question.type, title: "题库编辑", note: "", questions: [draft.question] } : null;
  const detailKey = draft ? `draft:${draft.question.id}` : preview ? `preview:${preview.id}` : "empty";
  const basketOpen = basketExpanded && !draft;
  const emptyKind = view === "trash" ? "trash" : live.length ? "search" : "empty";

  const toolbarActions = <div className="bank-workspace-actions" role="group" aria-label="题库操作">
        <IconButton label="导入文件" className="bank-context-action" disabled={busy} onClick={() => setFileImport(true)}><Upload size={15} /></IconButton>
        <IconButton label="图片 OCR" className="bank-context-action" disabled={busy} onClick={() => setOcrOpen(true)}><ScanText size={15} /></IconButton>
        <details className="bank-more" ref={moreDetails} onKeyDown={event => { if (event.key === "Escape" && moreDetails.current?.open) { event.preventDefault(); event.stopPropagation(); moreDetails.current.removeAttribute("open"); moreDetails.current.querySelector<HTMLElement>("summary")?.focus(); } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) moreDetails.current?.removeAttribute("open"); }}><summary aria-label="更多题库操作"><MoreHorizontal size={18} /></summary><div className="bank-more-menu" onClick={event => { if (event.target instanceof Element && event.target.closest("button")) moreDetails.current?.removeAttribute("open"); }}>
          <div className="bank-more-group">保存到题库</div>
          <button disabled={busy || !currentQuestion} onClick={() => currentQuestion && void task(() => saveQuestions([currentQuestion]))}><Plus size={14} />保存当前题</button>
          <button disabled={busy || !currentSelection.length} onClick={() => void task(() => saveQuestions(currentSelection))}><ListChecks size={14} />保存所选题目{currentSelection.length > 0 ? `（${currentSelection.length}）` : ""}</button>
          <button disabled={busy || !exam.sections.some(section => section.questions.length)} onClick={() => void task(() => saveQuestions(exam.sections.flatMap(section => section.questions)))}><BookOpen size={14} />保存当前试卷</button>
          <div className="bank-more-group">备份与同步</div>
          <button disabled={busy} onClick={() => packageInput.current?.click()}><Upload size={14} />导入题库 / 项目</button>
          <button disabled={busy || !loaded} onClick={() => void exportBank()}><Download size={14} />导出完整备份</button>
          <button disabled={busy} onClick={() => void task(async () => { acceptBank(await bankBridge().bankLoad()); setLoaded(true); })}><RefreshCw size={14} />刷新题库</button>
        </div></details>
        <IconButton label="新建题目" disabled={busy || !loaded} onClick={() => editEntry()}><Plus size={17} /></IconButton>
      </div>;

  return <motion.main ref={mainRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bank-workspace" data-testid="bank-workspace" data-right-open={rightOpen} data-dragging={dragging || undefined}>
    <input type="file" ref={packageInput} data-testid="bank-package-file" aria-label="导入题库或项目" accept=".json,.juanye" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void task(() => readPackage(file)); }} />

    <AnimatePresence initial={false}>{error && <motion.div key="error" className="bank-workspace-error" role="alert" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTransition}><span>{error}</span><button aria-label="关闭题库错误" onClick={() => setError("")}><X size={15} /></button></motion.div>}</AnimatePresence>
    <div className="bank-workspace-layout">
      <aside ref={sidebarRef} className="bank-library-sidebar" aria-label="题库导航" data-expanded={sidebarOpen} onPointerDown={event => { sidebarTouch.current = event.pointerType !== "mouse"; }} onPointerEnter={event => { if (event.pointerType === "mouse" && window.matchMedia("(hover: hover) and (pointer: fine)").matches) { sidebarHovered.current = true; setSidebarOpen(true); } }} onPointerLeave={() => { sidebarHovered.current = false; if (!dragging && !sidebarRef.current?.contains(document.activeElement)) setSidebarOpen(false); }} onFocusCapture={event => { if (!sidebarTouch.current || event.target.matches(":focus-visible")) setSidebarOpen(true); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !sidebarHovered.current && !dragging) setSidebarOpen(false); }} onDragOver={event => { if (busy || !event.dataTransfer.types.includes(BANK_DRAG_MIME)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!sidebarOpen) setSidebarOpen(true); }} onKeyDown={event => { if (event.key === "Escape" && sidebarOpen) { event.preventDefault(); event.stopPropagation(); sidebarRef.current?.querySelector<HTMLButtonElement>("[data-testid='bank-sidebar-toggle']")?.focus(); setSidebarOpen(false); } }}>
        <div className="bank-sidebar-surface" aria-hidden="true" />
        <button type="button" className="bank-sidebar-toggle" data-testid="bank-sidebar-toggle" aria-label={sidebarOpen ? "收起题库导航" : "展开题库导航"} title={sidebarOpen ? "收起题库导航" : "展开题库导航"} aria-expanded={sidebarOpen} aria-controls={sidebarPanelId} onClick={() => setSidebarOpen(value => !value)}>{sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
        <div className="bank-sidebar-panel" id={sidebarPanelId}>
        <nav className="bank-nav">{nav("all", "全部题目", <Library size={16} />, live.length, "all")}{nav("trash", "回收站", <Trash2 size={16} />, trashCount, "trash")}</nav>
        <div className="bank-sidebar-label bank-collection-heading"><span>收藏夹</span><IconButton label="新建收藏夹" className="bank-collection-add" disabled={busy} onClick={() => setCollectionEdit({ id: crypto.randomUUID(), name: "", ...(collectionId ? { parentId: collectionId } : {}) })}><FolderPlus size={15} /></IconButton></div>
        <div className="bank-collection-tree" data-testid="bank-collection-tree">{tree.map(({ collection, depth }, index) => <div key={collection.id} className="bank-collection-row" data-collection-id={collection.id} data-drop={collectionDropId === collection.id || undefined} data-depth={Math.min(depth, 5)} style={{ paddingLeft: Math.min(depth, 5) * 14, "--i": index, "--depth": Math.min(depth, 5) } as CSSProperties}
          onDragOver={event => { if (busy || !event.dataTransfer.types.includes(BANK_DRAG_MIME)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; if (!sidebarOpen) setSidebarOpen(true); if (collectionDropId !== collection.id) setCollectionDropId(collection.id); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCollectionDropId(previous => previous === collection.id ? "" : previous); }}
          onDrop={event => { if (!event.dataTransfer.types.includes(BANK_DRAG_MIME)) return; event.preventDefault(); event.stopPropagation(); const payload = event.dataTransfer.getData(BANK_DRAG_MIME); setCollectionDropId(""); setDragging(false); setDropActive(false); if (!busy) void dropIntoCollection(payload, collection.id); }}>
          <button className="bank-nav-item" data-active={collectionId === collection.id} aria-label={collection.name} title={collection.name} aria-pressed={collectionId === collection.id} onClick={() => changeView(`collection:${collection.id}`)}>{collectionId === collection.id && <SharedPill layoutId="bank-nav-pill" className="bank-nav-pill" transition={motionTransition} />}<span className="bank-nav-icon"><Folder size={15} /></span><span className="bank-nav-label" title={collection.name}>{collection.name}</span><small><AnimatedNumber value={collectionCounts.get(collection.id) ?? 0} /></small></button>
          <div className="bank-collection-tools"><button aria-label={`重命名收藏夹 ${collection.name}`} disabled={busy} onClick={() => setCollectionEdit({ ...collection })}><Pencil size={12} /></button><button aria-label={`删除收藏夹 ${collection.name}`} disabled={busy} onClick={() => void deleteCollection(collection)}><Trash2 size={12} /></button></div>
          {collectionDropId === collection.id && <span className="bank-folder-drop-hint" aria-hidden="true">松开加入</span>}
        </div>)}{!tree.length && <button className="bank-empty-collection" onClick={() => setCollectionEdit({ id: crypto.randomUUID(), name: "" })}><Plus size={13} />新建收藏夹</button>}</div>
        <div className="bank-sidebar-bottom">
          <div className="bank-library-summary" role="group" aria-label="题库概况">
            <div className="bank-library-usage"><Flame size={12} aria-hidden="true" /><span>累计使用</span><b><AnimatedNumber value={usageTotal} /></b></div>
            <div className="bank-library-distribution"><span>题型分布</span><TypeSpectrum segments={librarySegments} /></div>
          </div>
          <div className="bank-sidebar-stats" role="group" aria-label="题库状态快捷入口">
            <button type="button" className="bank-sidebar-stat" data-tone="favorite" data-bank-view="favorites" aria-label="我的收藏" title="我的收藏" aria-pressed={view === "favorites"} onClick={() => changeView("favorites")}><Star size={16} aria-hidden="true" /><b><AnimatedNumber value={favoriteCount} /></b></button>
            <button type="button" className="bank-sidebar-stat" data-tone="review" data-bank-view="review" aria-label="待核对" title="待核对" aria-pressed={view === "review"} onClick={() => changeView("review")}><Lightbulb size={16} aria-hidden="true" /><b><AnimatedNumber value={reviewCount} /></b></button>
          </div>
          <div className="bank-sidebar-footer"><div><span className="bank-local-dot" /><HardDrive size={13} />仅保存在本机</div><small>每次修改都会保留历史版本</small></div>
        </div>
        </div>
        <div className="sr-only" role="status" aria-live="polite">{collectionDropId ? `松开以加入收藏夹“${bank.collections.find(item => item.id === collectionDropId)?.name ?? ""}”` : ""}</div>
      </aside>

      <section className="bank-catalog" aria-label="题目列表" data-batch={selected.length > 0 || undefined}>
        <div className="bank-catalog-heading">
          <div className="bank-catalog-title" aria-label={`${title}，${filtered.length} 道题`}><span className="bank-catalog-count"><AnimatedNumber value={filtered.length} /> 道题</span><span className="bank-catalog-context"><AnimatePresence mode="popLayout" initial={false}><motion.h2 key={title} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={motionTransition}>{title}</motion.h2></AnimatePresence></span></div>
          <div className="bank-catalog-tools">
            <div className="bank-density" role="group" aria-label="题目显示方式">{(["list", "grid"] as const).map(mode => <button key={mode} aria-pressed={density === mode} aria-label={mode === "list" ? "列表视图" : "卡片视图"} title={mode === "list" ? "列表视图" : "卡片视图"} onClick={() => setDensity(mode)}>{density === mode && <SharedPill layoutId="bank-density-pill" className="bank-density-pill" transition={motionTransition} />}{mode === "list" ? <LayoutList size={15} /> : <LayoutGrid size={15} />}</button>)}</div>
            <IconButton label={rightOpen ? "收起题目详情" : "展开题目详情"} onClick={() => setRightOpen(value => !value)}>{rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</IconButton>
          </div>
        </div>
        <div className="bank-search-toolbar"><div className="bank-search" data-filled={!!filters.query || undefined}><Search size={16} /><input ref={searchRef} className={`${inputCls} bank-search-input`} aria-label="搜索题库" placeholder="搜索题目…" value={filters.query ?? ""} onChange={event => updateFilters({ query: event.target.value })} onKeyDown={event => { if (event.key === "Escape" && filters.query) { event.stopPropagation(); updateFilters({ query: "" }); } }} />{filters.query ? <button aria-label="清空题库搜索" onClick={() => { updateFilters({ query: "" }); searchRef.current?.focus(); }}><X size={14} /></button> : <kbd aria-hidden="true">/</kbd>}<span className="bank-search-glow" aria-hidden="true" /></div>{toolbarActions}</div>
        <div className="bank-type-rail" role="group" aria-label="按题型筛选">
          <button aria-pressed={!filters.type} onClick={() => updateFilters({ type: "" })}>{!filters.type && <SharedPill layoutId="bank-type-pill" className="bank-type-pill" transition={motionTransition} />}<span>全部</span><small><AnimatedNumber value={typeBase.length} /></small></button>
          {typeCounts.filter(item => item.count || filters.type === item.key).map(item => <button key={item.key} aria-pressed={filters.type === item.key} style={hueStyle(item.key as QType)} onClick={() => updateFilters({ type: filters.type === item.key ? "" : item.key as QType })}>{filters.type === item.key && <SharedPill layoutId="bank-type-pill" className="bank-type-pill" transition={motionTransition} />}<i aria-hidden="true" /><span>{TYPE_META[item.key as QType].short}</span><small><AnimatedNumber value={item.count} /></small></button>)}
        </div>
        <div className="bank-filter-grid">
          <Select aria-label="题库知识点" value={filters.knowledge ?? ""} onValueChange={knowledge => updateFilters({ knowledge })} options={[{ value: "", label: "全部知识点" }, ...knowledge.map(value => ({ value, label: value }))]} />
          <Select aria-label="题库难度" value={filters.difficulty ?? ""} onValueChange={difficulty => updateFilters({ difficulty: difficulty as BankFilters["difficulty"] })} options={[{ value: "", label: "全部难度" }, ...Object.entries(DIFFICULTY).map(([value, label]) => ({ value, label })), { value: "unset", label: "未设置难度" }]} />
          <Select aria-label="题库来源" value={filters.source ?? ""} onValueChange={source => updateFilters({ source })} options={[{ value: "", label: "全部来源" }, ...sources.map(value => ({ value, label: value }))]} />
        </div>
        <AnimatePresence initial={false}>{chips.length > 0 && <motion.div key="chips" className="bank-active-filters" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={motionTransition}>
          <div><AnimatePresence mode="popLayout" initial={false}>{chips.map(chip => <motion.button layout key={chip.key} aria-label={`移除筛选 ${chip.label}`} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={motionTransition} onClick={chip.clear}><span>{chip.label}</span><X size={11} /></motion.button>)}</AnimatePresence><motion.button layout className="bank-text-action" onClick={resetFilters}>重置筛选</motion.button></div>
        </motion.div>}</AnimatePresence>
        <div className="bank-result-toolbar"><label><Checkbox aria-label="全选筛选结果" disabled={busy || !filtered.length} checked={filtered.length > 0 && filtered.every(entry => selected.includes(entry.id)) ? true : filtered.some(entry => selected.includes(entry.id)) ? "mixed" : false} onCheckedChange={checked => setSelected(checked ? filtered.map(entry => entry.id) : [])} /><span>{selected.length ? <>已选 <AnimatedNumber value={selected.length} /></> : "全选"}</span></label>{selected.length > 0 && <button className="bank-text-action" onClick={() => setSelected([])}>清除</button>}<span className="bank-result-hint"><kbd>↑</kbd><kbd>↓</kbd> 切换预览</span><Select aria-label="题库排序" className="bank-sort" value={filters.sort ?? "recent"} onValueChange={sort => updateFilters({ sort: sort as BankFilters["sort"] })} options={[{ value: "recent", label: "最近添加" }, { value: "used", label: "使用最多" }, { value: "score", label: "分值从高到低" }]} /></div>
        <motion.fieldset disabled={busy} layoutScroll className="bank-catalog-list" data-testid="bank-question-list" data-density={density} aria-label="题目与选择操作" aria-busy={busy || deferredQuery !== (filters.query ?? "")}>
          {busy && !loaded && <div className="bank-skeletons" role="status" aria-label="正在读取题库…">{[0, 1, 2, 3].map(index => <div key={index} className="bank-skeleton" style={{ "--i": index } as CSSProperties}><i /><i /><i /><i /></div>)}</div>}
          {loaded && !filtered.length && <motion.div key={`empty-${emptyKind}`} className="bank-workspace-empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={motionTransition}><EmptyArt kind={emptyKind} /><h3>{view === "trash" ? "回收站为空" : live.length ? "没有符合条件的题目" : "题库暂无题目"}</h3><p>{view === "trash" ? "移入回收站的题目会保留全部历史版本" : live.length ? "换个关键词，或重置筛选条件" : "新建题目，或从文件和试卷中保存"}</p>{chips.length > 0 && <Button size="sm" variant="outline" onClick={resetFilters} icon={<RotateCcw size={13} />}>重置筛选</Button>}{!live.length && view !== "trash" && <Button size="sm" variant="outline" onClick={() => setFileImport(true)} icon={<Upload size={13} />}>导入题目</Button>}</motion.div>}
          <motion.div key={listKey} className="bank-entry-grid" variants={listVariants} initial={rich ? "hidden" : false} animate="show">
          {visible.map(entry => <BankQuestionCard key={entry.id} entry={entry} active={preview?.id === entry.id} inBasket={basketIds.has(entry.id)} selected={selectedIds.has(entry.id)} rich={rich} burst={bursts[entry.id] ?? 0} knowledge={filters.knowledge} layoutKey={visibleLayoutKey} actions={cardActions} />)}
          </motion.div>
        </motion.fieldset>
        <AnimatePresence>{selected.length > 0 && <motion.div key="batch" className="bank-batch-toolbar" data-testid="bank-batch-toolbar" initial={{ y: 46, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 36, opacity: 0, scale: 0.96, transition: { duration: 0.16 } }} transition={motionTransition}>
          <span className="bank-batch-count"><b><AnimatedNumber value={selected.length} /></b>已选</span>
          {view === "trash" ? <Button size="sm" variant="outline" disabled={busy} icon={<RotateCcw size={13} />} onClick={() => void restoreItems(selected)}>恢复所选</Button> : <>
            <Button size="sm" variant="primary" disabled={busy} icon={<ShoppingBasket size={13} />} onClick={() => addToBasket(selected, cardSource)}>加入选题篮</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void metadata(selected, { favorite: true })} icon={<Star size={13} />}>收藏</Button>
            <Button size="sm" variant="ghost" disabled={busy} icon={<Sparkles size={13} />} onClick={() => { setBatch({ knowledge: "", difficulty: "keep", source: "", applyKnowledge: false, applySource: false }); setBatchOpen(true); }}>批量属性</Button>
            <Button size="sm" variant="ghost" className="bank-batch-danger" disabled={busy} onClick={() => void trashItems(selected)} icon={<Trash2 size={13} />}>移入回收站</Button>
            {bank.collections.length > 0 && <div className="bank-assign-collection"><Select aria-label="批量加入收藏夹" value={collectionTarget} onValueChange={setCollectionTarget} options={[{ value: "", label: "加入收藏夹…" }, ...tree.map(({ collection, depth }) => ({ value: collection.id, label: `${"　".repeat(Math.min(depth, 5))}${collection.name}` }))]} /><Button size="sm" variant="outline" disabled={busy || !collectionTarget} onClick={() => void assignCollection()}>确定</Button></div>}
          </>}
          <IconButton label="取消选择" className="bank-batch-close" onClick={() => setSelected([])}><X size={15} /></IconButton>
        </motion.div>}</AnimatePresence>
        <footer className="bank-pagination"><span>{filtered.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / ${filtered.length}` : "0 道题"}</span><IconButton label="题库上一页" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></IconButton><span className="bank-page-number"><AnimatePresence mode="popLayout" initial={false}><motion.b key={currentPage} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={motionTransition}>{currentPage + 1}</motion.b></AnimatePresence> / {pages}</span><IconButton label="题库下一页" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></IconButton></footer>
      </section>

      {rightOpen ? <motion.aside key="detail" className="bank-detail-pane" aria-label="题目详情与选题篮" data-testid="bank-detail-pane" data-editing={!!draft} initial={rich ? { opacity: 0, clipPath: "inset(0 0 0 100%)" } : false} animate={{ opacity: 1, clipPath: "inset(0 0 0 0%)", transitionEnd: { clipPath: "none" } }} transition={rich ? { type: "spring", stiffness: 300, damping: 34 } : { duration: 0 }}>
        <div className="bank-detail-heading"><AnimatePresence mode="popLayout" initial={false}><motion.h2 key={draft ? draft.entry ? "edit" : "new" : "detail"} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={motionTransition}>{draft ? draft.entry ? "编辑题目" : "新建题目" : "题目详情"}</motion.h2></AnimatePresence>{draft && <span className="bank-detail-subtitle" data-dirty={dirty || undefined}>{dirty ? "未保存" : "草稿"}</span>}<IconButton label="收起题目详情" className="bank-detail-collapse" onClick={() => setRightOpen(false)}><PanelRightClose size={16} /></IconButton></div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={detailKey} className="bank-detail-body" initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18, transition: { duration: 0.11 } }} transition={motionTransition}>
          {draft ? <>
            <div className="bank-question-editor" data-testid="bank-question-editor">{active && <Editor q={draft.question} focusTarget={draft.focusTarget} sec={draftSection} secIndex={0} num={1} total={1} dir={0} neighbors={{}} onChange={patch => setDraft(value => value ? { ...value, question: { ...value.question, ...patch } } : value)} onPrev={() => {}} onNext={() => {}} onConvert={() => setDraft(value => value ? { ...value, question: changeQuestionType(value.question, "essay") } : value)} onDelete={() => { if (canLeaveDraft()) setDraft(null); }} onStart={() => {}} onOcr={() => setOcrOpen(true)} />}</div>
            <div className="bank-edit-footer"><span>{draft.entry ? `保存为版本 ${draft.entry.version + 1}` : "仅保存到题库"}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (canLeaveDraft()) setDraft(null); }}>取消</Button><Button size="sm" variant="primary" disabled={busy || (!!draft.entry && !dirty)} icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} onClick={() => void saveDraft()}>保存</Button></div>
          </> : preview ? <>
            <div className="bank-detail-tools" style={hueStyle(preview.question.type)}><span className="bank-type-tag"><QuestionTypeIcon type={preview.question.type} width={13} height={13} />{TYPE_META[preview.question.type].short}</span><span className="bank-detail-meta">{TYPE_META[preview.question.type].label} · {preview.question.score} 分{preview.version > 1 ? ` · v${preview.version}` : ""}</span><IconButton label="版本历史" className="bank-detail-action" active={historyOpen} onClick={() => setHistoryOpen(value => !value)}><History size={15} /></IconButton><Button className="bank-edit-main" size="sm" variant="outline" disabled={busy || !!preview.trashedAt || preview.id !== newest?.id} onClick={() => editEntry(preview)} icon={<Pencil size={12} />}>编辑题目</Button></div>
            <Reveal open={historyOpen} className="bank-version-reveal"><div className="bank-version-history" data-testid="bank-version-history"><h3><Clock3 size={12} />版本历史 · {versions.length}</h3>{versions.map((entry, index) => <motion.div key={entry.id} className="bank-version-row" data-current={entry.id === newest?.id || undefined} initial={rich ? { opacity: 0, x: -10 } : false} animate={{ opacity: 1, x: 0 }} transition={{ ...cardSpring, delay: index * 0.04 }}><i aria-hidden="true" /><button data-active={entry.id === preview.id} onClick={() => setPreviewId(entry.id)}><span>版本 {entry.version}{entry.id === newest?.id ? " · 当前" : ""}</span><small>{dateText(entry.createdAt)}</small></button>{entry.id !== newest?.id && !entry.trashedAt && <button className="bank-version-restore" aria-label={`恢复版本 ${entry.version} 为新版本`} disabled={busy} onClick={() => void task(async () => { if (!newest || !window.confirm(`将版本 ${entry.version} 的内容保存为新版本？所有历史版本均保留。`)) return; const result = await bankBridge().bankRevise({ id: newest.id, question: entry.question, expectedContentKey: newest.contentKey }); acceptBank(result.bank); setPreviewId(result.entry.id); toast({ title: "已保存为新版本" }); })}><RotateCcw size={13} /></button>}</motion.div>)}</div></Reveal>
            <div className="bank-preview-scroll" data-testid="bank-question-preview">
              <div className="bank-preview-paper" style={hueStyle(preview.question.type)}><BankQuestionPreview question={preview.question} onZoom={setZoom} onEdit={editPreview} editable={!busy && !preview.trashedAt && preview.id === newest?.id} /></div>
              <div className="bank-preview-metadata">
                <div className="bank-meta-tile"><span>难度</span>{preview.question.difficulty ? <DifficultyMeter level={preview.question.difficulty} label={DIFFICULTY[preview.question.difficulty]} /> : <b>未设置</b>}</div>
                <div className="bank-meta-tile"><span>使用记录</span><b>{preview.usageCount} 次</b><small>{dateText(preview.lastUsedAt)}</small></div>
                <div className="bank-meta-tile bank-meta-wide"><span>来源</span><b>{preview.question.source || preview.origin.examTitle || "未设置"}</b></div>
                <div className="bank-meta-tile bank-meta-wide"><span>知识点</span>{preview.question.knowledge?.length ? <div className="bank-meta-tags">{preview.question.knowledge.map((tag, index) => <button key={`${tag}-${index}`} onClick={() => updateFilters({ knowledge: tag })}><Tag size={10} />{tag}</button>)}</div> : <b>未设置</b>}</div>
                <div className="bank-meta-tile bank-meta-wide"><span>版本</span><b>v{preview.version}</b><small>{dateText(preview.createdAt)}</small></div>
                {preview.question.flag && <div className="bank-meta-tile bank-meta-wide bank-review-note"><span>待核对</span><b>{preview.question.flag}</b></div>}
                {preview.collectionIds.length > 0 && <div className="bank-preview-collections bank-meta-wide"><span>收藏夹</span>{preview.collectionIds.map(id => <button key={id} disabled={busy || !!preview.trashedAt} onClick={() => void metadata([preview.id], { collectionIds: preview.collectionIds.filter(item => item !== id) })} title="移出此收藏夹"><Folder size={11} />{bank.collections.find(item => item.id === id)?.name ?? "收藏夹"}<X size={11} /></button>)}</div>}
              </div>
              <div className="bank-preview-bottom-actions">{preview.trashedAt ? <Button size="sm" variant="outline" disabled={busy} icon={<RotateCcw size={13} />} onClick={() => void restoreItems([preview.id])}>恢复题目</Button> : <><Button size="sm" variant="primary" disabled={busy || basket.includes(newest?.id ?? preview.id)} icon={basket.includes(newest?.id ?? preview.id) ? <Check size={13} /> : <ShoppingBasket size={13} />} onClick={event => { const source = event.currentTarget; addToBasket([newest?.id ?? preview.id], () => source); }}>{basket.includes(newest?.id ?? preview.id) ? "已在选题篮" : "加入选题篮"}</Button><Button size="sm" variant="ghost" className="bank-batch-danger" disabled={busy} icon={<Trash2 size={13} />} onClick={() => void trashItems([preview.id])}>移入回收站</Button></>}</div>
            </div>
          </> : <div className="bank-workspace-empty bank-preview-empty"><EmptyArt kind="preview" /><h3>选择题目查看完整内容</h3><p>在列表中按 <kbd>↑</kbd> <kbd>↓</kbd> 快速切换</p></div>}
          </motion.div>
        </AnimatePresence>

        <section className="bank-basket" data-testid="bank-basket" data-expanded={basketOpen} data-drop={dropActive || undefined}
          onDragOver={event => { if (!event.dataTransfer.types.includes(BANK_DRAG_MIME)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!dropActive) setDropActive(true); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
          onDrop={event => { setDropActive(false); setDragging(false); if (!event.dataTransfer.types.includes(BANK_DRAG_MIME)) return; event.preventDefault(); try { addToBasket(parseBankDrag(event.dataTransfer.getData(BANK_DRAG_MIME))); } catch (cause) { toast({ title: "无法加入选题篮", desc: message(cause), tone: "warn" }); } }}>
          <button className="bank-basket-heading" aria-expanded={basketOpen} onClick={() => setBasketExpanded(value => !value)}>
            <motion.span key={pulse} className="bank-basket-icon" data-basket-anchor="" initial={false} animate={pulse && rich ? { scale: [1, 1.45, 0.9, 1.08, 1], rotate: [0, -14, 10, -4, 0] } : { scale: 1 }} transition={{ duration: 0.55 }}><ShoppingBasket size={16} /></motion.span>
            <strong>选题篮</strong><span className="bank-basket-summary"><AnimatedNumber value={basketEntries.length} /> 题 · <AnimatedNumber value={totalScore} format={scoreText} /> 分</span>
            <TypeSpectrum segments={basketSegments} decorative className="bank-basket-spectrum" /><ChevronDown size={15} />
          </button>
          <Reveal open={basketOpen} className="bank-basket-body">
            <motion.div layoutScroll className="bank-basket-list">{!basketEntries.length && <p className="bank-basket-empty"><ShoppingBasket size={18} /><span>点击题目上的“选题”，或把题目拖到这里</span></p>}{basketEntries.map((entry, index) => <motion.div layout={rich ? "position" : false} layoutDependency={basket.join("|")} className="bank-basket-item" key={entry.id} data-basket-id={entry.id} style={hueStyle(entry.question.type)} initial={rich ? { opacity: 0, x: 28, scale: 0.94 } : false} animate={{ opacity: 1, x: 0, scale: 1 }} transition={motionTransition}><span className="bank-basket-index">{index + 1}</span><button className="bank-basket-stem" onClick={() => choosePreview(entry.id)} title={plain(entry.question.stem)}><i>{TYPE_META[entry.question.type].short}</i>{plain(entry.question.stem) || "题图题目"}</button><small>{entry.question.score} 分</small><button aria-label={`上移选题 ${index + 1}`} disabled={index === 0 || busy} onClick={() => moveBasket(index, -1)}><ArrowUp size={12} /></button><button aria-label={`下移选题 ${index + 1}`} disabled={index === basketEntries.length - 1 || busy} onClick={() => moveBasket(index, 1)}><ArrowDown size={12} /></button><button aria-label={`移除选题 ${index + 1}`} disabled={busy} onClick={() => setBasket(value => value.filter(id => id !== entry.id))}><X size={13} /></button></motion.div>)}</motion.div>
            <div className="bank-basket-insert"><Select aria-label="题库目标大题" value={targetId} onValueChange={setTarget} disabled={!exam.sections.length || busy} options={exam.sections.length ? exam.sections.map((section, index) => ({ value: section.id, label: `${index + 1}. ${section.title || TYPE_META[section.type].label}` })) : [{ value: "", label: "当前试卷暂无大题" }]} /><Button size="sm" variant="primary" disabled={busy || !basketEntries.length || !targetId} onClick={() => void insertBasket(false)}>加入当前试卷</Button></div>
            <div className="bank-basket-footer"><button disabled={busy || !basketEntries.length} onClick={() => setBasket([])}>清空选题篮</button><Button size="sm" variant="ghost" disabled={busy || !basketEntries.length} icon={<FilePlus2 size={13} />} onClick={() => void insertBasket(true)}>选题新建试卷</Button></div>
          </Reveal>
          <div className="bank-basket-drop" aria-hidden="true"><ShoppingBasket size={18} />松开即可加入选题篮</div>
        </section>
      </motion.aside> : <motion.button key="rail" className="bank-detail-rail" aria-label={`展开题目详情和选题篮，已选 ${basketEntries.length} 题`} onClick={() => setRightOpen(true)} initial={rich ? { opacity: 0 } : false} animate={{ opacity: 1 }}><PanelRightOpen size={17} /><span>题目详情</span><motion.span key={pulse} className="bank-rail-basket" data-basket-anchor="" initial={false} animate={pulse && rich ? { scale: [1, 1.45, 0.9, 1] } : { scale: 1 }} transition={{ duration: 0.5 }}><ShoppingBasket size={16} /></motion.span><b>{basketEntries.length}</b></motion.button>}
    </div>

    <FlightLayer flights={active && rich ? flights : []} onArrive={arrive} />
    <FigureLightbox figure={active ? zoom : null} onClose={() => setZoom(null)} />
    <AnimatePresence>
    {active && collectionEdit && <CollectionEditor key={collectionEdit.id} collection={collectionEdit} collections={bank.collections} busy={busy} error={error} onClose={() => setCollectionEdit(null)} onSave={collection => void task(async () => { acceptBank(await bankBridge().bankManage({ action: "collection-save", collection })); setCollectionEdit(null); })} />}
    {active && batchOpen && <Modal key="bank-batch" open onClose={() => !busy && setBatchOpen(false)} label="批量修改题目属性" className="bank-dialog"><div className="bank-dialog-title"><span><Sparkles size={17} /></span><div><h2>批量属性 · {selectedEntries.length} 道题</h2><p className="bank-dialog-note">保存后生成新版本，历史内容保留。</p></div></div><label className="bank-dialog-check"><Checkbox aria-label="修改所选题目知识点" checked={batch.applyKnowledge} onCheckedChange={value => setBatch(previous => ({ ...previous, applyKnowledge: value }))} />修改知识点</label><input aria-label="批量知识点" disabled={!batch.applyKnowledge || busy} className={inputCls} placeholder="多个知识点用逗号分隔；留空清除" value={batch.knowledge} onChange={event => setBatch(value => ({ ...value, knowledge: event.target.value }))} /><Field label="难度"><Select aria-label="批量难度" value={batch.difficulty} onValueChange={difficulty => setBatch(value => ({ ...value, difficulty }))} options={[{ value: "keep", label: "保持不变" }, { value: "unset", label: "清除难度" }, ...Object.entries(DIFFICULTY).map(([value, label]) => ({ value, label }))]} /></Field><label className="bank-dialog-check"><Checkbox aria-label="修改所选题目来源" checked={batch.applySource} onCheckedChange={value => setBatch(previous => ({ ...previous, applySource: value }))} />修改来源</label><input aria-label="批量来源" disabled={!batch.applySource || busy} className={inputCls} placeholder="留空清除来源" value={batch.source} onChange={event => setBatch(value => ({ ...value, source: event.target.value }))} />{error && <p className="text-danger text-[12px]" role="alert">{error}</p>}<div className="bank-dialog-footer"><Button variant="ghost" disabled={busy} onClick={() => setBatchOpen(false)}>取消</Button><Button variant="primary" disabled={busy || (!batch.applyKnowledge && !batch.applySource && batch.difficulty === "keep")} onClick={() => void batchMetadata()}>保存属性</Button></div></Modal>}
    {active && packageImport && <Modal key="bank-package" open onClose={() => !busy && setPackageImport(null)} label="导入题库或项目" className="bank-dialog"><div className="bank-dialog-title"><span><Upload size={17} /></span><div><h2>导入到题库</h2><p className="bank-dialog-note">{packageImport.name}</p></div></div><div className="bank-import-summary"><b>{packageImport.bank ? latestBankEntries(packageImport.bank.entries).length : packageImport.questions?.length ?? 0}</b><span>道题{packageImport.bank ? ` · ${packageImport.bank.collections.length} 个收藏夹` : ""}</span></div><p className="bank-dialog-note">合并到现有题库，重复题自动跳过。当前试卷不变。</p>{error && <p className="text-danger text-[12px]" role="alert">{error}</p>}<div className="bank-dialog-footer"><Button variant="ghost" disabled={busy} onClick={() => setPackageImport(null)}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void commitPackage()}>确认导入</Button></div></Modal>}
    {active && fileImport && <ImportDialog key="bank-file" kind="questions" exam={{ ...exam, sections: [] }} onClose={() => setFileImport(false)} onCommit={value => { if (value.kind !== "solutions") void task(async () => { await saveQuestions(value.questions, "文件导入"); setFileImport(false); }); }} />}
    </AnimatePresence>
    <OcrDialog open={active && ocrOpen} onClose={() => setOcrOpen(false)} onAdd={questions => void task(async () => { await saveQuestions(questions, "OCR 导入"); setOcrOpen(false); })} />
  </motion.main>;
});

const BankQuestionCard = memo(function BankQuestionCard({ entry, active, inBasket, selected, rich, burst, knowledge, layoutKey, actions }: { entry: BankEntry; active: boolean; inBasket: boolean; selected: boolean; rich: boolean; burst: number; knowledge?: string; layoutKey: string; actions: MutableRefObject<BankCardActions> }) {
  const q = entry.question, transition = rich ? cardSpring : instantMotion;
  const content = useMemo(() => ({ figure: questionFigures(q)[0], stem: stripTikzBlocks(q.stem), label: plain(q.stem).slice(0, 28) || "空题干" }), [q]);
  return <motion.div className="bank-entry-motion" layout={rich ? "position" : false} layoutDependency={layoutKey} variants={cardVariants} transition={transition}>
    <article className="bank-entry" data-bank-id={entry.id} data-bank-entry={entry.id} data-active={active} data-selected={selected || undefined} data-in-basket={inBasket || undefined} data-testid="bank-entry" style={hueStyle(q.type)} draggable={!entry.trashedAt} onDragStart={event => { if (!actions.current.drag(entry, selected, event.dataTransfer)) event.preventDefault(); }} onDragEnd={() => actions.current.dragEnd()}>
      <span className="bank-entry-accent" aria-hidden="true" />
      <div className="bank-entry-top"><Checkbox aria-label={`选择题库题目 ${entry.id}`} checked={selected} onCheckedChange={checked => actions.current.select(entry.id, checked)} /><span className="bank-type-tag"><QuestionTypeIcon type={q.type} width={13} height={13} />{TYPE_META[q.type].short}</span><span className="bank-score-tag">{q.score} 分</span>{q.difficulty && <DifficultyMeter level={q.difficulty} label={DIFFICULTY[q.difficulty]} />}{entry.version > 1 && <span className="bank-version-tag">v{entry.version}</span>}{q.flag && <span className="bank-flag-tag" title={q.flag}>待核对</span>}<span className="bank-entry-grip" aria-hidden="true"><GripVertical size={14} /></span><button className="bank-favorite" data-favorite={entry.favorite} aria-label={entry.favorite ? "取消收藏题目" : "收藏题目"} disabled={!!entry.trashedAt} onClick={() => actions.current.favorite(entry)}><motion.span key={String(entry.favorite)} initial={rich && entry.favorite ? { scale: 0.3, rotate: -60 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 14 }}><Star size={15} fill={entry.favorite ? "currentColor" : "none"} /></motion.span><StarBurst burst={burst} /></button></div>
      <button className="bank-entry-preview" aria-label={`预览题目 ${content.label}`} onClick={() => actions.current.preview(entry.id)}><div className="bank-entry-stem"><MathText text={content.stem} placeholder="（题图题目）" /></div>{content.figure && <img src={content.figure.src} alt="题图缩略图" loading="lazy" decoding="async" />}</button>
      {!!q.knowledge?.length && <div className="bank-tags">{q.knowledge.slice(0, 4).map((tag, index) => <button key={`${tag}-${index}`} data-active={knowledge === tag || undefined} onClick={() => actions.current.knowledge(tag)}><Tag size={10} />{tag}</button>)}{q.knowledge.length > 4 && <span>+{q.knowledge.length - 4}</span>}</div>}
      <div className="bank-entry-bottom"><span title={q.source || entry.origin.examTitle}>{q.source || entry.origin.examTitle || "未设置来源"}</span><small><Flame size={11} />{entry.usageCount}</small>{entry.trashedAt ? <Button className="bank-restore" size="sm" variant="ghost" onClick={() => actions.current.restore(entry.id)}>恢复</Button> : <Button size="sm" variant={inBasket ? "ghost" : "outline"} className="bank-pick" data-picked={inBasket || undefined} disabled={inBasket} icon={inBasket ? <Check size={12} /> : <Plus size={12} />} onClick={event => actions.current.pick(entry.id, event.currentTarget)}><motion.span key={String(inBasket)} initial={rich ? { y: 9, opacity: 0 } : false} animate={{ y: 0, opacity: 1 }} transition={transition}>{inBasket ? "已选" : "选题"}</motion.span></Button>}</div>
    </article>
  </motion.div>;
});

const BankQuestionPreview = memo(function BankQuestionPreview({ question: q, onZoom, onEdit, editable }: { question: Question; onZoom: (figure: ZoomFigure) => void; onEdit: (target: EditTarget) => void; editable: boolean }) {
  const rich = useRichMotion();
  const drawings = [...extractTikzBlocks(q.stem), ...(q.drawing?.trim() ? [q.drawing] : [])];
  return <div className="bank-complete-preview">
    <div className="bank-complete-stem" title={editable ? "双击编辑题干" : undefined} onDoubleClick={() => editable && onEdit("question")}><MathText text={stripTikzBlocks(q.stem)} placeholder="（空题干）" /></div>
    {q.options.length > 0 && <div className="bank-complete-options">{q.options.map((option, index) => { const correct = q.answer.includes(String.fromCharCode(65 + index)); return <motion.div key={index} data-correct={correct} title={editable ? "双击编辑选项" : undefined} onDoubleClick={() => editable && onEdit("question")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={rich ? { ...cardSpring, delay: 0.06 + index * 0.045 } : { duration: 0 }}><b>{String.fromCharCode(65 + index)}</b><MathText text={option} placeholder="（空选项）" />{correct && <Check className="bank-option-check" size={14} aria-label="正确答案" />}</motion.div>; })}</div>}
    {questionFigures(q).map(figure => <figure key={figure.id}><button type="button" className="bank-figure-zoom" aria-label="放大题图" onClick={() => onZoom({ id: figure.id, src: figure.src, caption: figure.caption })}><img src={figure.src} alt={figure.caption || "题图"} /><span aria-hidden="true"><ZoomIn size={14} /></span></button>{figure.caption && <figcaption><MathText text={figure.caption} /></figcaption>}</figure>)}
    {q.image === "plot" && <div className="bank-preview-drawing"><PlotSvg ink="var(--color-fg)" accent="var(--color-accent)" width={260} /></div>}
    {drawings.map((code, index) => <div key={index} className="bank-preview-drawing bank-preview-tikz"><TikzDrawing code={code} /></div>)}
    <section className="bank-answer-block" data-kind="answer"><h3><Check size={12} />参考答案<button type="button" disabled={!editable} onClick={() => onEdit("answer")}><Pencil size={11} />编辑答案</button></h3><MathText text={q.answer.join("；")} placeholder="未设置答案" /></section>
    <section className="bank-answer-block" data-kind="analysis"><h3><Lightbulb size={12} />解析<button type="button" disabled={!editable} onClick={() => onEdit("analysis")}><Pencil size={11} />编辑解析</button></h3><MathText text={q.analysis} placeholder="未设置解析" /></section>
    {q.sourceImage && <details className="bank-source-image"><summary>查看题目原图</summary><img src={q.sourceImage} alt="题目原图" /></details>}
  </div>;
});

function CollectionEditor({ collection, collections, busy, error, onClose, onSave }: { collection: Collection; collections: Collection[]; busy: boolean; error?: string; onClose: () => void; onSave: (value: Collection) => void }) {
  const [name, setName] = useState(collection.name), [parentId, setParentId] = useState(collection.parentId ?? "");
  const excluded = new Set([collection.id]);
  for (let changed = true; changed;) { changed = false; for (const item of collections) if (item.parentId && excluded.has(item.parentId) && !excluded.has(item.id)) { excluded.add(item.id); changed = true; } }
  return <Modal open onClose={() => !busy && onClose()} label={collection.name ? "编辑收藏夹" : "新建收藏夹"} className="bank-dialog"><div className="bank-dialog-title"><span><Folder size={17} /></span><div><h2>{collection.name ? "编辑收藏夹" : "新建收藏夹"}</h2><p className="bank-dialog-note">收藏夹只整理题目，不会复制或修改题目内容。</p></div></div><Field label="名称"><input autoFocus aria-label="收藏夹名称" className={inputCls} maxLength={100} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && name.trim() && !busy) onSave({ id: collection.id, name: name.trim(), ...(parentId ? { parentId } : {}) }); }} /></Field><Field label="上级收藏夹"><Select aria-label="上级收藏夹" value={parentId} onValueChange={setParentId} options={[{ value: "", label: "无（顶层）" }, ...collections.filter(item => !excluded.has(item.id)).map(item => ({ value: item.id, label: item.name }))]} /></Field>{error && <p role="alert" className="text-danger text-[12px]">{error}</p>}<div className="bank-dialog-footer"><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => onSave({ id: collection.id, name: name.trim(), ...(parentId ? { parentId } : {}) })}>保存</Button></div></Modal>;
}
