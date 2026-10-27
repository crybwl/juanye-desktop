import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, MotionConfigContext, animate, motion } from "motion/react";
import { MathText } from "../math";

// Motion's reduced-motion hook snapshots the OS preference at mount. Share a
// live subscription so changing either preference also updates mounted cards.
const motionSubscribers = new Set<() => void>();
let motionMedia: MediaQueryList | undefined;
let stopMotionSubscription: (() => void) | undefined;
function reducedMotionMedia() {
  if (!motionMedia && typeof window !== "undefined" && typeof window.matchMedia === "function") motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionMedia;
}
function motionPreferenceSnapshot() {
  const system = !!reducedMotionMedia()?.matches;
  const app = typeof document !== "undefined" && !!document.querySelector("[data-interface-motion='reduced']");
  return (system ? 1 : 0) | (app ? 2 : 0);
}
function subscribeMotionPreference(notify: () => void) {
  motionSubscribers.add(notify);
  if (motionSubscribers.size === 1) {
    const changed = () => motionSubscribers.forEach(subscriber => subscriber());
    const media = reducedMotionMedia();
    media?.addEventListener("change", changed);
    const observer = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(changed);
    if (typeof document !== "undefined") observer?.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-interface-motion"] });
    stopMotionSubscription = () => { media?.removeEventListener("change", changed); observer?.disconnect(); };
  }
  return () => {
    motionSubscribers.delete(notify);
    if (!motionSubscribers.size) { stopMotionSubscription?.(); stopMotionSubscription = undefined; }
  };
}
const serverMotionPreference = () => 0;

/** Motion is decorative only: every component here renders its final state instantly when motion is reduced. */
export function useRichMotion() {
  const { reducedMotion } = useContext(MotionConfigContext);
  const preference = useSyncExternalStore(subscribeMotionPreference, motionPreferenceSnapshot, serverMotionPreference);
  return reducedMotion !== "always" && !(preference & 2) && (reducedMotion === "never" || !(preference & 1));
}

export const cardSpring = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 } as const;
export const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.032, delayChildren: 0.03 } } };
export const cardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: cardSpring },
};

/** Counts up/down smoothly; screen readers always receive the final value. */
const defaultNumberFormat = (value: number) => String(Math.round(value));
const screenReaderOnly: CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 };
export function AnimatedNumber({ value, className, format = defaultNumberFormat }: { value: number; className?: string; format?: (value: number) => string }) {
  const node = useRef<HTMLSpanElement>(null), last = useRef(value), formatter = useRef(format), rich = useRichMotion();
  formatter.current = format;
  const formatted = format(value);
  useLayoutEffect(() => {
    const el = node.current, from = last.current;
    if (!el) return;
    if (!rich || from === value) { last.current = value; el.textContent = formatted; return; }
    el.textContent = formatter.current(from);
    const controls = animate(from, value, { duration: Math.min(0.9, 0.35 + Math.abs(value - from) * 0.02), ease: [0.16, 1, 0.3, 1], onUpdate: v => { last.current = v; el.textContent = formatter.current(v); } });
    return () => controls.stop();
  }, [value, rich, formatted]);
  return <span className={className}><span ref={node} aria-hidden="true">{formatted}</span><span style={screenReaderOnly}>{formatted}</span></span>;
}

export function DifficultyMeter({ level, label }: { level: "easy" | "medium" | "hard"; label: string }) {
  const filled = level === "easy" ? 1 : level === "medium" ? 2 : 3;
  return <span className="bank-difficulty" data-level={level} title={`难度：${label}`}><span aria-hidden="true">{[0, 1, 2].map(index => <i key={index} data-on={index < filled} />)}</span>{label}</span>;
}

/** A proportional bar that animates its segments whenever the library composition changes. */
export function TypeSpectrum({ segments, className = "", decorative }: { segments: { key: string; label: string; hue: string; count: number }[]; className?: string; decorative?: boolean }) {
  const rich = useRichMotion();
  const total = segments.reduce((sum, item) => sum + item.count, 0);
  const label = total ? segments.filter(item => item.count).map(item => `${item.label} ${item.count}`).join("，") : "暂无题目";
  return <div className={`bank-type-spectrum ${className}`} {...decorative ? { "aria-hidden": true } : { role: "img", "aria-label": `题型分布：${label}` }}>
    {total ? segments.filter(item => item.count).map((item, index) => <motion.span key={item.key} title={`${item.label} · ${item.count}`} style={{ background: item.hue }} initial={rich ? { flexGrow: 0, opacity: 0 } : false} animate={{ flexGrow: item.count, opacity: 1 }} transition={rich ? { type: "spring", stiffness: 160, damping: 22, delay: 0.08 + index * 0.06 } : { duration: 0 }} />) : <span className="bank-type-spectrum-empty" />}
  </div>;
}

/* ---------- fly-to-basket ---------- */
export interface Flight { id: number; from: DOMRect; to: DOMRect; hue: string; label: string; delay: number }
export function FlightLayer({ flights, onArrive }: { flights: Flight[]; onArrive: (id: number) => void }) {
  const rich = useRichMotion(), arrive = useRef(onArrive);
  arrive.current = onArrive;
  useEffect(() => { if (!rich) flights.forEach(flight => arrive.current(flight.id)); }, [rich, flights]);
  if (typeof document === "undefined" || !rich) return null;
  return createPortal(<div className="bank-flight-layer" aria-hidden="true">{flights.map(flight => {
    const sx = flight.from.left + flight.from.width / 2, sy = flight.from.top + flight.from.height / 2;
    const tx = flight.to.left + flight.to.width / 2, ty = flight.to.top + flight.to.height / 2;
    const dx = tx - sx, dy = ty - sy, lift = Math.min(140, 60 + Math.abs(dx) * 0.18);
    return <motion.div key={flight.id} className="bank-flight" style={{ left: sx, top: sy, "--type-hue": flight.hue } as CSSProperties}
      initial={{ x: 0, y: 0, scale: 0.6, opacity: 0, rotate: 0 }}
      animate={{ x: [0, dx * 0.42, dx], y: [0, dy * 0.42 - lift, dy], scale: [0.6, 1.08, 0.36], opacity: [0, 1, 0.9], rotate: [0, -10, 18] }}
      transition={{ duration: 0.72, delay: flight.delay, ease: [0.45, 0, 0.2, 1], times: [0, 0.45, 1] }}
      onAnimationComplete={() => arrive.current(flight.id)}><span>{flight.label}</span></motion.div>;
  })}</div>, document.body);
}

/* ---------- star burst ---------- */
export function StarBurst({ burst }: { burst: number }) {
  const rich = useRichMotion();
  return <AnimatePresence>{rich && burst > 0 && <motion.span key={burst} className="bank-star-burst" aria-hidden="true" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, delay: 0.25 }}>
    {Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2, distance = index % 2 ? 15 : 20;
      return <motion.i key={index} initial={{ x: 0, y: 0, scale: 0.4 }} animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, scale: [0.4, 1, 0] }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} />;
    })}
    <motion.b initial={{ scale: 0.2, opacity: 0.8 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 0.5 }} />
  </motion.span>}</AnimatePresence>;
}

/* ---------- empty states ---------- */
export function EmptyArt({ kind }: { kind: "empty" | "search" | "trash" | "preview" }) {
  return <div className="bank-empty-art" data-kind={kind} aria-hidden="true">
    <span className="bank-empty-halo" />
    <svg viewBox="0 0 120 96" width="120" height="96" fill="none">
      <g className="bank-empty-sheet bank-empty-sheet-back"><rect x="30" y="14" width="54" height="66" rx="8" /><path d="M40 30h28M40 39h34M40 48h20" /></g>
      <g className="bank-empty-sheet bank-empty-sheet-front"><rect x="40" y="20" width="54" height="66" rx="8" /><path d="M50 36h30M50 45h34M50 54h24M50 63h16" /></g>
      {kind === "search" && <g className="bank-empty-lens"><circle cx="86" cy="62" r="13" /><path d="m95.5 71.5 9 9" /></g>}
      {kind === "trash" && <g className="bank-empty-bin"><path d="M76 52h26l-3 28H79z" /><path d="M73 52h32M84 47h10" /></g>}
      {kind === "empty" && <g className="bank-empty-spark"><path d="M98 20v10M93 25h10" /><path d="M22 58v7M18.5 61.5h7" /><circle cx="104" cy="44" r="2" /></g>}
      {kind === "preview" && <g className="bank-empty-cursor"><path d="M84 58l16 6-7 3-3 7z" /></g>}
    </svg>
  </div>;
}

/* ---------- figure lightbox ---------- */
export interface ZoomFigure { id: string; src: string; caption?: string }
const inertRoots = new Map<HTMLElement, { count: number; inert: boolean; hidden: string | null }>();
const lightboxDialogs: HTMLElement[] = [];
let lightboxFocusOrigin: HTMLElement | null = null;
function lockAppRoots() {
  const roots = [...document.querySelectorAll<HTMLElement>(".app-bg")];
  roots.forEach(root => {
    const previous = inertRoots.get(root);
    if (previous) previous.count += 1;
    else { inertRoots.set(root, { count: 1, inert: root.inert, hidden: root.getAttribute("aria-hidden") }); root.inert = true; root.setAttribute("aria-hidden", "true"); }
  });
  return () => roots.forEach(root => {
    const previous = inertRoots.get(root);
    if (!previous || --previous.count > 0) return;
    root.inert = previous.inert;
    if (previous.hidden === null) root.removeAttribute("aria-hidden"); else root.setAttribute("aria-hidden", previous.hidden);
    inertRoots.delete(root);
  });
}
function LightboxDialog({ figure, onClose }: { figure: ZoomFigure; onClose: () => void }) {
  const rich = useRichMotion(), dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!lightboxDialogs.length) lightboxFocusOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lightboxDialogs.push(element);
    const focusDialog = () => (closeButton.current ?? element).focus({ preventScroll: true });
    focusDialog();
    const unlock = lockAppRoots();
    const key = (event: KeyboardEvent) => {
      if (lightboxDialogs.at(-1) !== element) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      else if (event.key === "Tab") {
        event.preventDefault(); event.stopPropagation();
        const controls = [...element.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex], [contenteditable='true']")].filter(control => !control.hasAttribute("disabled") && control.tabIndex >= 0 && control.getClientRects().length > 0 && !control.closest("[inert]"));
        if (!controls.length) { element.focus({ preventScroll: true }); return; }
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[event.shiftKey ? index <= 0 ? controls.length - 1 : index - 1 : index < 0 || index === controls.length - 1 ? 0 : index + 1].focus({ preventScroll: true });
      }
    };
    const focus = (event: FocusEvent) => { if (lightboxDialogs.at(-1) === element && !element.contains(event.target as Node | null)) focusDialog(); };
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus, true);
    return () => {
      window.removeEventListener("keydown", key, true); document.removeEventListener("focusin", focus, true); unlock();
      const index = lightboxDialogs.indexOf(element);
      if (index >= 0) lightboxDialogs.splice(index, 1);
      if (!lightboxDialogs.length) {
        const previousFocus = lightboxFocusOrigin;
        lightboxFocusOrigin = null;
        if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
      } else if (element.contains(document.activeElement)) {
        lightboxDialogs.at(-1)?.querySelector<HTMLElement>(".bank-lightbox-close")?.focus({ preventScroll: true });
      }
    };
  }, []);
  return <motion.div ref={dialog} className="bank-lightbox" role="dialog" aria-modal="true" aria-label="题图大图" tabIndex={-1} initial={rich ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={rich ? undefined : { duration: 0 }} onClick={() => close.current()}>
    <motion.figure initial={rich ? { scale: 0.86, y: 24, opacity: 0 } : false} animate={{ scale: 1, y: 0, opacity: 1 }} exit={rich ? { scale: 0.9, y: 12, opacity: 0 } : { scale: 1, y: 0, opacity: 0 }} transition={rich ? cardSpring : { duration: 0 }} onClick={event => event.stopPropagation()}>
      <img src={figure.src} alt={figure.caption || "题图大图"} />
      {figure.caption && <figcaption><MathText text={figure.caption} /></figcaption>}
      <button ref={closeButton} className="bank-lightbox-close" onClick={() => close.current()}>关闭大图</button>
    </motion.figure>
  </motion.div>;
}
export function FigureLightbox({ figure, onClose }: { figure: ZoomFigure | null; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence>{figure && <LightboxDialog key={figure.id} figure={figure} onClose={onClose} />}</AnimatePresence>, document.body);
}

/** Height-animated reveal for secondary content. */
export function Reveal({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const rich = useRichMotion();
  return <AnimatePresence initial={false}>{open && <motion.div className={className} initial={rich ? { height: 0, opacity: 0 } : false} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={rich ? { type: "spring", stiffness: 380, damping: 36 } : { duration: 0 }} style={{ overflow: "hidden" }}>{children}</motion.div>}</AnimatePresence>;
}

/** Keeps a value latched briefly so short-lived UI (e.g. drop hints) does not flicker. */
export function useLatched<T>(value: T, ms = 120) {
  const [latched, setLatched] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setLatched(value), value ? 0 : ms); return () => clearTimeout(timer); }, [value, ms]);
  return latched;
}
