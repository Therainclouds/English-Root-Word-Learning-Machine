import type { Metadata } from 'next';
import './globals.css';
import { SiteNav } from '@/components/site-nav';
import { AppProvider } from '@/components/app-provider';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: '英语学习机 · 可视化路径',
  description: '高频词族 + 分级阅读 + SRS + 大模型辅助的本地英语学习应用',
};

/**
 * 首帧前把主题 class 挂上，避免刷新时闪白/闪黑（FOUC）。
 * 与 components/theme-provider.tsx 使用同一个 localStorage key。
 */
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('elm.theme')||'system';
var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var r=document.documentElement;
r.classList.toggle('dark',d);
r.style.colorScheme=d?'dark':'light';
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="app-shell min-h-screen">
        <ThemeProvider>
          <AppProvider>
            <SiteNav />
            <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
