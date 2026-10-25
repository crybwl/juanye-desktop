try {
  const saved = localStorage.getItem('juanye.appearance.v1');
  const theme = saved === 'glass' ? 'telegram' : saved;
  if (theme === 'dark' || theme === 'light' || theme === 'telegram') {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    const telegram = localStorage.getItem('juanye.telegram-theme.v1');
    document.documentElement.dataset.telegramTheme = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'].includes(telegram) ? telegram : 'ember';
    if (saved === 'glass') {
      localStorage.setItem('juanye.appearance.v1', 'telegram');
      localStorage.removeItem('juanye.glass-opacity.v1');
    }
  }
} catch { /* Keep dark as the storage-unavailable fallback. */ }
