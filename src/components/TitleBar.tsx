import { AnimatePresence, motion } from "motion/react";
import { Loader2, Search, Settings } from "lucide-react";
import { memo, type ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
import { IconButton, Kbd, SharedPill, cx, softSpring } from "../ui";

export const Logo = BrandLogo;
export type WorkArea = "exam" | "bank" | "workbook";

export function SaveBadge({ saving, error }: { saving: boolean; error?: string }) {
  if (error) return <span role="alert" title={error} className="max-w-[160px] truncate text-[12px] text-danger">未保存 · {error}</span>;
  return (
    <div className="save-badge flex h-6 items-center text-[12px] text-faint">
      <AnimatePresence mode="wait" initial={false}>
        {saving ? (
          <motion.span key="s" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            <span className="save-badge-label">保存中</span>
          </motion.span>
        ) : (
          <motion.span key="d" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-ok">
              <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" />
              <motion.path d="M7.8 12.4l2.9 2.9 5.5-5.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: "easeOut" }} />
            </svg>
            <span className="save-badge-label">已保存</span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

const TABS: { id: WorkArea; label: string; name: string }[] = [
  { id: "exam", label: "组卷", name: "组卷" },
  { id: "bank", label: "题库", name: "本地题库" },
  { id: "workbook", label: "教辅", name: "教辅" },
];

/** 工作区标签：独立 memo，打字等无关更新不会让滑动下划线重新测量。 */
const WorkspaceTabs = memo(function WorkspaceTabs({ workspace, onWorkspace }: { workspace: WorkArea; onWorkspace: (workspace: WorkArea) => void }) {
  return (
    <nav aria-label="工作区" className="workspace-tabs flex h-full items-stretch">
      {TABS.map(tab => {
        const on = workspace === tab.id;
        return <button key={tab.id} type="button" aria-label={tab.name} aria-current={on ? "page" : undefined} onClick={() => onWorkspace(tab.id)}
          className={cx("workspace-nav-tab relative inline-flex items-center px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50", on ? "text-fg" : "text-muted hover:text-fg")}>
          {on && <SharedPill layoutId="workspace-nav-pill" className="workspace-nav-pill" aria-hidden="true" transition={softSpring} />}
          {tab.label}
        </button>;
      })}
    </nav>
  );
});

const WINDOW_BUTTONS = [
  { k: "min", label: "最小化", d: "M4 8h8" },
  { k: "max", label: "最大化", d: "M4.5 4.5h7v7h-7z" },
  { k: "close", label: "关闭窗口", d: "M4.5 4.5l7 7M11.5 4.5l-7 7" },
] as const;

const HeaderTrail = memo(function HeaderTrail({ onPalette, onSettings }: { onPalette: () => void; onSettings: () => void }) {
  return (
    <div data-tauri-drag-region className="app-header-trail flex h-full shrink-0 items-center gap-1 pl-2">
      <button type="button" onClick={onPalette} aria-label="搜索题目或命令" className="titlebar-search flex h-8 items-center gap-2 rounded-[6px] px-2 text-[12px] text-faint outline-none transition-colors hover:text-muted focus-visible:ring-2 focus-visible:ring-accent/50">
        <Search size={15} />
        <span className="titlebar-search-label">搜索</span>
        <span className="titlebar-search-keys flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
      </button>
      <IconButton label="设置" kbd="Ctrl ," onClick={onSettings}>
        <Settings size={16} />
      </IconButton>
      {/* Windows 风格窗口按钮；macOS 可改用原生红绿灯 */}
      <div className="app-window-controls ml-1 flex h-full">
        {WINDOW_BUTTONS.map(b => (
          <button key={b.k} aria-label={b.k} title={b.label} onClick={() => window.juanye?.windowControl(b.k)}
            className={cx("grid h-full w-[46px] place-items-center text-muted transition-colors", b.k === "close" ? "hover:bg-[#e5484d] hover:text-white" : "hover:bg-[var(--surface-hover)] hover:text-fg")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1"><path d={b.d} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
});

/**
 * 无边框窗口的唯一一行顶栏：品牌、工作区切换、当前工作区工具、全局搜索/设置、窗口按钮。
 * 当前工作区工具由调用方传入 children（放在 role="toolbar" 内），题库页不会出现试卷导出等无关操作。
 */
export function TitleBar({ workspace, onWorkspace, onPalette, onSettings, children }: {
  workspace: WorkArea;
  onWorkspace: (workspace: WorkArea) => void;
  onPalette: () => void;
  onSettings: () => void;
  children?: ReactNode;
}) {
  return (
    <header data-tauri-drag-region className="app-header relative z-30 flex h-12 shrink-0 items-stretch pl-3">
      <div data-tauri-drag-region className="app-brand flex shrink-0 items-center gap-2 pr-3">
        <Logo animated />
        <span className="app-brand-name text-[14px] font-semibold">卷页</span>
      </div>
      <WorkspaceTabs workspace={workspace} onWorkspace={onWorkspace} />
      <div data-tauri-drag-region role="toolbar" aria-label="当前工作区工具" className="workspace-nav relative flex min-w-0 flex-1 items-center pl-2">
        {children}
      </div>
      <HeaderTrail onPalette={onPalette} onSettings={onSettings} />
    </header>
  );
}
