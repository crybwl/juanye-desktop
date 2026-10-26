const DEFAULT_APPEARANCE = Object.freeze({ mode: 'dark' });

function checkedAppearance(value) {
  const mode = value?.mode === 'glass' ? 'telegram' : value?.mode;
  if (!['dark', 'light', 'telegram'].includes(mode)) throw new Error('外观模式无效');
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
  window.setBackgroundColor(appearance.mode === 'telegram' ? appearance.telegramScheme === 'light' ? '#e8eff0' : '#0b0e13' : appearance.mode === 'light' ? '#f4f5f9' : '#08090c');
  return { nativeTransparency: false };
}

module.exports = { DEFAULT_APPEARANCE, checkedAppearance, applyWindowAppearance };
