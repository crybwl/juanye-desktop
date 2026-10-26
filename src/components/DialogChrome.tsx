import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../ui";
import "./workspace-tools.css";

/** Shared, theme-native chrome; domain-specific controls stay in their feature. */
export function DialogHeader({ title, icon, subtitle, actions, onClose, closeLabel }: { title: string; icon?: ReactNode; subtitle?: string; actions?: ReactNode; onClose: () => void; closeLabel?: string }) {
  return <header className="dialog-header flex shrink-0 items-center gap-3 border-b border-line px-6 py-5">
    {icon && <span className="dialog-header-icon">{icon}</span>}
    <div className="min-w-0"><h2 className="text-[15px] font-semibold tracking-[-.02em]">{title}</h2>{subtitle && <p className="mt-1 truncate text-[12px] leading-relaxed text-muted">{subtitle}</p>}</div>
    <div className="ml-auto flex items-center gap-2">{actions}<IconButton label={closeLabel??`关闭${title}`} onClick={onClose}><X size={17} /></IconButton></div>
  </header>;
}
