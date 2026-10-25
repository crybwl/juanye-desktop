import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { History, RotateCcw, X } from "lucide-react";
import { softSpring } from "../ui";
import type { Snapshot } from "../storage";

export function HistorySheet({ open, onClose, items, onRestore }: { open: boolean; onClose: () => void; items: Snapshot[]; onRestore: (snapshot: Snapshot) => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[55] bg-[#05060a]/35" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0, transition: { duration: 0.18 } }}
            transition={softSpring}
            className="glass fixed bottom-3 right-3 top-[60px] z-[56] flex w-[360px] flex-col rounded-2xl border border-line-strong shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]"
          >
            <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
              <History size={16} className="text-accent" />
              <span className="text-[14px] font-semibold">历史记录</span>
              <button onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-white/[0.06] hover:text-fg" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!items.length && <div className="py-8 text-center text-muted">暂无历史记录</div>}
              {items.map((it, i) => (
                <motion.div
                  key={it.id}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...softSpring, delay: 0.05 + i * 0.05 }}
                  className="group relative flex gap-4 pb-5"
                >
                  <div className="relative flex flex-col items-center">
                    <span className={i === 0 ? "mt-1.5 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]" : "mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white/25"} />
                    {i < items.length - 1 && <span className="mt-1 w-px flex-1 bg-line-strong" />}
                  </div>
                  <div className="min-w-0 flex-1 rounded-xl px-3 py-2 transition-colors group-hover:bg-white/[0.04]">
                    <div className="text-[11.5px] text-faint">
                      {new Date(it.at).toLocaleString("zh-CN", { hour12: false })} · {i === 0 ? "最近保存" : "自动快照"}
                    </div>
                    <div className="mt-0.5 text-[13px]">{it.label}</div>
                  </div>
                  {(
                    <button
                      onClick={() => onRestore(it)}
                      className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-[11.5px] text-fg opacity-60 transition-opacity hover:opacity-100 focus:opacity-100"
                    >
                      <RotateCcw size={12} /> 恢复
                    </button>
                  )}
                </motion.div>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
