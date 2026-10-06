'use client';

import { useMemo, useState } from 'react';
import { BookOpenCheck, Layers, Sparkles } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import {
  VERDICT_META,
  buildKnownLemmas,
  segment,
  unknownRate,
  verdictOf,
  type TokenSpan,
} from '@/lib/reading';
import { ensureDefinition, isPending } from '@/lib/definitions';
import { createInitialState } from '@/lib/srs';
import { reviewRepo } from '@/lib/db';
import { cn } from '@/lib/utils';

export default function ReadingPage() {
  const { ready, passages, families, words, cards, known, settings, userId, reload } =
    useAppContext();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const knownLemmas = useMemo(() => buildKnownLemmas(families, known), [families, known]);

  const wordByLemma = useMemo(() => {
    const map = new Map<string, (typeof words)[number]>();
    for (const word of words) if (!map.has(word.lemma)) map.set(word.lemma, word);
    return map;
  }, [words]);

  /** 窄读：按 topic 分组 */
  const groups = useMemo(() => {
    const map = new Map<string, typeof passages>();
    for (const passage of passages) {
      if (!map.has(passage.topic)) map.set(passage.topic, []);
      map.get(passage.topic)!.push(passage);
    }
    return [...map.entries()].map(([topic, list]) => ({
      topic,
      list: [...list].sort((a, b) => a.cefr.localeCompare(b.cefr)),
    }));
  }, [passages]);

  const active = passages.find((p) => p.id === activeId) ?? passages[0];

  const analysis = useMemo(() => {
    if (!active) return null;
    const spans = segment(active.text, knownLemmas);
    return { spans, ...unknownRate(spans) };
  }, [active, knownLemmas]);

  const selectedWord = selected ? wordByLemma.get(selected) ?? null : null;

  const addToLearning = async () => {
    if (!userId || !selectedWord) return;
    const card = cards.find((c) => c.wordId === selectedWord.id && c.direction === 'receptive');
    if (!card) {
      setMessage('词库中找不到该词的卡片');
      return;
    }
    setBusy(true);
    setMessage(null);
    // 写入初始复习状态并把到期时间设为现在 → 立即进入今日队列（只影响当前用户）
    await reviewRepo.put(userId, { ...createInitialState(card), dueAt: Date.now() });
    await reload();
    setBusy(false);
    setMessage(`已加入今日学习：${selectedWord.lemma}`);
  };

  const generateDefinition = async () => {
    if (!selectedWord) return;
    setBusy(true);
    setMessage(null);
    const result = await ensureDefinition(settings.llm, selectedWord.id);
    if (result?.definitionStatus === 'ready') {
      setMessage('释义已生成并写入共享词库');
      await reload();
    } else {
      setMessage('生成失败：请检查大模型配置');
    }
    setBusy(false);
  };

  if (!ready) {
    return <div className="py-24 text-center text-sm text-muted-foreground">正在准备本地词库…</div>;
  }

  if (!active || !analysis) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">
        暂无读物。运行 <code>npm run dev</code> 后重新进入本页会自动播种内置短文。
      </div>
    );
  }

  const verdict = verdictOf(analysis.rate);
  const meta = VERDICT_META[verdict];

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">窄读分组</h2>
        </div>
        {groups.map((group) => (
          <div key={group.topic} className="space-y-1">
            <div className="text-xs text-muted-foreground">{group.topic}</div>
            {group.list.map((passage) => {
              const stats = unknownRate(segment(passage.text, knownLemmas));
              const isActive = passage.id === active.id;
              return (
                <button
                  key={passage.id}
                  data-testid="passage-item"
                  onClick={() => {
                    setActiveId(passage.id);
                    setSelected(null);
                    setMessage(null);
                  }}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                    isActive
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card/40 hover:bg-accent',
                  )}
                >
                  <div className="font-medium">{passage.title}</div>
                  <div className="text-muted-foreground">
                    {passage.cefr} · {passage.tokenCount} 词 · 生词率{' '}
                    {(stats.rate * 100).toFixed(1)}%
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <section className="space-y-4">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold">{active.title}</h1>
              <div className="text-xs text-muted-foreground">
                {active.cefr} · {active.topic} · {active.tokenCount} 词
              </div>
            </div>
            <div className="text-right text-xs">
              <div data-testid="unknown-rate" className="text-sm font-medium">
                生词率 {(analysis.rate * 100).toFixed(1)}%
              </div>
              <div className="text-muted-foreground">
                生词 {analysis.unknownWords} / 总词 {analysis.totalWords}
              </div>
            </div>
          </div>

          <div className={cn('mt-3 rounded-lg bg-background/50 px-3 py-2 text-xs', meta.tone)}>
            <span className="font-medium">{meta.label}</span>
            <span className="ml-2 text-muted-foreground">{meta.hint}</span>
            <span className="ml-2 text-muted-foreground">（可理解区间 2%–5%）</span>
          </div>

          <p data-testid="passage-text" className="mt-4 text-[15px] leading-8">
            {analysis.spans.map((span: TokenSpan, index: number) =>
              span.isWord ? (
                span.known ? (
                  <span key={index}>{span.text}</span>
                ) : (
                  <button
                    key={index}
                    data-testid="unknown-token"
                    onClick={() => {
                      setSelected(span.lemma ?? null);
                      setMessage(null);
                    }}
                    className={cn(
                      'rounded px-0.5 underline decoration-dotted underline-offset-4',
                      selected && selected === span.lemma
                        ? 'bg-amber-400/30 text-amber-200'
                        : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/30',
                    )}
                  >
                    {span.text}
                  </button>
                )
              ) : (
                <span key={index}>{span.text}</span>
              ),
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          {!selected ? (
            <p className="text-xs text-muted-foreground">
              点击正文中高亮的生词，可查看释义并加入今日学习。
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="size-4 text-primary" />
                <span className="font-medium">{selected}</span>
                {selectedWord && (
                  <span className="text-xs text-muted-foreground">{selectedWord.cefr}</span>
                )}
              </div>

              {!selectedWord ? (
                <p className="text-xs text-muted-foreground">
                  词库中没有这个词（可能是当前频段之外的词）。可先扩充词表再回来阅读。
                </p>
              ) : isPending(selectedWord) ? (
                <div className="space-y-2">
                  <p className="text-xs text-amber-400">释义待生成</p>
                  {settings.llm.enabled ? (
                    <button
                      data-testid="gen-def-btn"
                      disabled={busy}
                      onClick={() => void generateDefinition()}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                    >
                      生成释义
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">需先在设置页启用大模型</p>
                  )}
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>{selectedWord.definitionEn}</p>
                  {settings.learning.showL1 && (
                    <p className="text-xs text-muted-foreground">{selectedWord.definitionL1}</p>
                  )}
                </div>
              )}

              {selectedWord && (
                <button
                  data-testid="add-to-learning"
                  disabled={busy}
                  onClick={() => void addToLearning()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" /> 加入今日学习
                </button>
              )}

              {message && (
                <p data-testid="reading-message" className="text-xs text-emerald-400">
                  {message}
                </p>
              )}
            </div>
          )}
        </div>

        {analysis.unknownLemmas.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
            <div className="text-xs text-muted-foreground">
              本篇生词（去重 {analysis.unknownLemmas.length} 个）
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {analysis.unknownLemmas.map((lemma) => (
                <button
                  key={lemma}
                  onClick={() => setSelected(lemma)}
                  className="rounded-md bg-background/60 px-2 py-0.5 text-xs text-amber-300"
                >
                  {lemma}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
