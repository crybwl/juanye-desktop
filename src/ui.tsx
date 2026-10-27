import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  PresenceContext,
  useIsPresent,
  type HTMLMotionProps,
} from "motion/react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle, X } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const spring = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;
export const softSpring = { type: "spring", stiffness: 260, damping: 30 } as const;

/* ---------------- SharedPill ----------------
 * layoutId 共享高亮（滑动的选中背景）。隔离 PresenceContext，
 * 让它不参与外层 AnimatePresence 的退出计数，父级切换/关闭永远不会被它卡住。 */
export function SharedPill({ layoutId, ...rest }: HTMLMotionProps<"span"> & { layoutId: string }) {
  return (
    <PresenceContext.Provider value={null}>
      <motion.span layoutId={layoutId} {...rest} />
    </PresenceContext.Provider>
  );
}

/* ---------------- Button ---------------- */
type BtnProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};
export function Button({ variant = "secondary", size = "md", icon, className, children, ...rest }: BtnProps) {
  return (
    <motion.button
      data-ui-button="button"
      data-variant={variant}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={cx(
        "btn relative inline-flex shrink-0 select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-medium outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-8 rounded-lg px-3 text-[12.5px]",
        size === "md" && "h-9 rounded-[10px] px-3.5 text-[13px]",
        size === "lg" && "h-11 rounded-xl px-5 text-[14px]",
        variant === "primary" && "btn-primary text-[#0b0d18]",
        variant === "secondary" && "bg-white/[0.06] text-fg hover:bg-white/[0.1]",
        variant === "ghost" && "text-muted hover:bg-white/[0.06] hover:text-fg",
        variant === "outline" && "border border-line-strong text-fg hover:border-white/20 hover:bg-white/[0.04]",
        variant === "danger" && "bg-danger/12 text-danger hover:bg-danger/20",
        "transition-colors duration-150",
        className,
      )}
      {...rest}
    >
      {icon}
      {children as ReactNode}
    </motion.button>
  );
}

export function IconButton({
  label,
  children,
  active,
  className,
  side = "bottom",
  kbd,
  ...rest
}: HTMLMotionProps<"button"> & { label: string; active?: boolean; side?: "bottom" | "top" | "right"; kbd?: string }) {
  return (
    <Tooltip label={label} side={side} kbd={kbd}>
      <motion.button
        data-ui-button="icon"
        data-active={active || undefined}
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        transition={spring}
        className={cx(
          "relative grid h-8 w-8 place-items-center rounded-lg text-muted outline-none transition-colors",
          "hover:bg-white/[0.07] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50",
          active && "bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent",
          className,
        )}
        {...rest}
      >
        {children as ReactNode}
      </motion.button>
    </Tooltip>
  );
}

/* ---------------- Tooltip ---------------- */
export function Tooltip({
  label,
  children,
  side = "bottom",
  kbd,
}: {
  label: string;
  children: ReactNode;
  side?: "bottom" | "top" | "right";
  kbd?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useRef<number>();
  const pos =
    side === "bottom"
      ? "top-full mt-2 left-1/2 -translate-x-1/2"
      : side === "top"
        ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
        : "left-full ml-2 top-1/2 -translate-y-1/2";
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => (t.current = window.setTimeout(() => setOpen(true), 380))}
      onPointerLeave={() => {
        clearTimeout(t.current);
        setOpen(false);
      }}
      onPointerDown={() => {
        clearTimeout(t.current);
        setOpen(false);
      }}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, scale: 0.94, y: side === "top" ? 4 : side === "bottom" ? -4 : 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            className={cx(
              "pointer-events-none absolute z-[80] flex items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-[#1c1f29] px-2 py-1 text-[12px] text-fg shadow-xl",
              pos,
            )}
          >
            {label}
            {kbd && <Kbd>{kbd}</Kbd>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-white/10 bg-white/[0.06] px-1 font-sans text-[10.5px] font-medium text-muted">
      {children}
    </kbd>
  );
}

/* ---------------- Segmented ---------------- */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  full,
  className,
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  full?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="tablist"
      className={cx(
        "relative inline-flex items-center gap-0.5 rounded-[10px] bg-white/[0.045] p-[3px] ring-1 ring-inset ring-white/[0.05]",
        full && "flex w-full",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative z-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] font-medium outline-none transition-colors duration-200",
              "focus-visible:ring-2 focus-visible:ring-accent/50",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
              full && "flex-1",
              on ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {on && (
              <SharedPill
                layoutId={`seg-${id}`}
                transition={spring}
                className="absolute inset-0 -z-10 rounded-[8px] bg-[#262a37] shadow-[0_1px_2px_rgba(0,0,0,.4),inset_0_1px_0_rgba(255,255,255,.06)]"
              />
            )}
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Switch ---------------- */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-[3px] outline-none transition-colors duration-300",
        "focus-visible:ring-2 focus-visible:ring-accent/50",
        checked ? "bg-accent" : "bg-white/[0.12]",
      )}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 35 }}
        className={cx("h-4 w-4 rounded-full shadow-md", checked ? "bg-[#0d1020]" : "bg-white/70")}
      />
    </button>
  );
}

/* ---------------- Slider ---------------- */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const raw = min + ((clientX - r.left) / r.width) * (max - min);
    const v = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    onChange(Number(v.toFixed(2)));
  };
  return (
    <div className="flex items-center gap-3">
      <div
        ref={ref}
        className="group relative h-6 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setDrag(true);
          set(e.clientX);
        }}
        onPointerMove={(e) => drag && set(e.clientX)}
        onPointerUp={() => setDrag(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onChange(Math.min(max, +(value + step).toFixed(2)));
          if (e.key === "ArrowLeft") onChange(Math.max(min, +(value - step).toFixed(2)));
        }}
        tabIndex={0}
        role="slider"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
      >
        <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.08]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
            animate={{ width: `${pct}%` }}
            transition={drag ? { duration: 0 } : spring}
          />
        </div>
        <motion.div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(157,177,255,.18),0_2px_6px_rgba(0,0,0,.5)]"
          animate={{ left: `${pct}%`, scale: drag ? 1.18 : 1 }}
          transition={drag ? { left: { duration: 0 }, scale: spring } : spring}
        />
      </div>
      <span className="w-14 text-right font-mono text-[12px] tabular-nums text-accent">{format(value)}</span>
    </div>
  );
}

/* ---------------- Animated number ---------------- */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const s = useSpring(mv, { stiffness: 90, damping: 18 });
  const text = useTransform(s, (v) => Math.round(v).toString());
  useEffect(() => {
    mv.set(value);
  }, [value, mv]);
  return <motion.span className={cx("tabular-nums", className)}>{text}</motion.span>;
}

/** 数字滚动：值变化时上下翻动 */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const prev = useRef(value);
  const dir = value >= prev.current ? 1 : -1;
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span className={cx("relative inline-flex h-[1.25em] overflow-hidden tabular-nums", className)}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span
          key={value}
          custom={dir}
          variants={{
            enter: (d: number) => ({ y: d * 14, opacity: 0, filter: "blur(2px)" }),
            center: { y: 0, opacity: 1, filter: "blur(0px)" },
            exit: (d: number) => ({ y: d * -14, opacity: 0, filter: "blur(2px)" }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={spring}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({
  open,
  onClose,
  children,
  className,
  label,
  align = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label?: string;
  align?: "center" | "top";
}) {
  const present = useIsPresent();
  const visible = open && present;
  useEffect(() => {
    if (!visible) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [visible, onClose]);
  // 自己管理挂载/卸载，而不是依赖 AnimatePresence：
  // 更可控：关闭动画结束后再卸载，遮罩在关闭瞬间即不再拦截点击。
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <motion.div
      className={cx(
        "fixed inset-0 z-[60] flex justify-center px-6",
        align === "center" ? "items-center" : "items-start pt-[14vh]",
        !visible && "pointer-events-none",
      )}
      data-modal-motion={visible ? "open" : "closing"}
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      transition={{ duration: visible ? 0.2 : 0.18 }}
    >
      <div className="absolute inset-0 bg-[#05060a]/60 backdrop-blur-[6px]" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label={label}
        aria-modal={visible || undefined}
        aria-hidden={!visible || undefined}
        initial={{ opacity: 0, scale: 0.976, y: align === "top" ? -10 : 14 }}
        animate={
          visible
            ? { opacity: 1, scale: 1, y: 0 }
            : { opacity: 0, scale: 0.984, y: 6, transition: { duration: 0.16 } }
        }
        exit={{ opacity: 0, scale: 0.984, y: 6, transition: { duration: 0.16 } }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={cx(
          "glass relative overflow-hidden rounded-2xl border border-line-strong shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]",
          className,
        )}
      >
        {children}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/* ---------------- Toast ---------------- */
type Toast = { id: number; title: string; desc?: string; tone?: "ok" | "info" | "warn" };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { ...t, id }]);
    window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div data-screen-only className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[340px] flex-col items-end gap-2">
          <AnimatePresence initial={false}>
            {list.map((t) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 480, damping: 34 }}
                className="glass pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-line-strong px-4 py-3 shadow-2xl"
              >
                <span className={cx("mt-0.5", t.tone === "warn" ? "text-warn" : t.tone === "info" ? "text-accent" : "text-ok")}>
                  {t.tone === "warn" ? <AlertTriangle size={17} /> : t.tone === "info" ? <Info size={17} /> : <CheckCircle2 size={17} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-fg">{t.title}</div>
                  {t.desc && <div className="mt-0.5 truncate text-[12px] text-muted">{t.desc}</div>}
                </div>
                <button
                  className="text-faint transition-colors hover:text-fg"
                  onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}
                  aria-label="关闭"
                >
                  <X size={14} />
                </button>
                <motion.span
                  className="absolute bottom-0 left-0 h-[2px] bg-accent/50"
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: 3.2, ease: "linear" }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

/* ---------------- Field ---------------- */
export function Field({ label, hint, children, right }: { label: string; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {right}
      </div>
      {children}
      {hint && <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">{hint}</div>}
    </label>
  );
}

export const inputCls =
  "h-10 w-full rounded-[10px] border border-line-strong bg-white/[0.03] px-3 text-[13px] text-fg outline-none transition-[border-color,box-shadow,background] duration-200 placeholder:text-faint hover:border-white/20 focus:border-accent/60 focus:bg-white/[0.05] focus:shadow-[0_0_0_4px_rgba(157,177,255,.12)]";
