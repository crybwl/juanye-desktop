import { motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasGeometry } from "./Canvas";
import { visibleBlocks } from "./Canvas";
import type { Edition, HeadingBlock, Workbook } from "./model";
import { richToPlain } from "./rich";

const PILL_SPRING = { type: "spring", stiffness: 500, damping: 38 } as const;

/**
 * 章节目录：列出章 / 节 / 栏目标题与所在页码，随滚动高亮当前位置，点击平滑定位。
 * 位置来自画布的分页结果（目标位置），不做逐帧 DOM 测量。
 */
export const Outline = memo(function Outline({ book, edition, geometry, zoom, scroller, contentTop, selectedId, onJump }: {
  book: Workbook;
  edition: Edition;
  geometry: CanvasGeometry | null;
  zoom: number;
  scroller: React.RefObject<HTMLDivElement>;
  /** .wb-content 在滚动容器内的顶部偏移。 */
  contentTop: () => number;
  selectedId?: string;
  onJump: (blockId: string) => void;
}) {
  const headings = useMemo(() => visibleBlocks(book.blocks, edition).filter((b): b is HeadingBlock => b.kind === "heading"), [book.blocks, edition]);
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !geometry) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = element.scrollTop + 96;
      let active: string | null = headings[0]?.id ?? null;
      for (const heading of headings) {
        const rect = geometry.rect(heading.id);
        if (rect && contentTop() + rect.y * zoom <= line) active = heading.id;
      }
      // 滚到底部时最后一个标题即当前位置。
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4 && headings.length) {
        const last = headings[headings.length - 1];
        const rect = geometry.rect(last.id);
        if (rect && contentTop() + rect.y * zoom < element.scrollTop + element.clientHeight) active = last.id;
      }
      setCurrent(active);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    element.addEventListener("scroll", schedule, { passive: true });
    return () => { element.removeEventListener("scroll", schedule); cancelAnimationFrame(frame); };
  }, [scroller, geometry, headings, zoom, contentTop]);

  useEffect(() => {
    if (current) list.current?.querySelector<HTMLElement>(`[data-outline-id="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return <div className="wb-outline-inner">
    <div className="wb-outline-title">目录</div>
    <div ref={list} className="wb-outline-list" role="navigation" aria-label="章节目录">
      {headings.length === 0 && <p className="wb-outline-empty">插入章、节标题后会在这里列出，点击即可定位。</p>}
      {headings.map(heading => {
        const label = richToPlain(heading.text).trim() || (heading.level === 1 ? "未命名章" : heading.level === 2 ? "未命名节" : "未命名栏目");
        const page = geometry?.placements.get(heading.id)?.page;
        const active = current === heading.id;
        return <button key={heading.id} type="button" data-outline-id={heading.id} data-level={heading.level} data-active={active || undefined}
          data-selected={selectedId === heading.id || undefined} className="wb-outline-item" onClick={() => onJump(heading.id)} title={label}>
          {active && <motion.span layoutId="wb-outline-pill" className="wb-outline-pill" transition={PILL_SPRING} />}
          <span className="wb-outline-label">{label}</span>
          {page !== undefined && <span className="wb-outline-page">{page + 1}</span>}
        </button>;
      })}
    </div>
  </div>;
});
