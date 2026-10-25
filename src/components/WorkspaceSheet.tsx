import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "../ui";

export function WorkspaceSheet({ title, children, onClose, width = 400, modal = true }: { title: string; children: ReactNode; onClose: () => void; width?: number; modal?: boolean }) {
  const heading = useId();
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
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
  }, [modal]);
  return createPortal(<>
    {modal && <div className="fixed inset-0 z-[54] bg-black/30" onClick={onClose} />}
    <aside ref={ref} tabIndex={-1} role="dialog" aria-modal={modal || undefined} aria-labelledby={heading} className={cx("glass fixed bottom-3 right-3 top-[64px] z-[55] flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-line-strong outline-none shadow-2xl")} style={{ width }}>
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 id={heading} className="text-[14px] font-semibold">{title}</h2>
        <button aria-label={`关闭${title}`} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/[0.06]" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  </>, document.body);
}
