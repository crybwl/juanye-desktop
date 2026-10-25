import { useEffect, useId, useLayoutEffect, useRef, useState, type AriaAttributes, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "../controls.css";

export interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean }
interface SelectProps<T extends string> extends Pick<AriaAttributes, "aria-label" | "aria-labelledby" | "aria-describedby"> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** A themed single-choice control. DOM focus stays on the trigger via aria-activedescendant. */
export function Select<T extends string>({ value, onValueChange, options, className = "", disabled, placeholder = "请选择", ...aria }: SelectProps<T>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const typeahead = useRef({ text: "", at: 0 });
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const selected = options.findIndex(option => option.value === value);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const show = (last = false) => {
    if (disabled || !enabled.length) return;
    setActive(selected >= 0 && !options[selected].disabled ? selected : last ? enabled.at(-1)! : enabled[0]);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value); close(true);
  };
  const move = (delta: number) => setActive(previous => {
    const at = enabled.indexOf(previous);
    return enabled[(at + delta + enabled.length) % enabled.length] ?? -1;
  });
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) show(event.key === "ArrowUp"); else move(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); if (!open) show(); setActive(event.key === "Home" ? enabled[0] ?? -1 : enabled.at(-1) ?? -1); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active); else show(); }
    else if (event.key.length === 1) {
      const now = Date.now(); typeahead.current.text = (now - typeahead.current.at < 700 ? typeahead.current.text : "") + event.key.toLocaleLowerCase(); typeahead.current.at = now;
      const search = typeahead.current.text;
      const start = open ? active : selected;
      const matches = [...enabled.filter(index => index > start), ...enabled.filter(index => index <= start)];
      const index = matches.find(index => options[index].label.toLocaleLowerCase().startsWith(search));
      if (index !== undefined) { event.preventDefault(); setActive(index); setOpen(true); }
    }
  };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open && (active < 0 || !options[active] || options[active].disabled)) setActive(selected >= 0 && !options[selected].disabled ? selected : enabled[0] ?? -1); }, [open, active, options, selected, enabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const padding = 10, gap = 6;
      const width = Math.min(Math.max(anchor.width, 156), window.innerWidth - padding * 2);
      const wantedHeight = Math.min(280, options.length * 38 + 12);
      const below = window.innerHeight - anchor.bottom - padding - gap, above = anchor.top - padding - gap;
      const upward = below < Math.min(wantedHeight, 160) && above > below;
      const height = Math.max(48, Math.min(wantedHeight, upward ? above : below));
      setPosition({ position: "fixed", width, maxHeight: height, left: Math.max(padding, Math.min(anchor.left, window.innerWidth - width - padding)), top: upward ? Math.max(padding, anchor.top - gap - height) : Math.max(padding, anchor.bottom + gap), visibility: "visible" });
    };
    place();
    const observer = new ResizeObserver(place); if (trigger.current) observer.observe(trigger.current);
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) place(); };
    window.addEventListener("resize", place); document.addEventListener("scroll", scroll, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); document.removeEventListener("scroll", scroll, true); };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
      else if (event.key === "Tab") close();
    };
    document.addEventListener("pointerdown", pointer, true); window.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", pointer, true); window.removeEventListener("keydown", escape, true); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  return <>
    <button {...aria} ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined} disabled={disabled || !options.length} data-select-trigger="" data-ui-select-trigger="" className={`select-trigger ${className}`} onKeyDown={key} onClick={event => { event.preventDefault(); event.stopPropagation(); if (open) close(); else show(); }}>
      <span className="select-value">{options[selected]?.label ?? placeholder}</span><ChevronDown size={15} className="select-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={aria["aria-label"]} data-select-menu="" data-ui-select-listbox="" className="select-menu" style={position} onPointerDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-option-index={index} data-highlighted={index === active || undefined} className="select-option" onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={event => { event.preventDefault(); event.stopPropagation(); choose(index); }}><span>{option.label}</span>{option.value === value && <Check size={15} strokeWidth={2.5} aria-hidden="true" />}</div>)}
    </div>, document.body)}
  </>;
}
