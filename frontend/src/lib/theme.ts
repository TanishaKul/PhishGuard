'use client';

import { useSyncExternalStore } from 'react';
import { THEME_KEY } from './theme-script';

export type Theme = 'dark' | 'light';

const THEME_CHANGED_EVENT = 'phishguard:theme-changed';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page.
  }
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

function subscribe(onChange: () => void) {
  // Another tab changed the theme: follow it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY) return;
    document.documentElement.dataset.theme = event.newValue === 'light' ? 'light' : 'dark';
    onChange();
  };
  window.addEventListener(THEME_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'dark' as Theme);
  return [theme, setTheme];
}
