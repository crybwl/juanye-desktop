export const SCENE_PATTERNS = [
  { id: "study", name: "学科涂鸦" },
  { id: "geometry", name: "几何构造" },
  { id: "botanical", name: "自然手绘" },
  { id: "cosmos", name: "星轨宇宙" },
  { id: "contours", name: "流线等高" },
  { id: "lattice", name: "点阵网格" },
] as const;
export type ScenePattern = typeof SCENE_PATTERNS[number]["id"];
export type ScenePatternSize = "small" | "standard" | "large";
export type ScenePatternDensity = "sparse" | "balanced" | "rich";
export interface ScenePreferences { pattern: ScenePattern; size: ScenePatternSize; density: ScenePatternDensity }
export const DEFAULT_SCENE_PREFERENCES: Readonly<ScenePreferences> = Object.freeze({ pattern: "study", size: "large", density: "rich" });
export const SCENE_WIDTH = 1440, SCENE_HEIGHT = 1000;

export function normalizeScenePreferences(value: unknown): ScenePreferences {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    pattern: SCENE_PATTERNS.some(item => item.id === candidate.pattern) ? candidate.pattern as ScenePattern : DEFAULT_SCENE_PREFERENCES.pattern,
    size: typeof candidate.size === "string" && ["small", "standard", "large"].includes(candidate.size) ? candidate.size as ScenePatternSize : DEFAULT_SCENE_PREFERENCES.size,
    density: typeof candidate.density === "string" && ["sparse", "balanced", "rich"].includes(candidate.density) ? candidate.density as ScenePatternDensity : DEFAULT_SCENE_PREFERENCES.density,
  };
}

// Original small line constructions; the familiar book/leaf/pencil definitions
// are supplied from the application's existing SVG, not another icon package.
const DRAWINGS: Record<string, string> = {
  atom: '<ellipse rx="32" ry="12"/><ellipse rx="32" ry="12" transform="rotate(60)"/><ellipse rx="32" ry="12" transform="rotate(120)"/><circle r="3"/>',
  flask: '<path d="M-8-29H8M-5-29v20l-17 30q-3 7 5 7h34q8 0 5-7L5-9v-20M-14 8h28M-7 17h2M7 21h2"/>',
  ruler: '<path d="M-33-10H33V10H-33ZM-24-10V0M-12-10v6M0-10V0M12-10v6M24-10V0"/>',
  compass: '<circle cy="-20" r="5"/><path d="M-3-15-19 29M3-15 22 27M-14 15q13 8 28 0M-22 30l6-3M19 23l5 8M0-25v-7"/>',
  abacus: '<path d="M-30-27H30V27H-30ZM-22-13H22M-22 0H22M-22 13H22"/><path d="M-14-19v12M-3-19v12M9-6v12M-9 7v12M3 7v12M14 7v12"/>',
  graph: '<path d="M-29-27V26H29M-24 17C-13 14-12-13-1-13S12 23 24-17M-29-25l-4 7M-29-25l4 7M29 26l-7-4M29 26l-7 4"/>',
  magnet: '<path d="M-23-21v24a23 23 0 0 0 46 0v-24H10V3a10 10 0 0 1-20 0v-24ZM-23-8h13M10-8H23"/>',
  telescope: '<path d="m-29-8 48-14 6 20-48 14ZM-30-8l-6 2 6 20 7-2M-2 7-16 30M5 5l13 25M3 15v16M22-19l9-2 5 14-10 3"/>',
  globe: '<circle r="28"/><ellipse rx="13" ry="28"/><path d="M-26-10h52M-26 10h52M0-28V28M-34-5a35 35 0 0 0 67 14M0 35v8M-15 43h30"/>',
  dna: '<path d="M-20-30C21-16 20 13-20 30M20-30C-21-16-20 13 20 30M-11-24H11M-6-12H6M-12 0H12M-6 12H6M-11 24H11"/>',
  pendulum: '<path d="M-25-28H25M0-28 23 18M0-28-19 21M-30 14q7 19 28 21"/><circle cx="23" cy="18" r="6"/><circle cx="-19" cy="21" r="6"/>',
  wave: '<path d="M-36 2C-24-29-12-29 0 2S24 33 36 2M-36 17C-24-14-12-14 0 17S24 48 36 17"/>',
  prism: '<path d="m-26 22 19-46 37 35ZM-26 22 9 31l21-20M-7-24 28-15 9 31M28-15 30 11"/>',
  pyramid: '<path d="m0-33-31 50 23 15 37-20ZM0-33-8 32M-31 17 6 2 29 12M0-33 6 2"/>',
  cone: '<path d="M-27 20 0-31 27 20M0-31V27"/><ellipse cy="20" rx="27" ry="8"/>',
  cylinder: '<ellipse cy="-22" rx="25" ry="9"/><path d="M-25-22V22M25-22V22M-25 22a25 9 0 0 0 50 0M-25 22a25 9 0 0 1 50 0"/>',
  orbit: '<circle r="23"/><ellipse rx="38" ry="12" transform="rotate(-27)"/><circle cx="29" cy="-21" r="4"/>',
  rosette: '<circle r="29"/><circle r="14"/><path d="M0-29V29M-29 0H29M-21-21 21 21M-21 21 21-21"/>',
  axes: '<path d="M-31 17 2-3 31 17M2-3V-33M2-3 0 34M2-33l-4 7M2-33l4 7M31 17l-8-1M31 17l-3-7"/><ellipse cx="2" cy="-3" rx="27" ry="9"/>',
  angle: '<path d="M-29 22H31M-29 22 13-26M-12 22a17 17 0 0 0-6-13M-29 15v7h7"/>',
  circles: '<circle r="29"/><circle cx="-14" r="14"/><circle cx="14" r="14"/><path d="M0-29V29M-29 0H29"/>',
  hexagon: '<path d="m-29 0 14-25h29L29 0 14 25H-15ZM-29 0H29M-15-25 14 25M14-25-15 25"/>',
  ellipses: '<ellipse rx="33" ry="20" transform="rotate(-20)"/><ellipse rx="18" ry="31" transform="rotate(-20)"/><circle r="3"/>',
  feather: '<path d="M-24 31 18-27C-23-39-40 9-17 22 7 42 32-4 18-27M-16 21-26 10M-9 11-23-1M-2 1-15-12M4-8-5-21M-9 11 7 16M-2 1 16 5M4-8 20-6"/>',
  fern: '<path d="M0 34V-29M0-18q-17-17-19-3 3 12 19 14M0-6q-27-20-26-3 3 13 26 17M0 10q-30-17-28-1 3 16 28 17M0-18q17-17 19-3-3 12-19 14M0-6q27-20 26-3-3 13-26 17M0 10q30-17 28-1-3 16-28 17"/>',
  mushroom: '<path d="M-30 0C-30-38 30-38 30 0ZM-9 0-13 28q13 9 26 0L9 0M-23-7l4-7M-7-15v-8M10-10l4-7"/>',
  butterfly: '<path d="M0 30V-17M0-8C-38-48-42-2-15 9-40 32-10 40 0 11M0-8C38-48 42-2 15 9 40 32 10 40 0 11M0-17-8-28M0-17 8-28"/>',
  mountain: '<path d="m-37 24 25-45 15 25 13-35 25 55ZM-20-7l8 9 7-9M8-10l9 7 8-10M-33 31H37"/>',
  cloud: '<path d="M-24 19C-46 11-33-15-15-9-9-39 27-32 26-9 48-6 42 21 23 19ZM-13 28l-5 9M5 28l-5 9M23 28l-5 9"/>',
  branch: '<path d="M-24 32 16-32M-10 10C-44 7-26-20-10 10ZM1-7C-23-39 8-41 1-7ZM3-10C36-23 38 7 3-10ZM-10 12C24-1 26 30-10 12Z"/>',
  daisy: '<circle r="8"/><path d="M-5-9C-30-36 8-41 5-9M8-5C34-30 41 8 9 5M5 9C30 36-8 41-5 9M-9 5C-36 30-41-8-9-5M0 35V11"/>',
  moon: '<path d="M14-28a31 31 0 1 0 15 44A28 28 0 0 1 14-28Z"/><path d="m25-19 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z"/>',
  comet: '<circle cx="13" cy="13" r="14"/><path d="M2 3-29-29M15-2-6-34M-1 16-34-9M9 7l5 10 8-4"/>',
  rocket: '<path d="M-12 17C-26-11-3-36 24-31 30-4 10 19-12 17ZM-11 3-28 8-24 25-6 19M11 15 8 32-9 28M-13 24-28 38M-19 21-33 28"/><circle cx="9" cy="-15" r="7"/>',
  galaxy: '<path d="M-31 4C-22-27 31-19 18 6 6 28-21 8-7-2 0-10 11-2 5 3M-25 23C-9 36 27 21 32-6M-20-22Q8-36 29-16"/><circle r="3"/>',
  satellite: '<path d="m-9-16 23 8-7 24-23-8ZM-9-16 5-30M-2-24 14-18M-16 8-30 22M-23 15-29 0M14-8l15 5 8-19-16-6ZM-17 3-33-3l-8 18 15 6M-1-4l13-15"/>',
  constellation: '<path d="m-31-20 23 12 23-20 20 26-19 31-22-14-28 8Z"/><circle cx="-31" cy="-20" r="4"/><circle cx="-8" cy="-8" r="4"/><circle cx="15" cy="-28" r="4"/><circle cx="35" cy="-2" r="4"/><circle cx="16" cy="29" r="4"/><circle cx="-6" cy="15" r="4"/><circle cx="-34" cy="23" r="4"/>',
  meteor: '<path d="M-31 18 4-17M-22 28 13-7M-8 34 26 0M-33 0-5-28"/><path d="m18-25 5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1Z"/>',
  rings: '<circle r="9"/><circle r="20"/><circle r="31"/><path d="M-31 0H31M0-31V31"/>',
};
const SETS: Record<Exclude<ScenePattern, "contours" | "lattice">, string[]> = {
  study: ["book", "pencil", "atom", "flask", "ruler", "compass", "abacus", "graph", "magnet", "telescope", "globe", "dna", "pendulum", "wave", "prism", "pyramid", "cone", "cylinder", "orbit", "bulb", "triangle", "cube", "rosette", "axes", "angle", "circles", "hexagon", "ellipses", "star", "clip", "leaf", "flower", "sprig", "feather", "moon", "constellation"],
  geometry: ["prism", "pyramid", "cone", "cylinder", "rosette", "axes", "angle", "circles", "hexagon", "ellipses", "compass", "ruler", "cube", "graph", "rings"],
  botanical: ["leaf", "flower", "sprig", "feather", "fern", "mushroom", "butterfly", "mountain", "cloud", "branch", "daisy"],
  cosmos: ["moon", "comet", "rocket", "galaxy", "satellite", "constellation", "meteor", "orbit", "star", "rings", "telescope"],
};
const safeColor = (value: string) => /^#[\da-f]{3,8}$/i.test(value) ? value : "#8da4b4";
const shapeDefinitions = Object.entries(DRAWINGS).map(([id, contents]) => `<g id="${id}">${contents}</g>`).join("");

function contours(primary: string, secondary: string, prefs: ScenePreferences) {
  const rowCount = prefs.density === "rich" ? 32 : prefs.density === "balanced" ? 24 : 16;
  const spacing = SCENE_HEIGHT / rowCount;
  const amplitude = prefs.size === "large" ? 82 : prefs.size === "standard" ? 57 : 36;
  let lines = "";
  for (let row = -6; row < rowCount + 6; row++) {
    const y = row * spacing, phase = y / SCENE_HEIGHT * Math.PI * 2;
    const points = Array.from({ length: 25 }, (_, i) => {
      const x = i * SCENE_WIDTH / 24, a = i / 24 * Math.PI * 4 + phase, b = i / 24 * Math.PI * 2 + phase * 2;
      return { x, y: y + Math.sin(a) * amplitude + Math.cos(b) * amplitude * .7, slope: Math.cos(a) * Math.PI * 4 / SCENE_WIDTH * amplitude - Math.sin(b) * Math.PI * 2 / SCENE_WIDTH * amplitude * .7 };
    });
    let path = `M0 ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], step = (b.x - a.x) / 3;
      path += `C${(a.x + step).toFixed(1)} ${(a.y + a.slope * step).toFixed(1)} ${(b.x - step).toFixed(1)} ${(b.y - b.slope * step).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    lines += `<path d="${path}" stroke="${row % 4 ? primary : secondary}" opacity="${row % 4 ? ".25" : ".38"}"/>`;
  }
  return `<g fill="none" stroke-width="1.5">${lines}</g>`;
}

function lattice(primary: string, secondary: string, prefs: ScenePreferences) {
  const unit = (prefs.size === "large" ? 90 : prefs.size === "standard" ? 66 : 46) * (prefs.density === "sparse" ? 1.4 : prefs.density === "balanced" ? 1.14 : 1);
  const columns = Math.round(SCENE_WIDTH / unit), rows = Math.round(SCENE_HEIGHT / unit);
  const lines: string[] = [], dots: string[] = [];
  for (let col = 0; col <= columns; col++) lines.push(`<path d="M${(col * SCENE_WIDTH / columns).toFixed(1)} 0v${SCENE_HEIGHT}"/>`);
  for (let row = 0; row <= rows; row++) {
    const y = row * SCENE_HEIGHT / rows;
    lines.push(`<path d="M0 ${y.toFixed(1)}h${SCENE_WIDTH}"/>`);
    for (let col = 0; col <= columns; col++) dots.push(`<circle cx="${(col * SCENE_WIDTH / columns).toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>`);
  }
  return `<g stroke="${primary}" stroke-width="1" opacity=".15">${lines.join("")}</g><g fill="${secondary}" opacity=".3">${dots.join("")}</g>`;
}

/** Pure, deterministic, local-only art. Color values and preference keys are validated. */
export function createScenePatternSvg(preferences: ScenePreferences, colors: { primary: string; secondary: string }, baseDefinitions: string, preview = false): string {
  const prefs = normalizeScenePreferences(preferences), primary = safeColor(colors.primary), secondary = safeColor(colors.secondary);
  let art: string;
  if (prefs.pattern === "contours") art = contours(primary, secondary, prefs);
  else if (prefs.pattern === "lattice") art = lattice(primary, secondary, prefs);
  else {
    const motifs = SETS[prefs.pattern];
    const columns = prefs.density === "rich" ? 12 : prefs.density === "balanced" ? 10 : 8;
    const rows = prefs.density === "rich" ? 8 : prefs.density === "balanced" ? 6 : 5;
    const scale = prefs.size === "large" ? 1.45 : prefs.size === "standard" ? 1.08 : .75;
    const seed = SCENE_PATTERNS.findIndex(item => item.id === prefs.pattern) * 13;
    const marks = Array.from({ length: columns * rows }, (_, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      const x = (col + .35 + Math.sin(index * 2.37 + seed) * .2) * SCENE_WIDTH / columns;
      const y = (row + .36 + Math.cos(index * 1.81 + seed) * .2) * SCENE_HEIGHT / rows;
      const angle = ((index * 41 + seed * 11) % 58) - 29;
      const factor = scale * [.8, 1, 1.15, .92, 1.06][index % 5];
      const xs = [x, ...(x < 100 ? [x + SCENE_WIDTH] : x > SCENE_WIDTH - 100 ? [x - SCENE_WIDTH] : [])];
      const ys = [y, ...(y < 100 ? [y + SCENE_HEIGHT] : y > SCENE_HEIGHT - 100 ? [y - SCENE_HEIGHT] : [])];
      return xs.flatMap(px => ys.map(py => `<use href="#${motifs[(index * 7 + Math.floor(index / motifs.length) + seed) % motifs.length]}" transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${angle}) scale(${factor.toFixed(2)})" stroke="${index % 4 ? primary : secondary}"/>`)).join("");
    }).join("");
    const labels = prefs.pattern === "study" || prefs.pattern === "geometry" ? ["f(x)", "π", "a²+b²", "∑", "x+y", "√x", "∫", "θ", "sin x", "∞", "eˣ", "α+β"].map((label, index) => `<text x="${(index * 307 + 95) % SCENE_WIDTH}" y="${(index * 163 + 105) % SCENE_HEIGHT}" transform="rotate(${index % 2 ? 7 : -8} ${(index * 307 + 95) % SCENE_WIDTH} ${(index * 163 + 105) % SCENE_HEIGHT})">${label}</text>`).join("") : "";
    art = `<g fill="none" stroke-width="1.4" opacity=".31">${marks}</g><g fill="${secondary}" opacity=".26" font-family="Georgia,serif" font-style="italic" font-size="27">${labels}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}" viewBox="0 0 ${preview ? "500 300" : `${SCENE_WIDTH} ${SCENE_HEIGHT}`}" fill="none" stroke-linecap="round" stroke-linejoin="round"><defs>${baseDefinitions}${shapeDefinitions}</defs>${art}</svg>`;
}
