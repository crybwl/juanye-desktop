import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "../ui";
import "./workspace-tools.css";

/** Shared, theme-native chrome; domain-specific controls stay in their feature. */
export function DialogHeader({ title, subtitle, badge, actions, onClose, closeLabel }: { title: string; /** 保留旧调用的兼容参数；v0.6 规范的弹窗标题不再显示装饰图标。 */ icon?: ReactNode; subtitle?: string; badge?: ReactNode; actions?: ReactNode; onClose: () => void; closeLabel?: string }) {
  return <header className="dialog-header flex shrink-0 items-center gap-3 border-b border-line">
    <div className="min-w-0"><h2 className="dialog-title flex items-center gap-2">{title}{badge}</h2>{subtitle && <p className="dialog-subtitle truncate">{subtitle}</p>}</div>
    <div className="ml-auto flex items-center gap-1">{actions}<IconButton label={closeLabel??`关闭${title}`} onClick={onClose}><X size={16} /></IconButton></div>
  </header>;
}
