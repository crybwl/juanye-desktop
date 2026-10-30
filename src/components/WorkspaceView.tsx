import { motion, useAnimationControls } from "motion/react";
import { useLayoutEffect, useMemo, useRef, type ReactNode, type SyntheticEvent } from "react";
import { softSpring } from "../ui";
import { WorkspaceParking } from "../workspace-parking";

const CONTROL_SELECTOR = "button,input,select,textarea,a[href],[tabindex],[contenteditable='true']";

function redirectFocus(source: HTMLElement, backwards: boolean) {
  const doc = source.ownerDocument;
  const active = doc.querySelector<HTMLElement>('[data-workspace-view][aria-hidden="false"]');
  if (!active || active === source) return;
  const candidates = [...active.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)];
  if (backwards) candidates.reverse();
  for (const candidate of candidates) {
    if (candidate.tabIndex < 0 || candidate.matches(":disabled") || candidate.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
    // Ignore collapsed zero-width editor/layout/outline panes, not just hidden inputs.
    let visible = true;
    for (let node: HTMLElement | null = candidate; node && node !== active; node = node.parentElement) {
      if (!node.getClientRects().length) { visible = false; break; }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(node).visibility === "hidden") { visible = false; break; }
    }
    if (!visible) continue;
    candidate.focus({ preventScroll: true });
    if (doc.activeElement === candidate) return;
  }
  // Loading/empty workspaces remain a safe focus destination, not a nav/Tab loop.
  active.focus({ preventScroll: true });
}

export function WorkspaceView({ active, name, offset, reducedMotion, className = "", children }: {
  active: boolean;
  name: "exam" | "bank" | "book";
  offset: number;
  reducedMotion: boolean;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const parking = useRef<WorkspaceParking>();
  const backwards = useRef(false);
  const controls = useAnimationControls();
  const transform = reducedMotion ? "translateX(0px)" : `translateX(${offset}px)`;
  const variants = useMemo(() => ({
    active: { opacity: 1, transform: "translateX(0px)", transition: { opacity: { duration: .22 }, transform: softSpring } },
    inactive: { opacity: 0, transform, transition: { opacity: { duration: .14 }, transform: softSpring } },
  }), [transform]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const lifecycle = parking.current ??= new WorkspaceParking(element);
    const finish = lifecycle.begin(active);
    element.dataset.workspaceParked = "false";
    const trackTab = (event: KeyboardEvent) => { if (event.key === "Tab") backwards.current = event.shiftKey; };
    if (!active) {
      element.ownerDocument.addEventListener("keydown", trackTab, true);
      const focused = element.ownerDocument.activeElement;
      if (focused instanceof HTMLElement && element.contains(focused)) {
        focused.blur();
        // All sibling layout effects have revealed their new active roots by then.
        queueMicrotask(() => { if (element.getAttribute("aria-hidden") === "true") redirectFocus(element, backwards.current); });
      }
    }
    void controls.start(active ? "active" : "inactive").then(() => {
      if (finish()) element.dataset.workspaceParked = "true";
      element.ownerDocument.removeEventListener("keydown", trackTab, true);
    });
    return () => {
      lifecycle.cancel();
      element.ownerDocument.removeEventListener("keydown", trackTab, true);
    };
  }, [active, controls, transform]);

  const blockInactive = (event: SyntheticEvent) => {
    if (active) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return <motion.div ref={root} className={`workspace-view workspace-view-${name} ${className}`}
    data-workspace-view={name} aria-hidden={!active} tabIndex={-1}
    initial={name === "exam" ? false : { opacity: 0, transform }} animate={controls} variants={variants}
    style={{ zIndex: active ? 2 : 1 }}
    onPointerDownCapture={blockInactive} onClickCapture={blockInactive}
    onKeyDownCapture={event => { if (!active) { backwards.current = event.shiftKey; blockInactive(event); redirectFocus(event.currentTarget, event.shiftKey); } }}
    onFocusCapture={event => { if (!active) { event.stopPropagation(); (event.target as HTMLElement).blur(); redirectFocus(event.currentTarget, backwards.current); } }}
  >{children}</motion.div>;
}
