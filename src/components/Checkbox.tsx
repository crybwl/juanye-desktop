import type { ButtonHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import "../controls.css";

export function CheckboxIndicator({ checked, disabled, className = "" }: { checked: boolean | "mixed"; disabled?: boolean; className?: string }) {
  return <span aria-hidden="true" data-checked={checked} data-disabled={disabled || undefined} className={`checkbox-indicator ${className}`}>{checked === "mixed" ? <Minus size={12} strokeWidth={3} /> : checked ? <Check size={12} strokeWidth={3} /> : null}</span>;
}
export function Checkbox({ checked, onCheckedChange, className = "", disabled, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & { checked: boolean | "mixed"; onCheckedChange: (checked: boolean) => void }) {
  return <button {...props} type="button" role="checkbox" aria-checked={checked} disabled={disabled} className={`checkbox-control ${className}`} onClick={event => { event.preventDefault(); event.stopPropagation(); onCheckedChange(checked !== true); }}><CheckboxIndicator checked={checked} disabled={disabled} /></button>;
}
