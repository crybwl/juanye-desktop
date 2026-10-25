import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { Kbd, Modal, cx, spring } from "../ui";

export type Command = { id: string; title: string; hint?: string; icon: ReactNode; group: string; kbd?: string; run: () => void };

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);
  const items = useMemo(() => {
    const k = q.trim().toLowerCase();
    return commands.filter((c) => !k || (c.title + (c.hint ?? "")).toLowerCase().includes(k)).slice(0, 40);
  }, [q, commands]);
  useEffect(() => setIdx(0), [q]);
  const [hl, setHl] = useState<{ y: number; h: number } | null>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    setHl(el ? { y: el.offsetTop, h: el.offsetHeight } : null);
  }, [idx, items, open]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    setTimeout(c.run, 120);
  };
  let lastGroup = "";
  return (
    <Modal open={open} onClose={onClose} align="top" className="w-[620px]">
      <div className="flex h-14 items-center gap-3 border-b border-line px-4">
        <Search size={17} className="text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(items.length - 1, i + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
            if (e.key === "Enter") run(items[idx]);
          }}
          placeholder="搜索题目、执行命令…"
          className="h-full flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={list} className="relative max-h-[400px] overflow-y-auto p-2">
        {hl && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-2 right-2 top-0 rounded-[10px] bg-white/[0.07] ring-1 ring-inset ring-white/[0.06]"
            initial={false}
            animate={{ y: hl.y, height: hl.h }}
            transition={spring}
          />
        )}
        {items.length === 0 && <div className="py-10 text-center text-[13px] text-faint">没有找到“{q}”相关的内容</div>}
        {items.map((c, i) => {
          const header = c.group !== lastGroup;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className="px-3 pb-1.5 pt-3 text-[11.5px] font-medium text-faint first:pt-1">{c.group}</div>}
              <motion.button
                data-i={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.015 }}
                onMouseMove={() => setIdx(i)}
                onClick={() => run(c)}
                className={cx("relative flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left", i === idx ? "text-fg" : "text-fg/80")}
              >
                                <span className={cx("relative grid h-7 w-7 place-items-center rounded-lg transition-colors", i === idx ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-muted")}>
                  {c.icon}
                </span>
                <span className="relative min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
                {c.hint && <span className="relative max-w-[200px] truncate text-[12px] text-faint">{c.hint}</span>}
                {c.kbd && (
                  <span className="relative">
                    <Kbd>{c.kbd}</Kbd>
                  </span>
                )}
                <span className={cx("relative text-faint transition-all duration-200", i === idx ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0")}>
                  <CornerDownLeft size={14} />
                </span>
              </motion.button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> 选择
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> 执行
        </span>
      </div>
    </Modal>
  );
}
