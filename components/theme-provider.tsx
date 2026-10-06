'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * 主题切换：浅色 / 深色 / 跟随系统
 *
 * CSS 变量两套已经写在 globals.css（`:root` 浅色、`.dark` 深色），
 * 这里只负责把 `.dark` class 挂到 <html> 上，并持久化选择。
 * 首次渲染由 app/layout.tsx 里的内联脚本提前设置，避免闪白/闪黑（FOUC）。
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'elm.theme';

interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** 在 浅色 → 深色 → 跟随系统 之间轮换（导航栏按钮用） */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 应用主题并返回实际生效的值 */
function applyTheme(theme: Theme): ResolvedTheme {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  return dark ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system';
    setThemeState(stored);
    setResolved(applyTheme(stored));

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const current = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system';
      if (current === 'system') setResolved(applyTheme('system'));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
    setResolved(applyTheme(next));
  }, []);

  const cycle = useCallback(() => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return ctx;
}
