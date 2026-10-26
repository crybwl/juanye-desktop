try {
  const saved = localStorage.getItem('juanye.appearance.v1');
  const theme = saved === 'glass' ? 'telegram' : saved;
  if (theme === 'dark' || theme === 'light' || theme === 'telegram') {
    document.documentElement.dataset.theme = theme;
    const telegramScheme = localStorage.getItem('juanye.telegram-scheme.v1') === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.telegramScheme = telegramScheme;
    document.documentElement.style.colorScheme = theme === 'light' || theme === 'telegram' && telegramScheme === 'light' ? 'light' : 'dark';
    const telegram = localStorage.getItem('juanye.telegram-theme.v1');
    document.documentElement.dataset.telegramTheme = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'].includes(telegram) ? telegram : 'ember';
    if (saved === 'glass') {
      localStorage.setItem('juanye.appearance.v1', 'telegram');
      localStorage.removeItem('juanye.glass-opacity.v1');
    }
  }
} catch { /* Keep dark as the storage-unavailable fallback. */ }
