import type { CSSProperties } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { setAppearance } from "../appearance";
import { TELEGRAM_THEMES, useTelegramTheme } from "../telegram-themes";
import { useTelegramScheme } from "../telegram-scheme";
import { Segmented } from "../ui";

export function TelegramThemePicker() {
  const [selected, setSelected] = useTelegramTheme();
  const [scheme, setScheme] = useTelegramScheme();
  const active = TELEGRAM_THEMES.find(theme => theme.id === selected)!;
  return <fieldset data-telegram-gallery className="telegram-gallery min-w-0 rounded-2xl border border-line p-4">
    <legend className="px-1.5 text-[13px] font-medium text-accent">Telegram 主题</legend>
    <div className="mb-4 flex items-center justify-between gap-3" role="group" aria-label="Telegram 明暗模式">
      <span className="text-[12.5px] text-muted">明暗模式</span>
      <Segmented size="sm" value={scheme} onChange={setScheme} options={[{ value: "dark", label: "深色", icon: <Moon size={13} /> }, { value: "light", label: "浅色", icon: <Sun size={13} /> }]} />
    </div>
    <div className="grid grid-cols-3 gap-3">
      {TELEGRAM_THEMES.map(theme => <label key={theme.id} className="telegram-theme-choice relative cursor-pointer" style={{ "--theme-wallpaper": theme.wallpaper, "--theme-accent": scheme === "light" ? theme.fill[0] : theme.accent, "--theme-fill": theme.fill[0], "--theme-fill-2": theme.fill[1] } as CSSProperties}>
        <input className="peer sr-only" type="radio" name="juanye-telegram-theme" value={theme.id} checked={selected === theme.id} onChange={() => { setSelected(theme.id); setAppearance("telegram"); }} />
        <span className="telegram-theme-card">
          <span className="telegram-theme-bubble telegram-theme-bubble-out" aria-hidden="true" />
          <span className="telegram-theme-bubble telegram-theme-bubble-in" aria-hidden="true" />
          <span className="telegram-theme-emoji" aria-hidden="true">{theme.emoji}</span>
          <span className="telegram-theme-name">{theme.name}{selected === theme.id && <Check size={12} aria-hidden="true" />}</span>
        </span>
      </label>)}
    </div>
    <div data-theme-preview={selected} className="telegram-live-preview" style={{ "--theme-wallpaper": active.wallpaper, "--theme-fill": active.fill[0], "--theme-fill-2": active.fill[1] } as CSSProperties} aria-hidden="true">
      <div className="telegram-preview-in">试卷结构</div>
      <div className="telegram-preview-out">题目编辑 <Check size={12} /></div>
    </div>
  </fieldset>;
}
