'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Flame, Gauge, Layers, Timer, TrendingUp } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import { PathCanvas } from '@/components/path-canvas';
import { STATUS_META } from '@/lib/path';

export default function DashboardPage() {
  const { ready, loadError, coverage, profile, nodes, runtime, session, dueCount, retention, settings } =
    useAppContext();
  const [selected, setSelected] = useState<string | null>(null);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);

  const nextNode = useMemo(() => {
    return (
      nodes.find((n) => runtime[n.id]?.status === 'due') ??
      nodes.find((n) => runtime[n.id]?.status === 'learning') ??
      nodes.find((n) => runtime[n.id]?.status === 'available') ??
      nodes[0]
    );
  }, [nodes, runtime]);

  if (!ready) {
    return (
      <div className="py-24 text-center text-sm">
        <div className="text-muted-foreground">正在准备本地词库…</div>
        {loadError && (
          <div className="mx-auto mt-4 max-w-xl rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-left text-xs text-destructive">
            初始化失败：{loadError}
          </div>
        )}
      </div>
    );
  }

  const percent = Math.round(coverage.coverage * 1000) / 10;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="relative grid place-items-center rounded-2xl border border-border/60 bg-card/50 p-6">
          <svg viewBox="0 0 120 120" className="size-40 -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke="url(#cov)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${coverage.coverage * 327} 327`}
            />
            <defs>
              <linearGradient id="cov" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute text-center">
            <div className="text-3xl font-semibold tabular-nums">{percent}%</div>
            <div className="text-xs text-muted-foreground">文本覆盖率</div>
          </div>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            目标 95% 可读门槛 · 98% 舒适线
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Stat icon={<Layers className="size-4" />} label="已掌握词族" value={`${coverage.known}`} hint={`估计水平 ${coverage.cefr}`} />
          <Stat
            icon={<Gauge className="size-4" />}
            label="实际保持率"
            value={retention.rate === null ? '—' : `${Math.round(retention.rate * 100)}%`}
            hint={
              retention.rate === null
                ? '复习几次后显示'
                : `目标 ${Math.round(settings.learning.retentionTarget * 100)}% · 近 ${retention.sample} 次`
            }
          />
          <Stat icon={<Timer className="size-4" />} label="今日待复习" value={`${dueCount}`} hint="到期卡片数量" />
          <Stat icon={<TrendingUp className="size-4" />} label="今日队列" value={`${session.queue.length}`} hint={`新词 ${session.newCount} · 复习 ${session.dueCount}`} />
          <Stat icon={<Flame className="size-4" />} label="连续学习" value={`${profile.dailyStreak} 天`} hint="坚持比强度更重要" />
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">可视化学习路径</h2>
            <p className="text-xs text-muted-foreground">
              节点由 SRS 掌握度驱动解锁：{Object.entries(STATUS_META).map(([, m]) => m.label).join(' · ')}
            </p>
          </div>
          <Link
            href="/learn"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            开始今日学习 <ArrowRight className="size-4" />
          </Link>
        </div>

        <PathCanvas nodes={nodes} runtime={runtime} selectedId={selected} onSelect={setSelected} />

        <div className="mt-4 rounded-xl border border-border/60 bg-background/50 p-3 text-sm">
          {selectedNode ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{selectedNode.title}</div>
                <div className="text-xs text-muted-foreground">{selectedNode.subtitle}</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>状态：{STATUS_META[runtime[selectedNode.id]?.status ?? 'locked'].label}</span>
                <span>
                  已学 {runtime[selectedNode.id]?.learned ?? 0}/
                  {runtime[selectedNode.id]?.total ?? 0} · 已掌握{' '}
                  {runtime[selectedNode.id]?.mastered ?? 0}
                </span>
                <span>预计 {selectedNode.estimatedMinutes} 分钟</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              点击节点查看详情。建议下一步：<span className="text-foreground">{nextNode?.title}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
