'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Sparkles, CheckCircle2 } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import { explainWord, type WordExplanation } from '@/lib/llm';
import { ensureDefinition, isPending } from '@/lib/definitions';
import type { Morpheme } from '@/lib/types';

/** 词素类型中文标签（S-007 词根浏览器） */
const MORPH_TYPE_LABEL: Record<string, string> = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
  combining_form: '组合形式',
};

const ORIGIN_LABEL: Record<string, string> = {
  latin: '拉丁',
  greek: '希腊',
  old_english: '古英语',
  french: '法语',
  other: '其他',
};

export default function LibraryPage() {
  const { ready, families, words, wordMap, sentenceMap, known, settings, reload } = useAppContext();
  const [mode, setMode] = useState<'family' | 'morpheme'>('family');
  const [morphemes, setMorphemes] = useState<Morpheme[]>([]);
  const [activeMorphId, setActiveMorphId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [explain, setExplain] = useState<WordExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  // 词素不在全局状态里（只有导入后才存在），按需读共享库
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
  }, [ready, families.length, words.length]);

  const sorted = useMemo(() => [...families].sort((a, b) => a.freqRank - b.freqRank), [families]);

  /** 词素按派生力降序：先学能带出一串词的 */
  const sortedMorphemes = useMemo(
    () => [...morphemes].sort((a, b) => b.productivity - a.productivity),
    [morphemes],
  );

  const filteredMorphemes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedMorphemes;
    return sortedMorphemes.filter(
      (m) =>
        m.form.toLowerCase().includes(q) ||
        m.l1Gloss.includes(q) ||
        m.coreMeaning.toLowerCase().includes(q),
    );
  }, [sortedMorphemes, query]);

  const activeMorpheme = activeMorphId
    ? morphemes.find((m) => m.id === activeMorphId) ?? null
    : null;

  /** 反查派生词：词的切分里引用了该词素 */
  const derivatives = useMemo(() => {
    if (!activeMorpheme) return [];
    return words.filter((w) => w.decomposition?.some((r) => r.morphemeId === activeMorpheme.id));
  }, [activeMorpheme, words]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((f) => f.headword.toLowerCase().includes(q));
  }, [sorted, query]);

  const activeFamily = activeId ? sorted.find((f) => f.id === activeId) ?? null : null;
  const activeWord = activeFamily ? wordMap.get(`w.${activeFamily.headword.replace(/\s+/g, '_')}`) : undefined;
  const activeSentence = useMemo(
    () => (activeWord ? [...sentenceMap.values()].find((s) => s.targetWordIds.includes(activeWord.id)) : undefined),
    [activeWord, sentenceMap],
  );

  const ask = async () => {
    if (!activeWord) return;
    setBusy(true);
    setError(null);
    try {
      setExplain(await explainWord(settings.llm, activeWord.lemma, activeSentence?.text));
    } catch (err) {
      setError(err instanceof Error ? err.message : '大模型请求失败');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return <div className="py-24 text-center text-sm text-muted-foreground">正在准备本地词库…</div>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <section className="space-y-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card/40 p-1">
          <button
            data-testid="lib-tab-family"
            onClick={() => setMode('family')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === 'family' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            词族
          </button>
          <button
            data-testid="lib-tab-morpheme"
            onClick={() => setMode('morpheme')}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === 'morpheme' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            词根（{morphemes.length}）
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            data-testid="library-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'family' ? '搜索词族（按词频排序）' : '搜索词根 / 中文义 / 英文核心义'}
            className="w-full rounded-lg border border-border bg-card/50 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>

        {mode === 'morpheme' && (
          <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-xl border border-border/60 bg-card/40 p-2">
            {filteredMorphemes.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {morphemes.length === 0
                  ? '还没有词根数据：请在设置页点「导入词根库并切分词库」'
                  : '没有匹配的词根'}
              </p>
            ) : (
              filteredMorphemes.map((m) => (
                <button
                  key={m.id}
                  data-testid="morph-item"
                  onClick={() => setActiveMorphId(m.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    activeMorphId === m.id ? 'bg-primary/15 text-primary' : 'hover:bg-accent'
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-medium">{m.form}</span>
                    <span className="text-xs text-muted-foreground">{m.l1Gloss}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {MORPH_TYPE_LABEL[m.type] ?? m.type} · {m.productivity}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        <div
          className={`max-h-[60vh] space-y-1 overflow-y-auto rounded-xl border border-border/60 bg-card/40 p-2 ${
            mode === 'morpheme' ? 'hidden' : ''
          }`}
        >
          {filtered.map((family) => {
            const isKnown = known.has(family.id);
            return (
              <button
                key={family.id}
                data-testid="library-item"
                onClick={() => {
                  setActiveId(family.id);
                  setExplain(null);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeId === family.id ? 'bg-primary/15 text-primary' : 'hover:bg-accent'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{family.headword}</span>
                  <span className="text-xs text-muted-foreground">{family.freqBand}</span>
                </span>
                {isKnown && <CheckCircle2 className="size-4 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
        {mode === 'morpheme' ? (
          !activeMorpheme ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              左侧选择一个词根，查看它的派生词与助记（S-007）
            </div>
          ) : (
            <div className="space-y-4" data-testid="morph-detail">
              <div>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-2xl font-semibold">{activeMorpheme.form}</h2>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {MORPH_TYPE_LABEL[activeMorpheme.type] ?? activeMorpheme.type}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {ORIGIN_LABEL[activeMorpheme.origin] ?? activeMorpheme.origin} · {activeMorpheme.etymon}
                  </span>
                </div>
                <p className="mt-2 text-sm">{activeMorpheme.coreMeaning}</p>
                <p className="text-sm text-muted-foreground">{activeMorpheme.l1Gloss}</p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {activeMorpheme.allomorphs.map((a) => (
                  <span key={a} className="rounded-md bg-background/60 px-2 py-0.5 text-xs">
                    {a}
                  </span>
                ))}
              </div>

              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div>派生力：{activeMorpheme.productivity}</div>
                <div>覆盖率增益：{(activeMorpheme.coverageGain * 100).toFixed(2)}%</div>
                <div>负担：{activeMorpheme.difficulty}/5 · 可信度 {activeMorpheme.confidence.toFixed(2)}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">
                  派生词（{derivatives.length}）
                </div>
                {derivatives.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    共享词库里还没有切出含该词素的词
                  </p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {derivatives.map((w) => (
                      <button
                        key={w.id}
                        data-testid="morph-derivative"
                        onClick={() => {
                          setMode('family');
                          setQuery('');
                          setActiveId(w.familyId);
                          setExplain(null);
                        }}
                        className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs hover:border-primary"
                      >
                        {w.lemma}
                        {w.literalGlue && !w.literalGlue.includes('[') ? (
                          <span className="ml-1 text-muted-foreground">· {w.literalGlue}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {activeMorpheme.mnemonic?.story ? (
                <div className="rounded-lg bg-background/60 p-3 text-sm">
                  <div className="text-xs text-muted-foreground">助记</div>
                  {activeMorpheme.mnemonic.story}
                  {activeMorpheme.mnemonic.cognate && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      同源词：{activeMorpheme.mnemonic.cognate}
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                  暂无助记。在设置页启用大模型后点「批量补全词根助记」即可生成（写入共享库，不会重复请求）。
                </p>
              )}

              {activeMorpheme.confusingWith.length > 0 && (
                <div className="rounded-lg bg-background/50 p-3 text-xs">
                  <span className="text-muted-foreground">易混：</span>
                  {activeMorpheme.confusingWith
                    .map((id) => morphemes.find((m) => m.id === id)?.form ?? id)
                    .join(' · ')}
                </div>
              )}
            </div>
          )
        ) : !activeWord ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            左侧选择一个词族查看详情
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-semibold">{activeWord.lemma}</h2>
                <span className="text-sm text-muted-foreground">{activeWord.ipa}</span>
                {activeFamily && known.has(activeFamily.id) && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">已掌握</span>
                )}
              </div>
              {isPending(activeWord) ? (
                <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs text-amber-400">
                    释义待生成（S-002）。生成后写入共享词库，所有人复用。
                  </p>
                  {settings.llm.enabled ? (
                    <button
                      data-testid="gen-def-btn"
                      disabled={genBusy}
                      onClick={async () => {
                        setGenBusy(true);
                        setGenMsg(null);
                        const result = await ensureDefinition(settings.llm, activeWord.id);
                        if (result?.definitionStatus === 'ready') {
                          setGenMsg('已生成并写入共享词库');
                          await reload();
                        } else {
                          setGenMsg('生成失败：请检查大模型配置或稍后重试');
                        }
                        setGenBusy(false);
                      }}
                      className="mt-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      {genBusy ? '生成中…' : '生成释义'}
                    </button>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      需先在设置页启用大模型
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <p className="mt-2 text-sm">{activeWord.definitionEn}</p>
                  {settings.learning.showL1 && (
                    <p className="text-sm text-muted-foreground">{activeWord.definitionL1}</p>
                  )}
                </>
              )}
              {/* 生成结果放在条件块之外：生成成功后 pending 面板会消失，提示必须仍然可见 */}
              {genMsg && (
                <p
                  data-testid="gen-def-msg"
                  className="mt-2 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400"
                >
                  {genMsg}
                </p>
              )}
            </div>

            {activeSentence && (
              <div className="rounded-lg bg-background/60 p-3 text-sm">
                <div className="text-xs text-muted-foreground">例句</div>
                {activeSentence.text}
              </div>
            )}

            {settings.llm.enabled ? (
              <button
                onClick={() => void ask()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm disabled:opacity-50"
              >
                <Sparkles className="size-4" /> {busy ? '生成中…' : '用大模型扩展解析'}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">在设置页启用大模型后，可获取义项、搭配与辨析。</p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {explain && (
              <div className="space-y-3 text-sm">
                <div className="rounded-lg bg-background/50 p-3">
                  <div className="text-xs text-muted-foreground">义项（按频率）</div>
                  {explain.senses?.map((s) => (
                    <div key={s.order} className="mt-1">
                      <div>{s.definitionEn} — {s.definitionL1}</div>
                      <div className="text-xs text-muted-foreground">{s.example}</div>
                    </div>
                  ))}
                </div>
                {explain.collocations?.length > 0 && (
                  <div className="rounded-lg bg-background/50 p-3 text-xs">
                    <span className="text-muted-foreground">搭配：</span>
                    {explain.collocations.join(' · ')}
                  </div>
                )}
                {explain.confusions?.length > 0 && (
                  <div className="rounded-lg bg-background/50 p-3 text-xs">
                    <span className="text-muted-foreground">易混：</span>
                    {explain.confusions.join(' · ')}
                  </div>
                )}
                {explain.mnemonic && (
                  <div className="rounded-lg bg-background/50 p-3 text-xs">
                    <span className="text-muted-foreground">记忆线索：</span>
                    {explain.mnemonic}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
