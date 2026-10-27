import { memo, useEffect } from "react";
import sourceDoodles from "./assets/telegram-doodles-workspace.svg?raw";
import { TELEGRAM_THEMES } from "./telegram-themes";

const WIDTH = 1440, HEIGHT = 1000;
const definitions = sourceDoodles.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? "";
const shapes = ["book", "leaf", "cube", "pencil", "sprig", "bulb", "triangle", "flower", "clip", "star"];
const positions = [
  [64, 65], [283, 116], [492, 53], [719, 137], [981, 60], [1216, 119], [1380, 46],
  [143, 296], [388, 235], [632, 332], [877, 257], [1128, 336], [1337, 277],
  [54, 527], [284, 448], [534, 575], [763, 474], [1012, 563], [1246, 466], [1403, 585],
  [153, 743], [411, 684], [651, 793], [897, 699], [1159, 805], [1352, 707],
  [42, 924], [300, 876], [535, 958], [790, 894], [1026, 949], [1269, 915],
];

/** One varied scene, not a small stamp restarted at every panel boundary. */
function sceneSvg(key: string) {
  const id = key.split(":")[0], light = key.endsWith(":light");
  const palette = TELEGRAM_THEMES.find(theme => theme.id === id) ?? TELEGRAM_THEMES[7];
  const first = light ? palette.fill[0] : palette.accent;
  const second = light ? palette.fill[1] : palette.accent2;
  const seed = TELEGRAM_THEMES.indexOf(palette);
  const marks = positions.map(([x, y], index) => {
    const shape = shapes[(index * 7 + seed * 3) % shapes.length];
    const angle = ((index * 41 + seed * 11) % 58) - 29;
    const scale = [0.63, 0.85, 1.08, 0.74, 0.94][index % 5];
    return `<use href="#${shape}" transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"/>`;
  }).join("");
  const formulae = [
    [185, 170, "f(x)"], [584, 175, "π"], [1091, 198, "a²+b²"],
    [216, 608, "∑"], [671, 620, "x+y"], [1165, 653, "√x"],
    [446, 844, "∫"], [955, 842, "θ"],
  ].map(([x, y, text], index) => `<text x="${x}" y="${y}" transform="rotate(${index % 2 ? 8 : -9} ${x} ${y})">${text}</text>`).join("");
  const points = Array.from({ length: 18 }, (_, index) => {
    const x = (index * 197 + 73) % WIDTH, y = (index * 127 + 189) % HEIGHT;
    return index % 3 ? `<circle cx="${x}" cy="${y}" r="2"/>` : `<path d="M${x - 4} ${y}h8m-4-4v8"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" stroke-linecap="round" stroke-linejoin="round"><defs>${definitions}</defs><g stroke="${first}" stroke-width="1.5" opacity=".32">${marks}</g><g fill="${second}" opacity=".25" font-family="Georgia,serif" font-style="italic" font-size="22">${formulae}</g><g stroke="${second}" opacity=".28">${points}</g></svg>`;
}

// Keep only a few decoded tiles. Never create a texture or update React per frame.
const rasterCache = new Map<string, Promise<string>>();
async function rasterScene(key: string): Promise<string> {
  const hit = rasterCache.get(key);
  if (hit) { rasterCache.delete(key); rasterCache.set(key, hit); return hit; }
  const job = new Promise<string>((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => {
      try {
        const canvas = document.createElement("canvas"), ratio = Math.min(devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(WIDTH * ratio); canvas.height = Math.round(HEIGHT * ratio);
        const context = canvas.getContext("2d");
        if (!context) throw Error("Canvas unavailable");
        context.drawImage(picture, 0, 0, canvas.width, canvas.height);
        resolve(`url("${canvas.toDataURL("image/png")}")`);
        canvas.width = canvas.height = 0;
      } catch (error) { reject(error); }
    };
    picture.onerror = () => reject(Error("Wallpaper unavailable"));
    picture.src = `data:image/svg+xml,${encodeURIComponent(sceneSvg(key))}`;
  });
  rasterCache.set(key, job);
  if (rasterCache.size > 4) rasterCache.delete(rasterCache.keys().next().value!);
  job.catch(() => { if (rasterCache.get(key) === job) rasterCache.delete(key); });
  return job;
}

export const SceneBackdrop = memo(function SceneBackdrop() {
  useEffect(() => {
    const root = document.documentElement;
    let current = "", alive = true;
    const sync = () => {
      const key = root.dataset.theme === "telegram" ? `${root.dataset.telegramTheme || "ember"}:${root.dataset.telegramScheme || "dark"}` : "";
      if (key === current) return;
      current = key;
      root.dataset.sceneReady = "false";
      if (!key) { root.style.removeProperty("--scene-wallpaper"); return; }
      // A single SVG is available during the first decode; subsequent visits reuse PNG.
      root.style.setProperty("--scene-wallpaper", `url("data:image/svg+xml,${encodeURIComponent(sceneSvg(key))}")`);
      void rasterScene(key).then(image => {
        if (!alive || current !== key) return;
        root.style.setProperty("--scene-wallpaper", image);
        root.dataset.sceneReady = "true";
      }).catch(() => { /* Static local SVG fallback still leaves every action usable. */ });
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-telegram-theme", "data-telegram-scheme"] });
    sync();
    return () => { alive = false; observer.disconnect(); };
  }, []);
  return <div className="scene-backdrop" data-scene-backdrop="" aria-hidden="true"><div className="scene-backdrop-art" /></div>;
});
