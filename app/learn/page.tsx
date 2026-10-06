'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import { explainWord, generateExamples, type WordExplanation } from '@/lib/llm';
import { checkSentences, type SentenceQuality } from '@/lib/llm/decision';
import { ensureDefinition, isPending } from '@/lib/definitions';
import { JUDGE_TEXT, judgeAnswer, maskSentence } from '@/lib/utils';
import { buildQuiz, type Quiz } from '@/lib/quiz';
import type { Card, Morpheme } from '@/lib/types';

const MORPH_TYPE_TEXT: Record<string, string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
  combining_form: '组合形式',
};

/** 卡片模板 → 正面提示（S-007 新增两种词根卡） */
const TEMPLATE_LABEL: Record<string, string> = {
  word_to_meaning: '见词 → 释义',
  meaning_to_word: '见释义 → 检索词形',
  word_to_morpheme: '见词 → 词素切分',
  morpheme_to_words: '见词根 → 派生词',
};

/** 客观评分：答错一律记 lapse，答对按"良好"推进（不提供主观自评） */
const GRADE_WRONG = 0;
const GRADE_RIGHT = 4;

export default function LearnPage() {
  const {
    ready,
    session,
    words,
    wordMap,
    sentenceMap,
    settings,
    grade,
    known,
    profile,
    dueCount,
    reload,
  } = useAppContext();
  const [genBusy, setGenBusy] = useState(false);
  /** 本次会话成绩（完成页用；不参与排程） */
  const [tally, setTally] = useState({ correct: 0, wrong: 0 });
  const [index, setIndex] = useState(0);
  const [explain, setExplain] = useState<WordExplanation | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [quality, setQuality] = useState<SentenceQuality[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 学习者在页面上给出的答案：选择题下标 / 输入题文本 */
  const [picked, setPicked] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** 判定结果：null = 未作答 */
  const [judged, setJudged] = useState<'correct' | 'wrong' | null>(null);

  /** 只有能客观出图的卡才进队列；其余等释义 / 切分生成后自动出现 */
  const items = useMemo(() => {
    const out: { card: Card; quiz: Quiz }[] = [];
    for (const c of session.queue) {
      const quiz = buildQuiz(c, wordMap.get(c.wordId), words);
      if (quiz) out.push({ card: c, quiz });
    }
    return out;
  }, [session.queue, wordMap, words]);

  const skipped = session.queue.length - items.length;
  const current = items[index];
  const card = current?.card;
  const quiz = current?.quiz;
  const word = card ? wordMap.get(card.wordId) : undefined;
  const sentence = card?.sentenceId ? sentenceMap.get(card.sentenceId) : undefined;

  /** 词素表按需加载：答完后展示词素拆解与词源讲解（深入学习） */
  const [morphemes, setMorphemes] = useState<Morpheme[]>([]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const { morphemesRepo } = await import('@/lib/db');
      const rows = await morphemesRepo.all();
      if (alive) setMorphemes(rows);
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  const morphById = useMemo(() => new Map(morphemes.map((m) => [m.id, m])), [morphemes]);
  const decomposition = word?.decomposition ?? [];
  const rootEtymology = useMemo(
    () =>
      decomposition
        .map((ref) => morphById.get(ref.morphemeId))
        .find((m) => m?.type === 'root')?.explain?.etymology ?? '',
    [decomposition, morphById],
  );

  useEffect(() => {
    setPicked(null);
    setDraft('');
    setJudged(null);
    setExplain(null);
    setExtra([]);
    setQuality([]);
    setError(null);
  }, [index, card?.id]);

  /** 客观判定：选择题看是否命中答案集；输入题必须完全一致（"接近"也算错） */
  const evaluate = useCallback(
    (choiceIndex: number | null, text: string) => {
      if (!quiz) return false;
      if (quiz.kind === 'choice') {
        const choice = choiceIndex === null ? '' : quiz.choices?.[choiceIndex] ?? '';
        return !!choice && quiz.answers.includes(choice);
      }
      return judgeAnswer(text, quiz.answers) === 'exact';
    },
    [quiz],
  );

  const answerNow = useCallback(() => {
    if (!quiz) return;
    setJudged(evaluate(picked, draft) ? 'correct' : 'wrong');
  }, [quiz, evaluate, picked, draft]);

  const advance = useCallback(async () => {
    if (!card) return;
    const right = judged === 'correct';
    await grade(card, right ? GRADE_RIGHT : GRADE_WRONG);
    setTally((t) => (right ? { ...t, correct: t.correct + 1 } : { ...t, wrong: t.wrong + 1 }));
    setIndex((i) => Math.min(i + 1, items.length));
  }, [card, judged, grade, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || !quiz) return;
      // 正在输入框里写答案时，不能抢走空格与数字键
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (!judged) {
        if (quiz.kind === 'choice') {
          const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
          const choice = n >= 0 ? quiz.choices?.[n] : undefined;
          if (choice) {
            setPicked(n);
            setJudged(quiz.answers.includes(choice) ? 'correct' : 'wrong');
          }
        }
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        void advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, quiz, judged, advance]);

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
      setError(
        `${err instanceof Error ? err.message : '大模型请求失败'}（可在设置页点「测试连通」排查）`,
      );
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

  if (!card || !quiz) {
    return (
      <div className="py-24 text-center">
        <div className="text-lg font-semibold">今天的队列已完成 🎉</div>
        <p className="mt-3 text-sm">
          本次作答：答对 <b className="text-emerald-400">{tally.correct}</b> · 答错{' '}
          <b className="text-destructive">{tally.wrong}</b>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          累计掌握 {known.size} 个词族 · 估计水平 {profile.cefrEstimate} · 当前待复习 {dueCount} 张
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">
          一个词族要连续 4 轮答对（间隔 1 → 3 → 7 → 16 天）才算「已掌握」；
          今天只是把它们推进了第一轮，所以掌握数暂时还是 0 —— 这是 SRS 的正常节奏，不是没生效。
        </p>
        {skipped > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-amber-400">
              另有 {skipped} 张卡因释义或切分未生成，暂时无法客观出题；生成后会自动回到队列。
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-400"
            >
              去设置页批量生成释义
            </Link>
          </div>
        )}
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
            {index + 1} / {items.length} · {isReceptive ? '识别方向' : '产出方向'}
          </span>
          <span>{quiz.kind === 'choice' ? '按 1-4 选择 · 空格下一张' : '输入答案 · 回车提交'}</span>
        </div>

        {skipped > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
            有 {skipped} 张卡因释义或切分未生成，暂时无法客观作答（可在设置页批量生成释义）
          </div>
        )}

        <div className="min-h-64 rounded-2xl border border-border/60 bg-card/50 p-8">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {TEMPLATE_LABEL[card.template] ?? (isReceptive ? '见词 → 释义' : '见释义 → 检索词形')}
          </div>
          <div className="mt-4 text-3xl font-semibold">{card.front}</div>

          <div className="mt-3 text-xs text-primary">作答：{quiz.instruction}</div>

          {/* 正面是英文释义时补一行中文（受"显示中文释义"开关控制）：
              英文释义负责减少母语中介，中文只是卡住时的抓手 */}
          {card.template === 'meaning_to_word' &&
            settings.learning.showL1 &&
            word?.definitionL1 && (
              <div className="mt-2 text-sm text-muted-foreground">{word.definitionL1}</div>
            )}

          {/* 场景：例句把目标词挖空，给语境但不给答案 */}
          {!judged && sentence && (
            <div className="mt-6 rounded-lg bg-background/60 p-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">场景</div>
              <div className="mt-1 text-foreground/90">
                {maskSentence(sentence.text, word?.lemma ?? '')}
              </div>
            </div>
          )}

          {card.hint && (
            <div className="mt-6 rounded-lg bg-background/60 p-3 text-sm text-muted-foreground">
              {card.hint}
            </div>
          )}

          {quiz.kind === 'choice' ? (
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {quiz.choices?.map((choice, i) => {
                const isAnswer = quiz.answers.includes(choice);
                const isPicked = picked === i;
                let style = 'border-border hover:border-primary';
                if (judged) {
                  if (isAnswer) style = 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400';
                  else if (isPicked) style = 'border-destructive/60 bg-destructive/5 text-destructive';
                  else style = 'border-border opacity-50';
                } else if (isPicked) {
                  style = 'border-primary bg-primary/10';
                }
                return (
                  <button
                    key={choice}
                    data-testid={`choice-${i}`}
                    disabled={!!judged}
                    onClick={() => {
                      setPicked(i);
                      setJudged(isAnswer ? 'correct' : 'wrong');
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${style}`}
                  >
                    <span className="mr-2 text-xs text-muted-foreground">{i + 1}</span>
                    {choice}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2">
              <input
                data-testid="answer-input"
                value={draft}
                disabled={!!judged}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) answerNow();
                }}
                placeholder="输入答案后回车提交"
                className="min-w-52 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                data-testid="submit-answer"
                disabled={!draft.trim() || !!judged}
                onClick={answerNow}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                提交
              </button>
            </div>
          )}

          {judged && (
            <div className="mt-6 border-t border-border/60 pt-4">
              <div
                data-testid="answer-verdict"
                className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                  judged === 'correct'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-destructive/40 bg-destructive/5 text-destructive'
                }`}
              >
                {judged === 'correct' ? '✅ 正确' : '❌ 错误'}
                {quiz.kind === 'input' && draft.trim() ? (
                  <span>
                    {' '}
                    · 你写的是「{draft.trim()}」
                    {judgeAnswer(draft, quiz.answers) === 'near' ? `（${JUDGE_TEXT.near}）` : ''}
                  </span>
                ) : null}
                <div className="mt-1 text-xs opacity-80">正确答案：{quiz.display}</div>
              </div>
              {word && <div className="mt-2 text-sm text-muted-foreground">{word.definitionL1}</div>}
              {sentence && (
                <div className="mt-2 text-sm text-foreground/90">例句：{sentence.text}</div>
              )}

              {/* 词素拆解 + 词源讲解：把"为什么是这个意思"放在学习现场 */}
              {decomposition.length > 0 && (
                <div
                  className="mt-3 rounded-lg bg-background/60 p-3"
                  data-testid="morph-breakdown"
                >
                  <div className="text-xs text-muted-foreground">词素拆解</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {decomposition.map((ref) => {
                      const m = morphById.get(ref.morphemeId);
                      return (
                        <li key={`${ref.morphemeId}-${ref.allomorph}`}>
                          <b>{ref.allomorph}</b>
                          {m
                            ? ` · ${MORPH_TYPE_TEXT[m.type] ?? m.type} · ${m.coreMeaning}（${m.l1Gloss}）`
                            : ''}
                        </li>
                      );
                    })}
                  </ul>
                  {rootEtymology && (
                    <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                      {rootEtymology}
                    </p>
                  )}
                </div>
              )}
              <button
                data-testid="next-card"
                onClick={() => void advance()}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                {judged === 'correct' ? '下一张（已记录：答对）' : '记住了，下一张（已记录：答错）'}
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">看不懂？用大模型解析</div>
            <div className="text-xs text-muted-foreground">
              只帮你理解，不参与排程；先作答，需要时再用
            </div>
          </div>
          {settings.llm.enabled ? (
            <span className="text-xs text-emerald-400">已启用</span>
          ) : (
            <Link href="/settings" className="text-xs text-primary hover:underline">
              去配置
            </Link>
          )}
        </div>

        {/* 作答之前不展示解析入口：避免把"理解"当成学习流程的第一步 */}
        {!judged ? (
          <p className="text-xs text-muted-foreground">
            先在卡片上作答。答完后如果还不明白为什么是这个意思、或想知道搭配与易混辨析，
            可以在这里调用大模型。
          </p>
        ) : (
          <>
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
          </>
        )}
      </aside>
    </div>
  );
}
