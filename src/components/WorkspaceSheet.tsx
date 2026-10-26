import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useIsPresent } from "motion/react";
import { X } from "lucide-react";
import { cx, softSpring } from "../ui";

export function WorkspaceSheet({ title, children, onClose, width = 400, modal = true, className }: { title: string; children: ReactNode; onClose: () => void; width?: number; modal?: boolean; className?: string }) {
  const present = useIsPresent();
  const heading = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!present) return;
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[data-select-menu]')) { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      if (!modal || event.key !== "Tab") return;
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']") ?? []).filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("keydown", key, true); prior?.isConnected && prior.focus(); };
  }, [modal, present]);
  return createPortal(<>
    {modal && <motion.div className="fixed inset-0 z-[54] bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: .15 } }} style={{ pointerEvents: present ? "auto" : "none" }} onClick={onClose} />}
    <motion.aside ref={ref} tabIndex={-1} role="dialog" aria-hidden={!present || undefined} aria-modal={modal && present || undefined} aria-labelledby={heading} initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18, transition: { duration: .18 } }} transition={softSpring} className={cx("glass fixed bottom-3 right-3 top-[64px] z-[55] flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-line-strong outline-none shadow-2xl", className)} style={{ width, pointerEvents: present ? "auto" : "none" }}>
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 id={heading} className="text-[14px] font-semibold">{title}</h2>
        <button aria-label={`关闭${title}`} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06]" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </motion.aside>
  </>, document.body);
}
