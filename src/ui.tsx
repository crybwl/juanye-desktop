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
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
        // 控件尺寸：28 / 32 / 40（Ant Design controlHeight 体系），圆角统一 6px。
        size === "sm" && "h-7 rounded-[6px] px-2.5 text-[12px]",
        size === "md" && "h-8 rounded-[6px] px-3 text-[13px]",
        size === "lg" && "h-10 rounded-[8px] px-4 text-[14px]",
        variant === "primary" && "btn-primary",
        variant === "secondary" && "ui-btn-secondary text-fg",
        variant === "ghost" && "ui-btn-ghost text-muted hover:text-fg",
        variant === "outline" && "ui-btn-outline border text-fg",
        variant === "danger" && "ui-btn-danger text-danger",
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
          "relative grid h-8 w-8 place-items-center rounded-[6px] text-muted outline-none transition-colors",
          "hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50",
          active && "text-accent hover:text-accent",
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
              "ui-tooltip pointer-events-none absolute z-[80] flex items-center gap-2 whitespace-nowrap rounded-[6px] px-2 py-1 text-[12px]",
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
    <kbd className="ui-kbd inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-sans text-[11px] font-medium text-muted">
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
        "ui-segmented relative inline-flex items-center gap-0.5 rounded-[8px] p-[2px]",
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
              "relative z-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] font-medium outline-none transition-colors duration-200",
              "focus-visible:ring-2 focus-visible:ring-accent/50",
              size === "sm" ? "h-6 px-2.5 text-[12px]" : "h-7 px-3 text-[13px]",
              full && "flex-1",
              on ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {on && (
              <SharedPill
                layoutId={`seg-${id}`}
                transition={spring}
                className="ui-segmented-pill absolute inset-0 -z-10 rounded-[6px]"
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
        checked ? "ui-switch-on" : "ui-switch-off",
      )}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: "spring", stiffness: 700, damping: 35 }}
        className="h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/.25)]"
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
        <div className="ui-slider-track absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
          <motion.div
            className="ui-slider-range h-full rounded-full"
            animate={{ width: `${pct}%` }}
            transition={drag ? { duration: 0 } : spring}
          />
        </div>
        <motion.div
          className="ui-slider-thumb absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          animate={{ left: `${pct}%`, scale: drag ? 1.18 : 1 }}
          transition={drag ? { left: { duration: 0 }, scale: spring } : spring}
        />
      </div>
      <span className="w-14 text-right text-[12px] tabular-nums text-muted">{format(value)}</span>
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
// Align one popup texture with the application's scene after opening/resizing.
// No per-frame geometry reads or inherited root-variable writes are involved.
function alignScene(element: HTMLElement | null) {
  if (!element || document.documentElement.dataset.theme !== "telegram") return;
  const plane = document.querySelector<HTMLElement>(".scene-backdrop-art");
  if (!plane) return;
  const origin = plane.getBoundingClientRect(), box = element.getBoundingClientRect();
  element.style.setProperty("--scene-origin-x", `${Math.round(origin.left - box.left)}px`);
  element.style.setProperty("--scene-origin-y", `${Math.round(origin.top - box.top)}px`);
}

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
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) return setMounted(true);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [open]);
  useLayoutEffect(() => {
    if (!mounted || !visible) return;
    const observer = new ResizeObserver(() => alignScene(surface.current));
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, [mounted, visible]);
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
      <div className="ui-modal-overlay absolute inset-0" onClick={onClose} />
      <motion.div
        ref={surface}
        role="dialog"
        aria-label={label}
        aria-modal={visible || undefined}
        aria-hidden={!visible || undefined}
        initial={{ opacity: 0, transform: `translateY(${align === "top" ? -10 : 14}px) scale(0.976)` }}
        animate={
          visible
            ? { opacity: 1, transform: "translateY(0px) scale(1)" }
            : { opacity: 0, transform: "translateY(6px) scale(0.984)", transition: { duration: 0.16 } }
        }
        exit={{ opacity: 0, transform: "translateY(6px) scale(0.984)", transition: { duration: 0.16 } }}
        onAnimationComplete={() => alignScene(surface.current)}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={cx(
          "glass ui-modal relative overflow-hidden rounded-[8px]",
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
                className="glass ui-toast pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[8px] px-4 py-3"
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
                  className="absolute bottom-0 left-0 h-[2px] bg-line-strong"
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
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {right}
      </div>
      {children}
      {hint && <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-faint">{hint}</div>}
    </label>
  );
}

export const inputCls =
  "ui-input h-8 w-full rounded-[6px] border px-2.5 text-[13px] text-fg outline-none transition-[border-color,box-shadow,background] duration-150 placeholder:text-faint";
