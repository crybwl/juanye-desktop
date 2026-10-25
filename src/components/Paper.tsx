import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Exam, Layout, Question, QuestionFigure } from "../types";
import { CN_NUM, LETTERS, MM, PAPER_MM, sectionNote } from "../data";
import { MathText, plain } from "../math";
import { cx } from "../ui";
import { hasOptions, isLongAnswer, questionFigures } from "../figures";
import { extractTikzBlocks, stripTikzBlocks } from "../drawing";
import { TikzDrawing } from "../TikzDrawing";
import { safePageCut, samePages, type PagePiece, type SplitGuard } from "../pagination-geometry";

/* ---------- 尺寸与变量 ---------- */
export function pageDims(layout: Layout) {
  const [w, h] = PAPER_MM[layout.paper];
  const [pw, ph] = layout.orientation === "portrait" ? [w, h] : [h, w];
  return { pw: pw * MM, ph: ph * MM, m: layout.margin * MM };
}
export function paperVars(layout: Layout): CSSProperties {
  const gap = { compact: 0.6, standard: 1, loose: 1.5 }[layout.density];
  return { "--fs": `${(layout.fontSize * 96) / 72}px`, "--lh": layout.lineHeight, "--gap": gap, "--question-gap": layout.questionGap === undefined ? `${10 * gap}px` : `${layout.questionGap}mm`, "--option-gap": layout.optionGap === undefined ? `${2 * gap}px` : `${layout.optionGap}mm` } as CSSProperties;
}
export const gapOf = (l: Layout) => ({ compact: 0.6, standard: 1, loose: 1.5 })[l.density];

/* ---------- 题图：y = tan x 与 y = ax 的交点 ---------- */
export function PlotSvg({ ink = "#222", accent = "#3b5bdb", width = 230 }: { ink?: string; accent?: string; width?: number }) {
  const W = 230,
    H = 150,
    x0 = 22,
    y0 = 128;
  const sx = (x: number) => x0 + (x / 1.7) * (W - 34);
  const sy = (y: number) => y0 - (y / 4) * (H - 30);
  const tan: string[] = [];
  for (let x = 0; x <= Math.atan(4); x += 0.02) tan.push(`${sx(x).toFixed(1)},${sy(Math.tan(x)).toFixed(1)}`);
  const xa = 1.02;
  return (
    <svg className="p-plot" width={width} viewBox={`0 0 ${W} ${H}`} fill="none" aria-label="函数图像">
      <path d={`M${x0} ${y0}H${W - 6}M${x0} ${y0 + 6}V8`} stroke={ink} strokeWidth="1" />
      <path d={`M${W - 10} ${y0 - 3}L${W - 6} ${y0}L${W - 10} ${y0 + 3}M${x0 - 3} 12L${x0} 8L${x0 + 3} 12`} stroke={ink} />
      <line x1={sx(Math.PI / 2)} x2={sx(Math.PI / 2)} y1={10} y2={y0} stroke={ink} strokeDasharray="3 3" opacity=".55" />
      <polyline points={tan.join(" ")} stroke={ink} strokeWidth="1.4" />
      <line x1={sx(0)} y1={sy(0)} x2={sx(1.7)} y2={sy(1.7 * 1.6)} stroke={accent} strokeWidth="1.4" />
      <line x1={sx(xa)} x2={sx(xa)} y1={sy(Math.tan(xa))} y2={y0} stroke={ink} strokeDasharray="2 3" opacity=".7" />
      <circle cx={sx(xa)} cy={sy(Math.tan(xa))} r="2.6" fill={accent} />
      <g fill={ink} fontSize="10" fontStyle="italic" fontFamily="KaTeX_Main, serif">
        <text x={x0 - 12} y={y0 + 12}>O</text>
        <text x={W - 12} y={y0 + 13}>x</text>
        <text x={x0 + 5} y={14}>y</text>
        <text x={sx(xa) - 6} y={y0 + 13}>
          x<tspan fontSize="7" dy="2">a</tspan>
        </text>
        <text x={sx(Math.PI / 2) - 6} y={y0 + 13} fontStyle="normal">π/2</text>
        <text x={sx(1.2) + 6} y={sy(3.4)}>y=tan x</text>
        <text x={sx(1.48)} y={sy(2.05)} fill={accent}>y=ax</text>
      </g>
    </svg>
  );
}

/* ---------- 构建可分页的块 ---------- */
type Block = { key: string; kind: "head" | "notice" | "sec" | "q" | "space" | "answer"; qid?: string; node: ReactNode; breakBefore?: boolean; breakAfter?: boolean; pageSizedQuestion?: boolean; fillRemaining?: boolean };
export function answerCardSpace(q: Question, number: number): Exclude<Question["answerSpace"], "auto" | undefined> {
  return q.answerSpace && q.answerSpace !== "auto" ? q.answerSpace : number >= 17 && number <= 19 ? "full" : "half";
}

export function integratedSpacePlan(q: Question, layout: Layout, number: number): { space: NonNullable<Question["paperAnswerSpace"]>; height: number; fillRemaining: boolean } | undefined {
  if (layout.paperMode !== "integrated" || !isLongAnswer(q.type)) return;
  const { ph, m } = pageDims(layout);
  const available = Math.max(30, ph - 2 * m - (layout.pageNumber ? 12 : 0));
  const space = q.paperAnswerSpace ?? answerCardSpace(q, number);
  return { space, fillRemaining: space === "full", height: space === "full" ? 0 : space === "half" ? available * 0.5 : space === "quarter" ? available * 0.25 : Math.min(available * 0.5, Math.max(80, q.score * 8 * gapOf(layout))) };
}

function optionCols(q: Question, l: Layout) {
  if (l.optionCols !== "auto") return l.optionCols;
  const max = Math.max(...q.options.map((o) => plain(o).length), 0);
  const wide = l.orientation === "landscape" ? 1.5 : 1;
  return max <= 9 * wide ? 4 : max <= 20 * wide ? 2 : 1;
}

const Figure = memo(function Figure({ figure }: { figure: QuestionFigure }) {
  return <figure className="p-figure" data-figure-id={figure.id} style={{ margin: 0, textAlign: "center" }}>
    <img src={figure.src} alt={figure.caption || "题目配图"} style={{ display: "block", width: "100%", height: "auto", maxHeight: figure.maxHeight ?? 220, objectFit: "contain" }} />
    {figure.caption && <figcaption style={{ fontSize: "0.83em", paddingTop: 3 }}><MathText text={figure.caption} /></figcaption>}
  </figure>;
});

/** Paper owns numbering and score labels; keep pasted source prefixes in the editor, not twice in print. */
export function printedQuestionStem(q: Question): string {
  const number = String.raw`(?:(?:第\s*)?\d{1,3}\s*题\s*[.．、:：]?|\d{1,3}\s*[.．、](?!\d))`;
  const prefix = new RegExp(String.raw`^\s*(?:\*\*\s*${number}\s*\*\*|__\s*${number}\s*__|${number})\s*`);
  let stem = q.stem.replace(prefix, "");
  const score = stem.match(/^[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[)）]\s*/);
  if (score && Number(score[1]) === q.score) stem = stem.slice(score[0].length);
  return stem;
}

/** The quick-check grid is an index, not a second home for full worked solutions. */
export function quickAnswerSummary(q: Pick<Question, "answer">): string {
  const text = q.answer.join("；").trim();
  if (!text) return "待补充";
  // A mistakenly imported explanation, table or lengthy formula must not spill into adjacent cells.
  // Its complete, unchanged content remains in the numbered answer immediately below the grid.
  if (/[\r\n]/.test(text) || text.length > 70 || plain(text).length > 14 || /\\begin\s*\{/.test(text)) return "见下方";
  return text;
}

const QuestionContent = memo(function QuestionContent({ q, layout: l }: { q: Question; layout: Layout }) {
  const figures = questionFigures(q);
  const right = figures.filter(figure => figure.layout === "right");
  const below = figures.filter(figure => figure.layout !== "right");
  const drawings = [...extractTikzBlocks(q.stem), ...(q.drawing?.trim() ? [q.drawing] : [])];
  const hasRight = right.length > 0 || drawings.length > 0 || q.image === "plot";
  const width = Math.min(55, Math.max(15, right[0]?.width ?? l.figureWidth ?? 35));
  return <div className="p-q-content" style={{ display: "flow-root", minWidth: 0, overflowWrap: "anywhere" }}>
    {hasRight && <div className="p-figures-right" data-figure-layout="right" style={{ float: "right", width: `${width}%`, margin: `0 0 ${l.figureGap ?? 2}mm ${l.figureGap ?? 3}mm`, display: "flex", flexDirection: "column", alignItems: "center", gap: `${l.figureGap ?? 2}mm`, breakInside: "avoid" }}>
      {right.map(figure => <Figure key={figure.id} figure={figure} />)}
      {q.image === "plot" && <PlotSvg width={200} />}
      {drawings.map((code, index) => <TikzDrawing key={index} code={code} />)}
    </div>}
    {l.showScore && <span className="p-score">（{q.score} 分）</span>}
    <MathText text={stripTikzBlocks(printedQuestionStem(q)) || (hasRight ? "" : "（题干为空）")} />
    {hasOptions(q.type) && q.options.some(option => option.trim()) && <div className="p-opts" style={{ gridTemplateColumns: `repeat(${hasRight ? Math.min(2, optionCols(q, l)) : optionCols(q, l)}, minmax(0,1fr))` }}>{q.options.map((option, i) => <div className="p-opt" key={i}><b>{LETTERS[i]}.</b>{option.trim() ? <MathText text={option} /> : <span style={{ color: "#aaa" }}>（空）</span>}</div>)}</div>}
    {below.length > 0 && <div className="p-figures-below" style={{ display: "flex", clear: "both", flexWrap: "wrap", alignItems: "start", justifyContent: "center", gap: `${l.figureGap ?? 3}mm`, paddingTop: `${l.figureGap ?? 2}mm` }}>{below.map(figure => <div key={figure.id} data-figure-layout={figure.layout} style={{ flex: figure.layout === "full" ? "0 0 100%" : "0 0 calc(50% - 2mm)", maxWidth: `${figure.layout === "full" ? Math.min(100, figure.width ?? 100) : 48}%` }}><Figure figure={figure} /></div>)}</div>}
  </div>;
});

export function buildBlocks(exam: Exam, l: Layout, totalScore: number, qCount: number): Block[] {
  const blocks: Block[] = [];
  const gap = gapOf(l);
  blocks.push({
    key: "head",
    kind: "head",
    node: (
      <div className="p-block" style={{ paddingBottom: 14 * gap }}>
        <div className="p-title">{exam.title || "未命名试卷"}</div>
        {exam.subtitle && <div className="p-sub">{exam.subtitle}</div>}
        <div className="p-info">
          学校：<u />班级：<u />姓名：<u />考号：<u />
          <br />
          考试时间：{exam.duration} 分钟　　满分：{totalScore} 分　　共 {qCount} 题
        </div>
      </div>
    ),
  });
  if (exam.notice.length)
    blocks.push({
      key: "notice",
      kind: "notice",
      node: (
        <div className="p-block p-notice" style={{ paddingBottom: 12 * gap }}>
          <b>注意事项：</b>
          {exam.notice.map((n, i) => (
            <div key={i}>
              {i + 1}. {n}
            </div>
          ))}
        </div>
      ),
    });
  let num = 0;
  exam.sections.forEach((s, si) => {
    if (!s.questions.length) return;
    blocks.push({
      key: s.id,
      kind: "sec",
      breakBefore: s.pageBreakBefore,
      node: (
        <div className="p-block p-sec">
          <div className="p-sec-inner">
            <b>
              {CN_NUM[si] ?? si + 1}、{s.title}：
            </b>
            <span>{s.note || sectionNote(s.type, s.questions.map((q) => q.score))}</span>
          </div>
        </div>
      ),
    });
    s.questions.forEach((q) => {
      num += 1;
      const paperSpace = integratedSpacePlan(q, l, num);
      blocks.push({
        key: q.id,
        kind: "q",
        qid: q.id,
        breakBefore: q.pageBreakBefore,
        pageSizedQuestion: paperSpace?.fillRemaining,
        node: (
          <div className="p-block p-question-block">
            <div className="p-q" data-qid={q.id}>
              <span className="p-q-num">{num}.</span>
              <QuestionContent q={q} layout={l} />
            </div>
          </div>
        ),
      });
      if (paperSpace)
        blocks.push({
          key: q.id + "-space",
          kind: "space",
          qid: q.id,
          fillRemaining: paperSpace.fillRemaining,
          node: <div className="p-space" data-paper-answer-space={paperSpace.space} data-space-for={q.id} style={{ height: paperSpace.height }} />,
        });
    });
  });
  const numbered = exam.sections.flatMap((s) => s.questions).map((q, i) => ({ q, n: i + 1 }));
  if (l.answerMode !== "none" && numbered.some(({ q }) => q.answer.length || (l.answerMode !== "brief" && q.analysis.trim()))) {
    blocks.push({ key: "answer-title", kind: "head", breakBefore: true, node: <div className="p-block p-title">{l.answerMode === "brief" ? "参考答案" : "参考答案与解析"}</div> });
    const quick = l.quickAnswers === false ? [] : numbered.filter(({ q }) => hasOptions(q.type) || q.type === "blank");
    if (quick.length) {
      blocks.push({ key: "answer-quick-title", kind: "sec", node: <div className="p-block"><b>选择、填空速对</b></div> });
      // Short independent rows paginate without an enormous unbreakable table.
      for (let i = 0; i < quick.length; i += 4) {
        blocks.push({ key: `quick-${i}`, kind: "answer", node: <div className="p-quick-row" style={{ borderTop: i ? undefined : "1px solid #555", marginBottom: i + 4 >= quick.length ? 12 : 0 }}>{quick.slice(i, i + 4).map(({ q, n }) => <div key={q.id} className="p-quick-cell" data-quick-answer-for={q.id}><b className="p-quick-number">{n}</b><div className="p-quick-value"><MathText text={quickAnswerSummary(q)} /></div></div>)}</div> });
      }
    }
    for (const { q, n } of numbered) {
      if (!q.answer.length && !q.analysis.trim()) continue;
      if (l.answerMode === "brief" && !q.answer.length) continue;
      blocks.push({ key: `${q.id}-answer`, kind: "answer", node: <div className="p-block" style={{ overflowWrap: "anywhere" }}><b>第 {n} 题　</b><span>答案：</span><MathText text={q.answer.join("；") || "待补充"} />{l.answerMode !== "brief" && q.analysis.trim() && <div style={{ marginTop: 3 }}><b>解析：</b><MathText text={q.analysis} /></div>}</div> });
    }
  }
  return blocks;
}

/* ---------- 分页：先在隐藏容器里量高度，再贪心装页 ---------- */
export function usePages(blocks: Block[], contentW: number, avail: number, layout: Layout) {
  const ref = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PagePiece[][]>([]);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    let frame = 0;
    let resourcesReady = false;
    setReady(false);
    const compute = () => {
      if (!active) return;
      const children = Array.from(el.children) as HTMLElement[];
      const rects = children.map((c) => c.getBoundingClientRect());
      const hs = rects.map(rect => rect.height);
      if (children.length !== blocks.length || (blocks.length > 0 && hs.every((h) => !h))) return;
      const capacity = Math.max(30, avail);
      const out: PagePiece[][] = [];
      let cur: PagePiece[] = [];
      let used = 0;
      const flush = () => { if (cur.length) out.push(cur); cur = []; used = 0; };
      for (let i = 0; i < hs.length; i++) {
        const block = blocks[i];
        const height = hs[i];
        if (block.breakBefore) flush();
        const containsQuestion = () => cur.some(piece => blocks[piece.index].kind === "q" || blocks[piece.index].kind === "space");
        if ((block.pageSizedQuestion || (block.kind === "sec" && blocks[i + 1]?.pageSizedQuestion)) && containsQuestion()) flush();
        if (block.fillRemaining) {
          if (capacity - used < Math.min(80, capacity * 0.15) && cur.length) flush();
          const remaining = capacity - used;
          cur.push({ index: i, offset: 0, height: remaining, fullHeight: remaining, fillSpace: true });
          used += remaining;
          flush();
          continue;
        }
        // Keep a section heading with its first question, and optionally keep a question's space.
        let group = height;
        if (block.kind === "sec") group += Math.min(hs[i + 1] ?? 0, capacity * 0.35);
        if (layout.keepTogether && block.kind === "q" && blocks[i + 1]?.kind === "space") group += hs[i + 1];
        if (cur.length && group <= capacity && used + group > capacity) flush();
        if (cur.length && height <= capacity && used + height > capacity) flush();
        let offset = 0;
        let guards: SplitGuard[] | undefined;
        // Oversized content continues on another page instead of disappearing behind overflow:hidden.
        while (offset < height - 0.05) {
          let room = capacity - used;
          if (room < 20 && cur.length) { flush(); room = capacity; }
          let part = Math.min(height - offset, room);
          if (offset + part < height - 0.05 && block.kind !== "space") {
            // Move a boundary above any text line it intersects. This avoids bisecting glyphs.
            if (!guards) {
              guards = [];
              const origin = rects[i].top;
              const add = (rect: DOMRect, eligible: boolean) => { if (eligible) guards!.push({ top: rect.top - origin, bottom: rect.bottom - origin }); };
              // Preserve the original table → text → image ordering, but read DOM geometry only once.
              for (const item of children[i].querySelectorAll("table.math-table, table.math-table tr")) {
                const rect = item.getBoundingClientRect(); add(rect, rect.height <= capacity);
              }
              const walker = document.createTreeWalker(children[i], NodeFilter.SHOW_TEXT);
              const range = document.createRange();
              let next: Node | null;
              while ((next = walker.nextNode())) {
                if (!next.textContent?.trim()) continue;
                range.selectNodeContents(next);
                for (const rect of range.getClientRects()) add(rect, rect.height > 0);
              }
              range.detach();
              for (const image of children[i].querySelectorAll("img,svg")) {
                const rect = image.getBoundingClientRect(); add(rect, rect.height <= capacity);
              }
            }
            const cut = safePageCut(offset, offset + part, guards);
            if (cut > offset + 1) part = cut - offset;
          }
          if (part < 0.05) { flush(); continue; }
          cur.push({ index: i, offset, height: part, fullHeight: height });
          used += part;
          offset += part;
          if (offset < height - 0.05) flush();
        }
        if (block.breakAfter) flush();
      }
      flush();
      const nextPages = out.length ? out : [[]];
      setPages((p) => samePages(p, nextPages) ? p : nextPages);
      setReady(resourcesReady && !el.querySelector('[data-drawing-status="pending"]'));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(compute); };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mutations = new MutationObserver(schedule);
    mutations.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-drawing-status", "src"] });
    const images = Array.from(el.querySelectorAll("img"));
    Promise.all([document.fonts?.ready, ...images.map((image) => image.decode().catch(() => undefined))]).then(() => {
      if (!active) return;
      resourcesReady = true;
      schedule();
    });
    // Coalesce the initial observer/font/image-ready notifications into one pre-paint measurement.
    schedule();
    return () => { active = false; cancelAnimationFrame(frame); ro.disconnect(); mutations.disconnect(); };
  }, [blocks, contentW, avail, layout]);

  // Portal measurement outside hidden print-root; display:none ancestors would measure zero.
  const measurer = useMemo(() => createPortal(
    <div
      ref={ref}
      aria-hidden
      className={cx("paper", layout.style)}
      style={{ position: "fixed", left: -99999, top: 0, width: contentW, visibility: "hidden", pointerEvents: "none", ...paperVars(layout) }}
    >
      {blocks.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}
    </div>, document.body,
  ), [blocks, contentW, layout]);
  return { pages, measurer, ready };
}

const PageContent = memo(function PageContent({ pieces, blocks }: { pieces: PagePiece[]; blocks: Block[] }) {
  return <>{pieces.filter((p) => blocks[p.index]).map((p) => {
    const block = blocks[p.index];
    if (p.fillSpace) return <div key={`${block.key}-fill`} className="p-space" data-paper-answer-space="full" data-space-for={block.qid} style={{ height: p.height }} />;
    if (p.offset === 0 && Math.abs(p.height - p.fullHeight) < 0.1) return <Fragment key={`${block.key}-0`}>{block.node}</Fragment>;
    return <div key={`${block.key}-${p.offset}`} data-continuation={p.offset > 0 ? "true" : undefined} style={{ height: p.height, overflow: "hidden", position: "relative" }}><div style={{ position: "relative", top: -p.offset }}>{block.node}</div></div>;
  })}</>;
});

/* ---------- 单页 ---------- */
export const PageSheet = memo(function PageSheet({
  layout,
  children,
  index,
  total,
  interactive,
  activeId,
  onPick,
  print,
}: {
  layout: Layout;
  children: ReactNode;
  index: number;
  total: number;
  interactive?: boolean;
  activeId?: string | null;
  onPick?: (id: string) => void;
  print?: boolean;
}) {
  const { pw, ph, m } = pageDims(layout);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sheet = ref.current;
    if (!sheet || !interactive) return;
    sheet.querySelectorAll<HTMLElement>('.p-q[data-active="true"]').forEach(el => {
      if (el.dataset.qid !== activeId) el.removeAttribute("data-active");
    });
    if (activeId) {
      const selected = sheet.querySelector<HTMLElement>(`.p-q[data-qid="${CSS.escape(activeId)}"]`);
      if (selected && selected.dataset.active !== "true") selected.dataset.active = "true";
    }
  }, [activeId, children, interactive]);
  return (
    <div
      ref={ref}
      data-sheet=""
      className={cx("paper relative overflow-hidden", layout.style, interactive && "interactive", print && "print-page")}
      style={{ width: pw, height: ph, padding: m, ...paperVars(layout) }}
      onClick={(e) => {
        const q = (e.target as HTMLElement).closest<HTMLElement>(".p-q");
        if (q?.dataset.qid) onPick?.(q.dataset.qid);
      }}
    >
      {children}
      {layout.pageNumber && (
        <div
          className="absolute inset-x-0 text-center font-sans text-[11px] text-[#888]"
          style={{ bottom: Math.max(10, m * 0.4) }}
        >
          第 {index + 1} 页（共 {total} 页）
        </div>
      )}
    </div>
  );
});

export const PaperPages = memo(function PaperPages(props: {
  exam: Exam;
  layout: Layout;
  totalScore: number;
  qCount: number;
  render: (page: ReactNode, i: number, total: number) => ReactNode;
  interactive?: boolean;
  activeId?: string | null;
  onPick?: (id: string) => void;
  print?: boolean;
}) {
  const { exam, layout, totalScore, qCount } = props;
  const { pw, ph, m } = pageDims(layout);
  const blocks = useMemo(() => buildBlocks(exam, layout, totalScore, qCount), [exam, layout, totalScore, qCount]);
  const { pages, measurer, ready } = usePages(blocks, pw - 2 * m, ph - 2 * m - (layout.pageNumber ? 12 : 0), layout);
  const sheets = useMemo(() => pages.map((pg, i) => <PageSheet
    key={i} layout={layout} index={i} total={pages.length} interactive={props.interactive}
    activeId={props.activeId} onPick={props.onPick} print={props.print}
  ><PageContent pieces={pg} blocks={blocks} /></PageSheet>), [pages, blocks, layout, props.interactive, props.activeId, props.onPick, props.print]);
  return (
    <>
      {measurer}
      <div data-pagination-ready={ready ? "true" : "false"} style={{ display: "contents" }}>
      {sheets.map((sheet, i) => (
        <Fragment key={i}>
          {props.render(
            sheet,
            i,
            pages.length,
          )}
        </Fragment>
      ))}
      </div>
    </>
  );
});

/* ---------- 答题卡 ---------- */
export const AnswerCard = memo(function AnswerCard({ exam, layout, print, render }: { exam: Exam; layout: Layout; print?: boolean; render?: (page: ReactNode, i: number, total: number) => ReactNode }) {
  const { pw, ph, m } = pageDims(layout);
  const avail = ph - 2 * m - (layout.pageNumber ? 12 : 0);
  const blocks = useMemo<Block[]>(() => {
    const result: Block[] = [{ key: "card-head", kind: "head", node: <div style={{ paddingBottom: 16 }}><div className="p-title" style={{ fontSize: "calc(var(--fs) * 1.35)" }}>{exam.title} · 答题卡</div><div className="card-box" style={{ display: "flex", justifyContent: "space-between", marginTop: 16, padding: "10px 12px", fontSize: "0.9em" }}><span>姓名：____________　班级：____________</span><span>考号：________________</span></div></div> }];
    const numbered = exam.sections.flatMap((s) => s.questions).map((q, i) => ({ q, n: i + 1 }));
    const choices = numbered.filter(({ q }) => hasOptions(q.type));
    if (choices.length) {
      result.push({ key: "card-choice-title", kind: "sec", node: <div style={{ padding: "4px 0 8px" }}><b>选择题</b><small>（用 2B 铅笔填涂）</small></div> });
      for (let i = 0; i < choices.length; i += 3) {
        result.push({ key: `card-choice-${i}`, kind: "answer", node: <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, paddingBottom: 10, fontFamily: "var(--font-sans)", fontSize: "0.9em" }}>{choices.slice(i, i + 3).map(({ q, n }) => <div key={q.id} style={{ display: "flex", alignItems: "center" }}><span style={{ width: 25 }}>{n}.</span>{Array.from({ length: Math.max(2, q.options.length || 4) }, (_, j) => <span key={j} className="bubble">{String.fromCharCode(65 + j)}</span>)}</div>)}</div> });
      }
    }
    const blanks = numbered.filter(({ q }) => q.type === "blank");
    if (blanks.length) {
      result.push({ key: "card-blank-title", kind: "sec", node: <div style={{ padding: "12px 0 4px" }}><b>填空题</b></div> });
      for (let i = 0; i < blanks.length; i += 2) result.push({ key: `card-blank-${i}`, kind: "answer", node: <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 20, paddingBottom: 12 }}>{blanks.slice(i, i + 2).map(({ q, n }) => <div key={q.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 35 }}><span>{n}.</span><span style={{ flex: 1, borderBottom: "1px solid #333", marginBottom: 4 }} /></div>)}</div> });
    }
    for (const { q, n } of numbered.filter(({ q }) => isLongAnswer(q.type))) {
      const space = answerCardSpace(q, n);
      const full = space === "full";
      const height = full ? avail : avail * (space === "quarter" ? 0.25 : 0.5);
      result.push({ key: `card-essay-${q.id}`, kind: "answer", qid: q.id, breakBefore: full, breakAfter: full, node: <div data-answer-number={n} data-answer-space={space} style={{ height, paddingBottom: full ? 0 : 12, boxSizing: "border-box" }}><div style={{ height: "100%", border: "1px solid #333", padding: "12px 14px", boxSizing: "border-box" }}><div style={{ display: "flex", justifyContent: "space-between", borderBottom: full ? "1px solid #aaa" : undefined, paddingBottom: full ? 8 : 0 }}><b>第 {n} 题（{q.score} 分）</b>{full && <span style={{ fontSize: "0.8em" }}>姓名：____________</span>}</div></div></div> });
    }
    return result;
  }, [exam, avail]);
  const { pages, measurer, ready } = usePages(blocks, pw - 2 * m, avail, layout);
  const sheets = useMemo(() => pages.map((pieces, i) => <PageSheet key={i} layout={layout} index={i} total={pages.length} print={print}><PageContent pieces={pieces} blocks={blocks} /></PageSheet>), [pages, blocks, layout, print]);
  return <>{measurer}<div data-pagination-ready={ready ? "true" : "false"} data-answer-card="" style={{ display: "contents" }}>{sheets.map((page, i) => {
    return <Fragment key={i}>{render ? render(page, i, pages.length) : page}</Fragment>;
  })}</div></>;
});
