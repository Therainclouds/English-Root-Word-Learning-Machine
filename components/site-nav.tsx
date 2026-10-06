'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  BookOpenCheck,
  GraduationCap,
  Monitor,
  Moon,
  Route,
  Settings2,
  Sun,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppContext } from './app-provider';
import { useTheme } from './theme-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const LINKS = [
  { href: '/', label: '学习路径', icon: Route },
  { href: '/learn', label: '今日学习', icon: GraduationCap },
  { href: '/reading', label: '阅读', icon: BookOpenCheck },
  { href: '/library', label: '词库', icon: BookOpen },
  { href: '/settings', label: '设置', icon: Settings2 },
];

export function SiteNav() {
  const pathname = usePathname();
  const { users, userId, switchUser, addUser, renameAccount, removeAccount } = useAppContext();
  const { theme, resolved, cycle } = useTheme();
  const current = users.find((u) => u.id === userId);
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const themeLabel =
    theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : `跟随系统（当前${resolved === 'dark' ? '深色' : '浅色'}）`;

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setRenameName(current?.name ?? '');
    setConfirmDelete(false);
  }, [current?.id, current?.name]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Route className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">英语学习机</div>
            <div className="text-xs text-muted-foreground">词族 · 阅读 · SRS · 大模型</div>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="relative flex items-center gap-1.5">
          <button
            data-testid="theme-toggle"
            onClick={cycle}
            title={`主题：${themeLabel}（点击切换）`}
            className="rounded-md border border-border bg-card/50 p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ThemeIcon className="size-4" />
          </button>

          <Select value={userId ?? ''} onValueChange={(value) => switchUser(value)}>
            <SelectTrigger
              data-testid="user-select"
              className="h-8 w-[132px] border-border bg-card/50 px-2 text-xs"
            >
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5 shrink-0 text-muted-foreground" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id} className="text-xs">
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setOpen((v) => !v)}
            title="管理用户"
            className={cn(
              'rounded-md border border-border bg-card/50 px-2 py-1 text-xs hover:text-foreground',
              open ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            管理
          </button>

          {open && (
            <div className="absolute right-0 top-11 z-50 w-72 space-y-3 rounded-xl border border-border bg-popover p-3 text-sm shadow-xl">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">新建用户</div>
                <div className="flex gap-1.5">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={`用户 ${users.length + 1}`}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => {
                      addUser(newName || `用户 ${users.length + 1}`);
                      setNewName('');
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <UserPlus className="size-3.5" /> 新建
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs text-muted-foreground">重命名当前用户</div>
                <div className="flex gap-1.5">
                  <input
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => current && renameAccount(current.id, renameName)}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    保存
                  </button>
                </div>
              </div>

              <div className="border-t border-border pt-2">
                {confirmDelete ? (
                  <div className="space-y-1.5">
                    <div className="text-xs text-destructive">
                      将删除「{current?.name}」及其全部学习数据，不可恢复。
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => current && void removeAccount(current.id)}
                        className="flex-1 rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive"
                      >
                        确认删除
                      </button>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-md border border-border px-2 py-1 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> 删除当前用户
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
