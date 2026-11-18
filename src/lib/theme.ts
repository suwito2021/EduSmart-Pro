import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'lentera_theme';
const THEME_EVENT = 'lentera-theme-change';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    /* ignore storage access errors */
  }
  return 'light';
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore storage errors */
  }
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: theme }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    return getInitialTheme();
  });

  useEffect(() => {
    applyTheme(theme);
  }, []);

  useEffect(() => {
    const onThemeEvent = (e: Event) => {
      const next = (e as CustomEvent<ThemeMode>).detail;
      if (next === 'light' || next === 'dark') {
        setThemeState(next);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        document.documentElement.classList.toggle('dark', e.newValue === 'dark');
        document.documentElement.style.colorScheme = e.newValue;
        setThemeState(e.newValue);
      }
    };
    window.addEventListener(THEME_EVENT, onThemeEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
