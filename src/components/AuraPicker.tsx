import type { CSSProperties } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { AURA_PALETTES, resolveAuraScheme, useAura, type AuraScheme } from "../aura";
import { withThemeTransition } from "../appearance";
import { Segmented } from "../ui";

/** 晴岚配色：6 套低饱和底色，各自带一个相配的强调色；明暗可跟随系统。 */
export function AuraPicker() {
  const [aura, setAura] = useAura();
  const scheme = resolveAuraScheme(aura);
  return <fieldset data-aura-gallery className="aura-gallery">
    <legend>晴岚配色</legend>
    <div className="aura-option" role="group" aria-label="晴岚明暗模式">
      <span>明暗</span>
      <Segmented size="sm" value={aura.scheme} onChange={(value: AuraScheme) => withThemeTransition(() => setAura({ scheme: value }))} options={[
        { value: "light", label: "浅色", icon: <Sun size={13} /> },
        { value: "dark", label: "深色", icon: <Moon size={13} /> },
        { value: "system", label: "跟随系统", icon: <Monitor size={13} /> },
      ]} />
    </div>
    <div className="aura-grid">
      {AURA_PALETTES.map(palette => {
        const tone = palette[scheme], checked = aura.palette === palette.id;
        return <label key={palette.id} className="aura-choice" style={{
          "--swatch-base": tone.base, "--swatch-1": tone.glow[0], "--swatch-2": tone.glow[1], "--swatch-3": tone.glow[2],
          "--swatch-fill": scheme === "dark" ? tone.text : tone.fill,
          "--swatch-card": scheme === "dark" ? "#18191b" : "#ffffff", "--swatch-ink": scheme === "dark" ? "#edeef0" : "#1c2024",
        } as CSSProperties}>
          <input type="radio" className="sr-only" name="juanye-aura-palette" value={palette.id} checked={checked} onChange={() => withThemeTransition(() => setAura({ palette: palette.id }))} />
          <span className="aura-swatch" aria-hidden="true"><span className="aura-swatch-card"><i /><i /><i /></span></span>
          <span className="aura-name">{palette.name}{checked && <Check size={12} aria-hidden="true" />}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}
