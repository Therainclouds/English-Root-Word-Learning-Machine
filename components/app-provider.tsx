'use client';

import { createContext, useContext } from 'react';
import { useApp } from '@/lib/use-app';

type AppState = ReturnType<typeof useApp>;

const AppContext = createContext<AppState | null>(null);

/**
 * 全应用共享一份状态（多用户切换、词库、排程、设置）。
 * 放在 layout 中，导航与所有页面共用，避免重复加载 IndexedDB。
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  return <AppContext.Provider value={app}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext 必须在 AppProvider 内使用');
  return ctx;
}
