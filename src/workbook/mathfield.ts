import { MathfieldElement } from "mathlive";

/**
 * Desmos 式公式输入：基于 MathLive（MIT）。输入 `/` 成分式、`^` 上标、`sqrt` 根号，方向键出入。
 * 字体复用应用已加载的 KaTeX 字体（fontsDirectory = null），不加载声音与计算引擎。
 */
let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  MathfieldElement.fontsDirectory = null;
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.computeEngine = null;
}

let active: MathfieldElement | null = null;
/** 当前正在编辑的公式框（工具条按钮插入符号时使用）。 */
export const activeMathField = () => (active?.isConnected ? active : null);

export interface MathFieldOptions {
  display?: boolean;
  from?: "start" | "end";
  onInput: (latex: string) => void;
  /** 离开公式框：before = 回到公式前，after = 公式后；key 为触发的按键。 */
  onExit: (side: "before" | "after", key?: string) => void;
  /** 空公式里按退格：删除公式。 */
  onRemove?: () => void;
  /** 公式框创建前已敲下的字符（编辑器在加载公式模块期间代为缓存）。 */
  typed?: string;
}

const isPrintable = (event: KeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

export function mountMathField(host: HTMLElement, latex: string, options: MathFieldOptions): MathfieldElement {
  configure();
  const field = new MathfieldElement();
  field.className = `wb-mathfield${options.display ? " is-display" : ""}`;
  host.append(field);
  field.mathVirtualKeyboardPolicy = "manual";
  field.menuItems = [];
  field.popoverPolicy = "off";
  field.smartFence = true;
  field.defaultMode = "math";
  field.value = latex;
  // MathLive 连接后异步初始化：就绪前的按键缓存起来，就绪后一次补入，避免快速输入丢字。
  let pending = options.typed ?? "";
  const ready = () => Boolean((field as unknown as { _mathfield?: unknown })._mathfield);
  const flush = () => {
    if (!pending || !ready()) return;
    const text = pending;
    pending = "";
    field.executeCommand(["typedText", text, { focus: true, feedback: false, simulateKeystroke: true }]);
    options.onInput(field.value);
  };
  field.addEventListener("keydown", event => {
    if (ready() || event.isComposing || !isPrintable(event)) return;
    event.preventDefault(); event.stopPropagation();
    pending += event.key;
  }, { capture: true });
  field.addEventListener("input", () => options.onInput(field.value));
  field.addEventListener("move-out", event => {
    event.preventDefault();
    const direction = event.detail.direction;
    options.onExit(direction === "backward" || direction === "upward" ? "before" : "after");
  });
  // 捕获阶段先于 MathLive 内部处理：Enter / Esc / 再次输入 $ 都表示写完了。
  field.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "Enter" || event.key === "Escape" || event.key === "$") {
      event.preventDefault(); event.stopPropagation();
      options.onExit("after", event.key);
    } else if (event.key === "Backspace" && !field.value && options.onRemove) {
      event.preventDefault(); event.stopPropagation();
      options.onRemove();
    }
  }, { capture: true });
  field.addEventListener("focusin", () => { active = field; });
  active = field;
  // MathLive 在连接后异步初始化，初始化前 focus() 无效：等 mount 事件，并以帧回调兜底。
  // 打开后的短时间内，点击序列的 mouseup 可能让编辑器重新取得焦点，此时把焦点还给公式框。
  const openedAt = performance.now();
  let placed = false;
  const focusNow = () => {
    if (!field.isConnected) return;
    if (!field.hasFocus()) field.focus();
    if (field.hasFocus() && !placed) { placed = true; field.position = options.from === "start" ? 0 : field.lastOffset; }
    if (placed) flush();
  };
  field.addEventListener("mount", () => requestAnimationFrame(focusNow), { once: true });
  field.addEventListener("focusout", () => { if (performance.now() - openedAt < 450) window.setTimeout(focusNow, 0); });
  requestAnimationFrame(focusNow);
  for (const delay of [60, 160, 320]) window.setTimeout(focusNow, delay);
  return field;
}

/** 在当前公式框插入片段，#? 为占位，#0 为当前选中内容。 */
export function insertIntoMathField(latex: string) {
  const field = activeMathField();
  if (!field) return false;
  field.insert(latex, { selectionMode: "placeholder", focus: true, feedback: false });
  field.focus();
  // 程序插入后补发 input，保证外部状态同步（重复值会被忽略）。
  field.dispatchEvent(new Event("input"));
  return true;
}

export function toggleMathKeyboard() {
  const keyboard = window.mathVirtualKeyboard;
  if (!keyboard) return;
  if (keyboard.visible) keyboard.hide(); else { activeMathField()?.focus(); keyboard.show(); }
}
