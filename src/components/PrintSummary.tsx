import type { Layout } from "../types";
import { PAPER_MM } from "../data";

/** The miniature is document content: white paper stays white in every theme. */
export function PrintSummary({ layout }: { layout: Layout }) {
  const base = PAPER_MM[layout.paper];
  const [w, h] = layout.orientation === "portrait" ? base : [base[1], base[0]];
  const columns = layout.columns ?? 1;
  return <div className="print-summary rounded-xl border border-line p-3" data-testid="print-summary">
    <div className="print-summary-paper" style={{ aspectRatio: `${w}/${h}`, width: layout.orientation === "landscape" ? 140 : 100 }} aria-label={`${layout.paper} ${columns}栏${layout.sealLine ? ' 带密封线' : ''}`}>
      {layout.sealLine && <div className="print-summary-seal" style={{ width: `${(layout.sealWidth ?? 18) / w * 100}%` }}><span>密封线</span></div>}
      <div className="print-summary-content" style={{ marginLeft: layout.sealLine ? `${(layout.sealWidth ?? 18) / w * 100}%` : undefined }}><div className="print-summary-title" /><div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: `${(layout.columnGap ?? 8) / w * 100}%` }}>{Array.from({ length: columns }, (_, col) => <div key={col}>{[95, 85, 91, 63, 97, 83, 92, 75].map((width, i) => <i key={i} style={{ width: `${width}%` }} />)}</div>)}</div></div>
    </div>
    <p className="mt-3 text-center text-[12px] text-muted">{layout.paper} · {layout.orientation === "portrait" ? "纵向" : "横向"} · {columns} 栏{layout.sealLine ? " · 密封线" : ""}</p>
  </div>;
}
