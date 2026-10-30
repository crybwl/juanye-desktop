import { AnimatePresence, animate, motion, useAnimationControls, useIsPresent, type HTMLMotionProps } from 'motion/react';
import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useRichMotion } from './bank-motion';

// Same short, well-damped spring as the established question-library cards.
// Never animate scale on document panes: math and editable text stay crisp.
export const bookSpring = { type: 'spring', stiffness: 420, damping: 32, mass: .8 } as const;
const swapEnter = { opacity: 1, transform: 'translateY(0px)' };

/** Exiting surfaces remain visible, but cannot accept stale input or focus. */
export const BookMotionItem = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(function BookMotionItem(props, ref) {
  const present = useIsPresent();
  const interactive = present && props['aria-hidden'] !== true;
  const block = (event: { preventDefault(): void; stopPropagation(): void }) => { if (!interactive) { event.preventDefault(); event.stopPropagation(); } };
  return <motion.div {...props} ref={ref} {...(!present ? { inert: '' } : {})} aria-hidden={present ? props['aria-hidden'] : true}
    onPointerDownCapture={block} onClickCapture={block} onInputCapture={block} onChangeCapture={block} onBlurCapture={block}
    onFocusCapture={event => { if (!interactive) { event.stopPropagation(); (event.target as HTMLElement).blur(); } }} />;
});

// A single observer for all visible question swaps. Cache natural size without
// React updates or per-frame geometry reads; only a mode change measures twice.
const sizeSubscribers = new Map<Element, (height: number) => void>();
let sizeObserver: ResizeObserver | undefined;
function observeHeight(node: HTMLElement, changed: (height: number) => void) {
  sizeObserver ??= new ResizeObserver(entries => {
    for (const entry of entries) sizeSubscribers.get(entry.target)?.(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
  });
  sizeSubscribers.set(node, changed); sizeObserver.observe(node);
  return () => { sizeSubscribers.delete(node); sizeObserver?.unobserve(node); if (!sizeSubscribers.size) { sizeObserver?.disconnect(); sizeObserver = undefined; } };
}

/** A real height transition with overlapping, inert exit and immediate entry.
 * No layout projections over the whole Tiptap tree; no state updates per frame. */
export function BookContentSwap({ value, children, className = '' }: { value: string; children: ReactNode; className?: string }) {
  const rich = useRichMotion(), root = useRef<HTMLDivElement>(null), incoming = useRef<HTMLDivElement | null>(null);
  const last = useRef<{ value?: string; height: number }>({ height: 0 });
  const playing = useRef<{ stop(): void }>();
  const generation = useRef(0);
  const bind = useCallback((node: HTMLDivElement | null) => {
    if (node) incoming.current = node;
    else if (incoming.current?.dataset.bookSwapValue === value) incoming.current = null;
  }, [value]);
  useLayoutEffect(() => {
    const outer = root.current, inner = incoming.current;
    if (!outer || !inner) return;
    const version = ++generation.current;
    const from = outer.style.height ? outer.getBoundingClientRect().height : last.current.height;
    const to = inner.getBoundingClientRect().height;
    const changed = last.current.value !== undefined && last.current.value !== value;
    playing.current?.stop(); playing.current = undefined;
    const release = () => { outer.style.height = ''; outer.style.overflow = ''; };
    if (rich && changed && from > 0 && Math.abs(from - to) > 1) {
      outer.style.height = `${from}px`; outer.style.overflow = 'hidden';
      playing.current = animate(outer, { height: [`${from}px`, `${to}px`] }, { ...bookSpring, onComplete: () => {
        if (generation.current === version) { playing.current = undefined; release(); }
      } });
    } else release();
    last.current = { value, height: to };
    const stopObserving = observeHeight(inner, height => {
      // A user can open another disclosure during entry. Prefer live content
      // over clipping it to an already-outdated measured destination.
      if (playing.current && Math.abs(last.current.height - height) > 1) { playing.current.stop(); playing.current = undefined; release(); }
      last.current.height = height;
    });
    return () => { stopObserving(); playing.current?.stop(); playing.current = undefined; };
  }, [value, rich]);
  return <div ref={root} className={`book-content-swap ${className}`}>
    <AnimatePresence initial={false} mode="popLayout">
      <BookMotionItem ref={bind} key={value} data-book-swap-value={value}
        initial={rich ? { opacity: 0, transform: 'translateY(9px)' } : false} animate={swapEnter}
        exit={{ opacity: 0, transform: rich ? 'translateY(-7px)' : 'none', transition: { duration: rich ? .12 : 0 } }}
        transition={rich ? { ...bookSpring, opacity: { duration: .18 } } : { duration: 0 }}>{children}</BookMotionItem>
    </AnimatePresence>
  </div>;
}

export function BookReveal({ open, children, className = '', onClosed }: { open: boolean; children: ReactNode; className?: string; onClosed?(): void }) {
  const rich = useRichMotion();
  return <AnimatePresence initial={false} onExitComplete={onClosed}>{open && <BookMotionItem key="reveal" className={className}
    initial={rich ? { height: 0, opacity: 0 } : false} animate={{ height: 'auto', opacity: 1 }}
    exit={{ height: 0, opacity: 0 }} transition={rich ? { ...bookSpring, opacity: { duration: .16 } } : { duration: 0 }}
    style={{ overflow: 'hidden' }}>{children}</BookMotionItem>}</AnimatePresence>;
}

/** Keep native summary keyboard behavior and real details semantics. */
export function BookDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const rich = useRichMotion(), [open, setOpen] = useState(false), [held, setHeld] = useState(false), latest = useRef(open);
  latest.current = open;
  return <details open={open || held} className="book-disclosure">
    <summary aria-expanded={open} onClick={event => { event.preventDefault(); if (!open) setHeld(true); setOpen(value => !value); }}>
      {label}<motion.span aria-hidden="true" animate={{ transform: `rotate(${open ? 180 : 0}deg)` }} transition={rich ? bookSpring : { duration: 0 }}><ChevronDown size={13}/></motion.span>
    </summary>
    <BookReveal open={open} onClosed={() => { if (!latest.current) setHeld(false); }}><div className="book-disclosure-content">{children}</div></BookReveal>
  </details>;
}

/** Park tab contents after their complete exit, keeping the preview iframe and
 * scroll position alive. Rapid reversal cancels the obsolete completion. */
export function BookSideView({ active, name, children }: { active: boolean; name: string; children: ReactNode }) {
  const rich = useRichMotion(), root = useRef<HTMLDivElement>(null), controls = useAnimationControls(), serial = useRef(0);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const version = ++serial.current; element.style.visibility = 'visible';
    void controls.start({ opacity: active ? 1 : 0, transform: rich ? `translateX(${active ? 0 : 13}px)` : 'none',
      transition: rich ? { ...bookSpring, opacity: { duration: active ? .18 : .12 } } : { duration: 0 } }).then(() => {
      if (serial.current === version && !active) element.style.visibility = 'hidden';
    });
    return () => { serial.current++; controls.stop(); };
  }, [active, rich, controls]);
  return <motion.div ref={root} className="book-side-view" data-book-side-view={name} aria-hidden={!active}
    {...(!active ? { inert: '' } : {})} initial={{ opacity: active ? 1 : 0 }} animate={controls}>{children}</motion.div>;
}
