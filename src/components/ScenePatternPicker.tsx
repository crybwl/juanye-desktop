import { useMemo, type CSSProperties } from "react";
import { Check } from "lucide-react";
import sourceDoodles from "../assets/telegram-doodles-workspace.svg?raw";
import { createScenePatternSvg, SCENE_PATTERNS } from "../scene-patterns";
import { useScenePreferences } from "../scene-preferences";
import { TELEGRAM_THEMES, useTelegramTheme } from "../telegram-themes";
import { useTelegramScheme } from "../telegram-scheme";
import { Segmented } from "../ui";
import "./scene-pattern-picker.css";

const definitions = sourceDoodles.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? "";

export function ScenePatternPicker() {
  const [preferences, setPreferences] = useScenePreferences();
  const [theme] = useTelegramTheme(), [scheme] = useTelegramScheme();
  const previews = useMemo(() => {
    const palette = TELEGRAM_THEMES.find(item => item.id === theme) ?? TELEGRAM_THEMES[7];
    const colors = { primary: scheme === "light" ? palette.fill[0] : palette.accent, secondary: scheme === "light" ? palette.fill[1] : palette.accent2 };
    return SCENE_PATTERNS.map(pattern => ({ ...pattern, image: `url("data:image/svg+xml,${encodeURIComponent(createScenePatternSvg({ ...preferences, pattern: pattern.id }, colors, definitions, true))}")` }));
  }, [preferences, theme, scheme]);
  return <fieldset className="scene-pattern-picker" data-testid="scene-pattern-picker">
    <legend>背景图案</legend>
    <div className="scene-pattern-grid">
      {previews.map(pattern => <label className="scene-pattern-choice" key={pattern.id}>
        <input type="radio" name="juanye-scene-pattern" className="sr-only" value={pattern.id} checked={preferences.pattern === pattern.id} onChange={() => setPreferences({ pattern: pattern.id })} />
        <span className="scene-pattern-art" style={{ "--pattern-preview": pattern.image } as CSSProperties} aria-hidden="true" />
        <span className="scene-pattern-name">{pattern.name}{preferences.pattern === pattern.id && <Check size={12} aria-hidden="true" />}</span>
      </label>)}
    </div>
    <div className="scene-pattern-option" role="group" aria-label="图案大小"><span>图案大小</span><Segmented size="sm" value={preferences.size} onChange={size => setPreferences({ size })} options={[{ value: "small", label: "小" }, { value: "standard", label: "标准" }, { value: "large", label: "大" }]} /></div>
    <div className="scene-pattern-option" role="group" aria-label="图案密度"><span>图案密度</span><Segmented size="sm" value={preferences.density} onChange={density => setPreferences({ density })} options={[{ value: "sparse", label: "疏" }, { value: "balanced", label: "适中" }, { value: "rich", label: "丰富" }]} /></div>
  </fieldset>;
}
