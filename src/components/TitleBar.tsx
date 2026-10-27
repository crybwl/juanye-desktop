import { AnimatePresence, motion } from "motion/react";
import { BookOpen, ChevronDown, Eye, FileDown, History, Loader2, PenLine, Search, Settings } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import type { Mode } from "../types";
import { Button, IconButton, Kbd, Segmented } from "../ui";

export const Logo = BrandLogo;

function SaveBadge({ saving, error }: { saving: boolean; error?: string }) {
  if (error) return <span role="alert" title={error} className="max-w-[160px] truncate text-[12px] text-danger">未保存 · {error}</span>;
  return (
    <div className="flex h-6 items-center text-[12px] text-faint">
      <AnimatePresence mode="wait" initial={false}>
        {saving ? (
          <motion.span key="s" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            保存中
          </motion.span>
        ) : (
          <motion.span key="d" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="text-ok">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" />
              <motion.path
                d="M7.5 12.5l3 3 6-6.5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
            </svg>
            已保存
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 无边框窗口标题栏：Tauri 用 data-tauri-drag-region，Electron 用 -webkit-app-region: drag */
export function TitleBar({
  title,
  mode,
  setMode,
  saving,
  saveError,
  onPalette,
  onHistory,
  onSettings,
  onExport,
  onExportMore,
  workspace = "exam",
}: {
  title: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  saving: boolean;
  saveError?: string;
  onPalette: () => void;
  onHistory: () => void;
  onSettings: () => void;
  onExport: () => void;
  onExportMore?: () => void;
  workspace?: "exam" | "bank";
}) {
  return (
    <header data-tauri-drag-region className="relative z-30 flex h-[52px] shrink-0 items-center border-b border-line pl-4">
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
        <Logo animated />
        <span className="text-[14px] font-semibold tracking-wide">卷页</span>
        <span className="text-[13px] text-white/15">/</span>
        <button onClick={onPalette} aria-label="项目与功能" className="flex min-w-0 max-w-[200px] max-[1320px]:max-w-[110px] items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-muted transition-colors hover:bg-white/[0.05] hover:text-fg">
          <span className="truncate">{title}</span>
          <ChevronDown size={13} className="shrink-0 opacity-60" />
        </button>
        <SaveBadge saving={saving} error={saveError} />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2">
        <AnimatePresence mode="wait" initial={false}>
          {workspace === "bank" ? <motion.span key="bank" initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.2 }} className="titlebar-bank-label inline-flex items-center gap-2 text-[13px] font-semibold text-muted max-[1180px]:hidden"><BookOpen size={15} />本地题库</motion.span> : <motion.div key="exam" initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.2 }}><Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "edit", label: "编辑", icon: <PenLine size={14} /> },
              { value: "preview", label: "排版预览", icon: <Eye size={14} /> },
            ]}
          /></motion.div>}
        </AnimatePresence>
      </div>

      <div data-tauri-drag-region className="ml-auto flex h-full items-center gap-1 pl-4">
        <button
          onClick={onPalette}
          className="flex h-8 items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 text-[12.5px] text-faint ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:text-muted"
        >
          <Search size={14} />
          <span className="max-[1320px]:hidden">搜索题目或命令</span>
          <span className="ml-3 flex gap-0.5 max-[1320px]:ml-0">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <IconButton label="历史记录" onClick={onHistory}>
          <History size={16} />
        </IconButton>
        <IconButton label="设置" kbd="Ctrl ," onClick={onSettings}>
          <Settings size={16} />
        </IconButton>
        <Button variant="primary" size="sm" icon={<FileDown size={14} />} onClick={onExport} className="ml-1.5">
          导出 PDF
        </Button>
        {onExportMore && <IconButton label="导出中心" className="mr-2" onClick={onExportMore}><ChevronDown size={15} /></IconButton>}
        {/* Windows 风格窗口按钮；macOS 可改用原生红绿灯 */}
        <div className="flex h-full border-l border-line">
          {[
            { k: "min", d: "M4 8h8" },
            { k: "max", d: "M4.5 4.5h7v7h-7z" },
            { k: "close", d: "M4.5 4.5l7 7M11.5 4.5l-7 7" },
          ].map((b) => (
            <button
              key={b.k}
              aria-label={b.k}
              onClick={() => window.juanye?.windowControl(b.k as "min" | "max" | "close")}
              className={
                "grid h-full w-[46px] place-items-center text-muted transition-colors " +
                (b.k === "close" ? "hover:bg-[#e5484d] hover:text-white" : "hover:bg-white/[0.07] hover:text-fg")
              }
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.1">
                <path d={b.d} />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
