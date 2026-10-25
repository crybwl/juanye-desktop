import { Check, MessagesSquare, Moon, Sun } from "lucide-react";
import { useAppearance, type Appearance } from "../appearance";

const MODES = [
  { id: "dark", name: "深色", icon: Moon },
  { id: "light", name: "淡色", icon: Sun },
  { id: "telegram", name: "Telegram", icon: MessagesSquare },
] as const;

export function AppearancePicker() {
  const [appearance, setAppearance] = useAppearance();
  return (
    <fieldset className="appearance-picker min-w-0 border-0 p-0">
      <legend className="mb-3 text-[13px] font-medium text-muted">界面模式</legend>
      <div className="grid grid-cols-3 gap-3">
        {MODES.map(({ id, name, icon: Icon }) => (
          <label key={id} className="appearance-choice relative cursor-pointer">
            <input
              type="radio"
              name="juanye-appearance"
              value={id}
              checked={appearance === id}
              onChange={() => setAppearance(id as Appearance)}
              className="peer sr-only"
            />
            <span className="appearance-choice-content flex h-full flex-col gap-3 rounded-xl border border-line-strong p-3 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-accent">
              <span className={`appearance-swatch appearance-swatch-${id}`} aria-hidden="true">
                <span className="appearance-swatch-sidebar" />
                <span className="appearance-swatch-page"><span /><span /><span /></span>
              </span>
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <Icon size={14} />{name}
                {appearance === id && <Check size={13} className="ml-auto text-accent" aria-hidden="true" />}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
