import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../ui";

/** Shared, theme-native chrome; domain-specific controls stay in their feature. */
export function DialogHeader({ title, icon, subtitle, actions, onClose }: { title: string; icon?: ReactNode; subtitle?: string; actions?: ReactNode; onClose: () => void }) {
  return <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
    {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</span>}
    <div className="min-w-0"><h2 className="text-[15px] font-semibold">{title}</h2>{subtitle && <p className="mt-0.5 truncate text-[12px] text-muted">{subtitle}</p>}</div>
    <div className="ml-auto flex items-center gap-2">{actions}<IconButton label={`关闭${title}`} onClick={onClose}><X size={17} /></IconButton></div>
  </header>;
}
