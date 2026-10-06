'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import { GRADE_OPTIONS } from '@/lib/srs';
import { explainWord, generateExamples, type WordExplanation } from '@/lib/llm';
import { checkSentences, type SentenceQuality } from '@/lib/llm/decision';
import { ensureDefinition, isPending } from '@/lib/definitions';

/** 卡片模板 → 正面提示（S-007 新增两种词根卡） */
const TEMPLATE_LABEL: Record<string, string> = {
  word_to_meaning: '见词 → 释义',
  meaning_to_word: '见释义 → 检索词形',
  word_to_morpheme: '见词 → 词素切分',
  morpheme_to_words: '见词根 → 派生词',
};

export default function LearnPage() {
  const { ready, session, wordMap, sentenceMap, settings, grade, known, reload } = useAppContext();
  const [genBusy, setGenBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [explain, setExplain] = useState<WordExplanation | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [quality, setQuality] = useState<SentenceQuality[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = session.queue;
  const card = queue[index];
  const word = card ? wordMap.get(card.wordId) : undefined;
  const sentence = card?.sentenceId ? sentenceMap.get(card.sentenceId) : undefined;

  useEffect(() => {
    setRevealed(false);
    setExplain(null);
    setExtra([]);
    setQuality([]);
    setError(null);
  }, [index, card?.id]);

  const submit = useCallback(
    async (value: number) => {
      if (!card) return;
      await grade(card, value);
      setIndex((i) => Math.min(i + 1, queue.length));
    },
    [card, grade, queue.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed(true);
      }
      const map: Record<string, number> = { Digit1: 0, Digit2: 3, Digit3: 4, Digit4: 5 };
      if (revealed && map[e.code] !== undefined) void submit(map[e.code]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, submit]);

  const askLlm = useCallback(async () => {
    if (!word) return;
    setBusy(true);
    setError(null);
    try {
      const [detail, examples] = await Promise.all([
        explainWord(settings.llm, word.lemma, sentence?.text),
        generateExamples(settings.llm, word.lemma, 3).catch(() => [] as string[]),
      ]);
      setExplain(detail);
      setExtra(examples);
      setQuality([]);

      // 决策模型校验例句（只判断、不生成）；失败时静默降级为全通过
      if (settings.decision.enabled && examples.length) {
        const checked = await checkSentences(settings.decision, {
          lemma: word.lemma,
          level: word.cefr,
          sense: detail.definitionL1 || detail.definitionEn,
          sentences: examples,
        });
        setQuality(checked);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '大模型请求失败');
    } finally {
      setBusy(false);
    }
  }, [word, sentence, settings.llm, settings.decision]);

  const shownExamples = useMemo(() => {
    if (!quality.length) return extra;
    return extra.filter((s) => quality.find((q) => q.sentence === s)?.pass !== false);
  }, [extra, quality]);

  const filteredOut = extra.length - shownExamples.length;

  if (!ready) {
    return <div className="py-24 text-center text-sm text-muted-foreground">正在准备本地词库…</div>;
  }

  if (!card) {
    return (
      <div className="py-24 text-center">
        <div className="text-lg font-semibold">今天的队列已完成 🎉</div>
        <p className="mt-2 text-sm text-muted-foreground">
          已掌握词族 {known.size} 个。复习是长线资产，明天见。
        </p>
        <Link href="/" className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm">
          <ArrowLeft className="size-4" /> 回到路径
        </Link>
      </div>
    );
  }

  const isReceptive = card.direction === 'receptive';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {index + 1} / {queue.length} · {isReceptive ? '识别方向' : '产出方向'}
          </span>
          <span>空格翻面 · 1/2/3/4 评分</span>
        </div>

        <div className="min-h-64 rounded-2xl border border-border/60 bg-card/50 p-8">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {TEMPLATE_LABEL[card.template] ?? (isReceptive ? '见词 → 释义' : '见释义 → 检索词形')}
          </div>
          <div className="mt-4 text-3xl font-semibold">{card.front}</div>

          {card.hint && (
            <div className="mt-6 rounded-lg bg-background/60 p-3 text-sm text-muted-foreground">
              {card.hint}
            </div>
          )}

          {revealed ? (
            <div className="mt-6 border-t border-border/60 pt-4">
              <div className="text-sm text-muted-foreground">答案</div>
              <div className="mt-1 text-xl font-medium">
                {card.back || '（释义待生成 · 见 SPEC 002）'}
              </div>
              {word && <div className="mt-2 text-sm text-muted-foreground">{word.definitionL1}</div>}
              {sentence && (
                <div className="mt-3 text-sm text-foreground/90">例句：{sentence.text}</div>
              )}
            </div>
          ) : (
            <button
              data-testid="reveal-btn"
              onClick={() => setRevealed(true)}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              先想起来，再翻面（提取练习）
            </button>
          )}
        </div>

        {revealed && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADE_OPTIONS.map((option) => (
              <button
                key={option.value}
                data-testid={`grade-${option.value}`}
                onClick={() => void submit(option.value)}
                className="rounded-lg border border-border bg-card/60 px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/10"
              >
                <div className="font-medium">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.hint}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">大模型辅助</div>
          {settings.llm.enabled ? (
            <span className="text-xs text-emerald-400">已启用 · {settings.llm.provider}</span>
          ) : (
            <Link href="/settings" className="text-xs text-primary hover:underline">
              去配置
            </Link>
          )}
        </div>

        {!settings.llm.enabled ? (
          <p className="text-xs text-muted-foreground">
            在设置页填入供应商与密钥后，可生成分级释义、多语境例句、搭配与易混辨析。
          </p>
        ) : (
          <>
            <button
              onClick={() => void askLlm()}
              disabled={busy || !word}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              {busy ? '生成中…' : '解析这个词'}
            </button>
            {!word && (
              <p className="text-xs text-muted-foreground">
                词根卡不绑定具体单词：正面是词根与核心义，背面是派生词列表（S-007）。
              </p>
            )}
          </>
        )}

        {word && isPending(word) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-400">这个词的释义待生成（S-002）</p>
            {settings.llm.enabled ? (
              <button
                data-testid="gen-def-btn"
                disabled={genBusy}
                onClick={async () => {
                  setGenBusy(true);
                  const result = await ensureDefinition(settings.llm, word.id);
                  if (result?.definitionStatus === 'ready') await reload();
                  setGenBusy(false);
                }}
                className="mt-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {genBusy ? '生成中…' : '生成释义'}
              </button>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">需先在设置页启用大模型</p>
            )}
          </div>
        )}

        {settings.decision.enabled && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            例句已启用决策模型校验（自然度阈值 {settings.decision.naturalThreshold.toFixed(2)}）
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {explain && (
          <div className="space-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">分级释义</div>
              <div>{explain.definitionEn}</div>
              <div className="text-xs text-muted-foreground">{explain.definitionL1}</div>
            </div>
            {explain.senses?.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">义项（按语料频率）</div>
                <ul className="mt-1 space-y-1">
                  {explain.senses.map((s) => (
                    <li key={s.order} className="rounded-md bg-background/50 p-2 text-xs">
                      <div>{s.definitionEn}</div>
                      <div className="text-muted-foreground">{s.example}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {explain.collocations?.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground">搭配</div>
                <div className="text-xs">{explain.collocations.join(' · ')}</div>
              </div>
            )}
          </div>
        )}

        {shownExamples.length > 0 && (
          <div className="text-sm">
            <div className="text-xs text-muted-foreground">不同语境例句</div>
            <ul className="mt-1 space-y-1 text-xs">
              {shownExamples.map((s) => {
                const q = quality.find((item) => item.sentence === s);
                return (
                  <li key={s} className="rounded-md bg-background/50 p-2">
                    {s}
                    {q && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        自然度 {q.natural.toFixed(2)} · 符合级别 {q.inLevel.toFixed(2)} · 义项{' '}
                        {q.usesSense.toFixed(2)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {filteredOut > 0 && (
              <div className="mt-1 text-[11px] text-amber-400">
                已过滤 {filteredOut} 条被决策模型判定不合格的例句
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
