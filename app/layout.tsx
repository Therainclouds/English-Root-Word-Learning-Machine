import type { Metadata } from 'next';
import './globals.css';
import { SiteNav } from '@/components/site-nav';
import { AppProvider } from '@/components/app-provider';

export const metadata: Metadata = {
  title: '英语学习机 · 可视化路径',
  description: '高频词族 + 分级阅读 + SRS + 大模型辅助的本地英语学习应用',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="app-shell min-h-screen">
        <AppProvider>
          <SiteNav />
          <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
