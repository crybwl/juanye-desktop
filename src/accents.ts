/**
 * 界面主题色（设置面板与启动时应用共用）。
 * c[0]：实色填充（主按钮、选中态），白字可读；c[1]：暗色主题下的强调文字色。
 * 色值取自 Radix Colors（MIT）对应色阶的 9 / 11 级，不再做双色渐变。
 */
export const ACCENTS: { name: string; c: [string, string] }[] = [
  { name: "靛蓝", c: ["#3e63dd", "#9eb1ff"] },
  { name: "青碧", c: ["#0d8a7d", "#0bd8b6"] },
  { name: "松绿", c: ["#2b9a66", "#3dd68c"] },
  { name: "琥珀", c: ["#c25400", "#ffa057"] },
  { name: "珊瑚", c: ["#d13415", "#ff977d"] },
  { name: "堇紫", c: ["#6e56cf", "#baa7ff"] },
];
