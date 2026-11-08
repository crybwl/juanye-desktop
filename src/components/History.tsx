import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { IconButton, softSpring } from "../ui";
import type { Snapshot } from "../storage";

const DAY = 86_400_000;
const clock = (at: number) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
function dayLabel(at: number): string {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= today) return "今天";
  if (at >= today - DAY) return "昨天";
  return new Date(at).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
}
function relative(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < DAY / 1000) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / (DAY / 1000))} 天前`;
}

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
            className="glass ui-sheet fixed bottom-2 right-2 top-[56px] z-[56] flex w-[360px] flex-col rounded-[8px]"
          >
            <div className="ui-sheet-header flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
              <span className="text-[14px] font-semibold">历史记录</span>
              <span className="text-[12px] text-faint">{items.length ? `${items.length} 个版本` : ""}</span>
              <div className="ml-auto"><IconButton label="关闭" onClick={onClose}><X size={16} /></IconButton></div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {!items.length && <div className="py-10 text-center text-[13px] text-faint">暂无历史记录</div>}
              {items.map((it, i) => {
                const day = dayLabel(it.at);
                const showDay = i === 0 || dayLabel(items[i - 1].at) !== day;
                return (
                  <div key={it.id}>
                    {showDay && <div className="history-day">{day}</div>}
                    <motion.div
                      initial={{ opacity: 0, x: 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...softSpring, delay: 0.05 + Math.min(i, 8) * 0.04 }}
                      className="history-row group"
                      data-current={i === 0 || undefined}
                    >
                      <span className="history-dot" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <time className="history-time" dateTime={new Date(it.at).toISOString()} title={new Date(it.at).toLocaleString("zh-CN", { hour12: false })}>{clock(it.at)}</time>
                          <span className="text-[12px] text-faint">{i === 0 ? "最近保存" : relative(it.at)}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[13px]">{it.label}</div>
                      </div>
                      <button onClick={() => onRestore(it)} className="history-restore">
                        <RotateCcw size={12} /> 恢复
                      </button>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
