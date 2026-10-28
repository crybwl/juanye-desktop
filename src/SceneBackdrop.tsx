import { memo, useEffect } from "react";
import sourceDoodles from "./assets/telegram-doodles-workspace.svg?raw";
import { TELEGRAM_THEMES } from "./telegram-themes";
import { createScenePatternSvg, normalizeScenePreferences, SCENE_HEIGHT, SCENE_WIDTH } from "./scene-patterns";
import { getScenePreferences, initializeScenePreferences, subscribeScenePreferences } from "./scene-preferences";

const WIDTH = SCENE_WIDTH, HEIGHT = SCENE_HEIGHT;
const definitions = sourceDoodles.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? "";

/** One varied scene, not a small stamp restarted at every panel boundary. */
function sceneSvg(key: string) {
  const [id, scheme, pattern, size, density] = key.split(":"), light = scheme === "light";
  const palette = TELEGRAM_THEMES.find(theme => theme.id === id) ?? TELEGRAM_THEMES[7];
  const first = light ? palette.fill[0] : palette.accent;
  const second = light ? palette.fill[1] : palette.accent2;
  return createScenePatternSvg(normalizeScenePreferences({ pattern, size, density }), { primary: first, secondary: second }, definitions);
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
    initializeScenePreferences();
    let current = "", alive = true;
    const sync = () => {
      const preferences = getScenePreferences();
      const key = root.dataset.theme === "telegram" ? `${root.dataset.telegramTheme || "ember"}:${root.dataset.telegramScheme || "dark"}:${preferences.pattern}:${preferences.size}:${preferences.density}` : "";
      if (key === current) return;
      current = key;
      root.dataset.sceneTextureKey = key;
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
    const unsubscribe = subscribeScenePreferences(sync);
    sync();
    return () => { alive = false; observer.disconnect(); unsubscribe(); };
  }, []);
  return <div className="scene-backdrop" data-scene-backdrop="" aria-hidden="true"><div className="scene-backdrop-art" /></div>;
});
