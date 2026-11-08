const DEFAULT_APPEARANCE = Object.freeze({ mode: 'dark' });

function checkedAppearance(value) {
  const mode = value?.mode === 'glass' ? 'telegram' : value?.mode;
  if (!['dark', 'light', 'telegram', 'aura'].includes(mode)) throw new Error('外观模式无效');
  if (mode === 'aura') {
    // 晴岚：渲染进程已把“跟随系统”解析成具体明暗，这里只接受两种结果。
    if (value.auraScheme === undefined) return { mode };
    if (!['dark', 'light'].includes(value.auraScheme)) throw new Error('晴岚明暗模式无效');
    return { mode, auraScheme: value.auraScheme };
  }
  if (mode === 'telegram' && value.telegramScheme !== undefined) {
    if (!['dark', 'light'].includes(value.telegramScheme)) throw new Error('Telegram 明暗模式无效');
    return { mode, telegramScheme: value.telegramScheme };
  }
  return { mode };
}

function applyWindowAppearance(window, value) {
  const appearance = checkedAppearance(value);
  // Telegram-style surfaces are opaque: wallpaper behind the app must not
  // interfere with the editor, and paper must remain white when printed.
  const background = appearance.mode === 'telegram' ? appearance.telegramScheme === 'light' ? '#e8eff0' : '#0b0e13'
    : appearance.mode === 'aura' ? appearance.auraScheme === 'light' ? '#eceff5' : '#101218'
    : appearance.mode === 'light' ? '#f4f5f9' : '#08090c';
  window.setBackgroundColor(background);
  return { nativeTransparency: false };
}

module.exports = { DEFAULT_APPEARANCE, checkedAppearance, applyWindowAppearance };
