import type { SVGProps } from "react";
import type { QType } from "../types";

/** Small, hand-drawn-style symbols. The enclosing button supplies its label. */
export function QuestionTypeIcon({ type, ...props }: SVGProps<SVGSVGElement> & { type: QType }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {type === "single" && <><path d="M19.5 11.7a7.5 7.5 0 1 1-3-5.8" /><circle cx="12" cy="12" r="2.7" fill="currentColor" stroke="none" /></>}
      {type === "multi" && <><path d="m4.5 7.8 2.4 2.5 4.2-4.6M4.5 15.2l2.4 2.5 4.2-4.6" /><path d="m15 8 4.5-.2M15 15.5l4.5-.2" opacity=".7" /></>}
      {type === "blank" && <><path d="M4.5 17.5c4 .3 9.8.3 15-.1" /><path d="M12 5.5v8M9.5 5.5h5M9.5 13.5h5" /></>}
      {type === "essay" && <><path d="M4 6.5h5l3 4h6" /><path d="m8 17 8.3-8.3 3 3L11 20H8v-3Z" /><path d="m14.5 10.5 3 3" /></>}
      {type === "judge" && <><path d="m4 8 3 3 5-6M15 14l5 5M20 14l-5 5" /><path d="m5 20 14-16" opacity=".35" /></>}
      {type === "material" && <><path d="M4 5.5h7v13H4zM14 7h6M14 11h6M14 15h4" /><path d="m6 10 1 1 2-3" /></>}
      {type === "custom" && <><path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" /><circle cx="12" cy="12" r="2" /></>}
    </svg>
  );
}
