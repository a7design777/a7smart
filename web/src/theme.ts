import { useEffect, useState } from 'react';
import type { IconName } from './components/Icon';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'a7smart-theme';

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

function read(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Тема застосовується ще до першого рендера — інакше при перезавантаженні
 * встигає блимнути світлим на темній темі.
 */
apply(read());

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
    if (theme === 'system') {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, theme);
    }
  }, [theme]);

  /** Циклічний перехід: системна → світла → темна → системна. */
  const cycle = () =>
    setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'));

  return { theme, setTheme, cycle };
}

export const THEME_ICON: Record<Theme, IconName> = {
  system: 'circle-half',
  light: 'sun',
  dark: 'moon',
};

export const THEME_LABEL: Record<Theme, string> = {
  system: 'Тема: системна',
  light: 'Тема: світла',
  dark: 'Тема: темна',
};
