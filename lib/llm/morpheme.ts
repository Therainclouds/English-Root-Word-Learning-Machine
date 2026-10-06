'use client';

import { getSharedDb } from '../db';
import { needsGlue, needsMnemonic } from '../data/morph-segment';
import { createProvider, parseJsonLoose } from './index';
import type { Card, LlmConfig, Morpheme, Word } from '../types';

export { needsGlue, needsMnemonic };

/**
 * S-007 词根内容按需生成（D10）
 *
 * 边界：切分由确定性代码完成，LLM 只补两样「锦上添花」的内容：
 *   1. 词素助记 `mnemonic`（故事 + 同源词）
 *   2. `literalGlue` 的自然语言润色（规则版是 "[in] into, in + [spect] to look, see"）
 * 结果写回**共享库**，同词素不会重复请求；失败保持原状，不阻塞学习。
 */

const inflightMnemonic = new Map<string, Promise<Morpheme | null>>();
const inflightGlue = new Map<string, Promise<Word | null>>();
const inflightExplain = new Map<string, Promise<Morpheme | null>>();

const MNEMONIC_SYSTEM = `You are an expert in English etymology, teaching a Chinese-speaking learner.
Rules:
- story: write in Chinese, at most 60 characters, concrete and visual, built on the core meaning.
- cognate: one everyday English word that shares this root, or "" if none.
- Output the JSON object directly. No prose, no markdown fences, no <think> tags.
- JSON shape: {"story":string,"cognate":string}`;

const GLUE_SYSTEM = `You explain how the parts of an English word combine into its literal meaning.
Rules:
- Answer with ONE short English phrase, max 8 words, e.g. "to look into" / "to send away".
- No quotes, no trailing period, no restating the word itself.
- Output the JSON object directly: {"glue":string}`;

function isValidMnemonic(value: { story?: string; cognate?: string } | null) {
  const story = value?.story?.trim() ?? '';
  return story.length > 0 && story.length <= 120;
}

const EXPLAIN_SYSTEM = `You are an expert English etymology teacher writing for Chinese-speaking learners.
Write in Chinese. Be concrete — explain the causal chain of meaning change, not just a translation.

Requirements:
- etymology: how the original sense evolved into the modern one (2-3 sentences). State the Latin/Greek original meaning and what it turned into.
- allomorphNote: where the variant forms come from (sound change / assimilation / Latin vs French channel).
- derivatives: 4-5 items whose gloss MUST follow "前缀(义) + 词根(义) → 字面义 → 现代义",
  e.g. "report = re(back) + port(carry) → 把消息带回来 → 报告".
- confusion: the DISTINGUISHING point against the nearest confusing root — not a definition of each.

Output the JSON object directly. No prose, no markdown fences, no <think> tags.
JSON shape: {"etymology":string,"allomorphNote":string,"derivatives":[{"word":string,"gloss":string}],"confusion":string}`;

function isValidExplain(value: Morpheme['explain'] | null | undefined) {
  const etymology = value?.etymology?.trim() ?? '';
  return etymology.length >= 30 && etymology.length <= 600;
}

/** 缺讲解才生成（幂等） */
export function needsExplain(morpheme: Morpheme | undefined) {
  return !!morpheme && !morpheme.explain?.etymology?.trim();
}

function isValidGlue(value: { glue?: string } | null) {
  const glue = value?.glue?.trim() ?? '';
  return glue.length > 0 && glue.length <= 80 && !glue.includes('[');
}

/** 收集该词素的派生词样本（给 LLM 作为语境） */
async function sampleDerivatives(morphemeId: string, limit = 5): Promise<string[]> {
  const db = await getSharedDb();
  const words = (await db.getAll('words')) as Word[];
  const out: string[] = [];
  for (const word of words) {
    if (out.length >= limit) break;
    if (word.decomposition?.some((r) => r.morphemeId === morphemeId)) out.push(word.lemma);
  }
  return out;
}

export async function ensureMnemonic(cfg: LlmConfig, morphemeId: string): Promise<Morpheme | null> {
  const db = await getSharedDb();
  const morpheme = (await db.get('morphemes', morphemeId)) as Morpheme | undefined;
  if (!morpheme || !needsMnemonic(morpheme)) return morpheme ?? null;

  const pending = inflightMnemonic.get(morphemeId);
  if (pending) return pending;

  const task = (async (): Promise<Morpheme | null> => {
    try {
      const samples = await sampleDerivatives(morphemeId);
      const provider = createProvider(cfg);
      const raw = await provider.chat([
        { role: 'system', content: MNEMONIC_SYSTEM },
        {
          role: 'user',
          content:
            `Morpheme: ${morpheme.form} (${morpheme.type})\n` +
            `Origin: ${morpheme.origin} · Etymon: ${morpheme.etymon}\n` +
            `Core meaning: ${morpheme.coreMeaning}\n` +
            (samples.length ? `Example words: ${samples.join(', ')}` : ''),
        },
      ]);
      const parsed = parseJsonLoose<{ story?: string; cognate?: string }>(raw);
      if (!isValidMnemonic(parsed)) return morpheme;

      const updated: Morpheme = {
        ...morpheme,
        mnemonic: { story: parsed.story!.trim(), cognate: parsed.cognate?.trim() || undefined },
      };
      await db.put('morphemes', updated);
      return updated;
    } catch {
      return morpheme; // 失败保持原状
    } finally {
      inflightMnemonic.delete(morphemeId);
    }
  })();

  inflightMnemonic.set(morphemeId, task);
  return task;
}

/**
 * 生成词素的深度讲解（词源演变 / 异形成因 / 派生词逐词讲解 / 易混辨析）。
 * 结构对齐 lib/data/morphemes.ts 中手写的标杆，保证全库口吻一致。
 */
export async function ensureExplanation(
  cfg: LlmConfig,
  morphemeId: string,
): Promise<Morpheme | null> {
  const db = await getSharedDb();
  const morpheme = (await db.get('morphemes', morphemeId)) as Morpheme | undefined;
  if (!morpheme || !needsExplain(morpheme)) return morpheme ?? null;

  const pending = inflightExplain.get(morphemeId);
  if (pending) return pending;

  const task = (async (): Promise<Morpheme | null> => {
    try {
      const samples = await sampleDerivatives(morphemeId, 6);
      const provider = createProvider(cfg);
      const raw = await provider.chat([
        { role: 'system', content: EXPLAIN_SYSTEM },
        {
          role: 'user',
          content:
            `Morpheme: ${morpheme.form} (${morpheme.type})\n` +
            `Origin: ${morpheme.origin} · Etymon: ${morpheme.etymon}\n` +
            `Core meaning: ${morpheme.coreMeaning}\n` +
            `Chinese gloss: ${morpheme.l1Gloss}\n` +
            `Variant forms: ${morpheme.allomorphs.join(' / ')}\n` +
            (samples.length ? `Words in our database: ${samples.join(', ')}` : ''),
        },
      ]);
      const parsed = parseJsonLoose<Morpheme['explain']>(raw);
      if (!isValidExplain(parsed)) return morpheme;

      const updated: Morpheme = {
        ...morpheme,
        explain: {
          etymology: parsed!.etymology.trim(),
          allomorphNote: parsed!.allomorphNote?.trim() || undefined,
          derivatives: (parsed!.derivatives ?? [])
            .filter((d) => d?.word && d?.gloss)
            .slice(0, 6)
            .map((d) => ({ word: d.word.trim(), gloss: d.gloss.trim() })),
          confusion: parsed!.confusion?.trim() || undefined,
        },
      };
      await db.put('morphemes', updated);
      return updated;
    } catch {
      return morpheme; // 失败保持原状
    } finally {
      inflightExplain.delete(morphemeId);
    }
  })();

  inflightExplain.set(morphemeId, task);
  return task;
}

/** 批量补全讲解：按派生力降序，跳过已手写标杆的那些，串行执行 */
export async function ensureMorphemeExplanations(
  cfg: LlmConfig,
  limit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  const db = await getSharedDb();
  const all = (await db.getAll('morphemes')) as Morpheme[];
  const targets = all
    .filter(needsExplain)
    .sort((a, b) => b.productivity - a.productivity)
    .slice(0, Math.max(0, limit))
    .map((m) => m.id);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const result = await ensureExplanation(cfg, targets[i]);
    if (result && !needsExplain(result)) ok += 1;
    else failed += 1;
    onProgress?.(i + 1, targets.length);
  }
  return { ok, failed };
}

export async function ensureGlue(cfg: LlmConfig, wordId: string): Promise<Word | null> {
  const db = await getSharedDb();
  const word = (await db.get('words', wordId)) as Word | undefined;
  if (!word || !needsGlue(word)) return word ?? null;

  const pending = inflightGlue.get(wordId);
  if (pending) return pending;

  const task = (async (): Promise<Word | null> => {
    try {
      const morphemes = (await db.getAll('morphemes')) as Morpheme[];
      const byId = new Map(morphemes.map((m) => [m.id, m]));
      const parts = (word.decomposition ?? [])
        .map((ref) => `${ref.allomorph}(${byId.get(ref.morphemeId)?.coreMeaning ?? '?'})`)
        .join(' + ');

      const provider = createProvider(cfg);
      const raw = await provider.chat([
        { role: 'system', content: GLUE_SYSTEM },
        {
          role: 'user',
          content: `Word: ${word.lemma}\nParts: ${parts}\nCurrent literal meaning: ${word.literalGlue ?? ''}`,
        },
      ]);
      const parsed = parseJsonLoose<{ glue?: string }>(raw);
      if (!isValidGlue(parsed)) return word;

      const glue = parsed.glue!.trim();
      const updated: Word = { ...word, literalGlue: glue };

      const tx = db.transaction(['words', 'cards'], 'readwrite');
      tx.objectStore('words').put(updated);
      const cardId = `w.${word.lemma.replace(/\s+/g, '_')}:morph`;
      const card = (await tx.objectStore('cards').get(cardId)) as Card | undefined;
      if (card) {
        const refsText = (word.decomposition ?? []).map((r) => r.allomorph).join(' + ');
        tx.objectStore('cards').put({ ...card, back: `${refsText} — ${glue}`, hint: glue });
      }
      await tx.done;
      return updated;
    } catch {
      return word;
    } finally {
      inflightGlue.delete(wordId);
    }
  })();

  inflightGlue.set(wordId, task);
  return task;
}

/**
 * 批量补全词素助记：按 productivity 降序取前 limit 个缺失的词素，串行执行。
 * 写回共享库（D2），不触碰任何人的学习状态。
 */
export async function ensureMorphemeMnemonics(
  cfg: LlmConfig,
  limit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  const db = await getSharedDb();
  const all = (await db.getAll('morphemes')) as Morpheme[];
  const targets = all
    .filter(needsMnemonic)
    .sort((a, b) => b.productivity - a.productivity)
    .slice(0, Math.max(0, limit))
    .map((m) => m.id);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const result = await ensureMnemonic(cfg, targets[i]);
    if (result && !needsMnemonic(result)) ok += 1;
    else failed += 1;
    onProgress?.(i + 1, targets.length);
  }
  return { ok, failed };
}

/** 批量润色字面义：只处理规则版（含方括号）且已切分的词 */
export async function ensureLiteralGlues(
  cfg: LlmConfig,
  limit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  const db = await getSharedDb();
  const words = (await db.getAll('words')) as Word[];
  const targets = words.filter(needsGlue).slice(0, Math.max(0, limit)).map((w) => w.id);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const result = await ensureGlue(cfg, targets[i]);
    if (result && !needsGlue(result)) ok += 1;
    else failed += 1;
    onProgress?.(i + 1, targets.length);
  }
  return { ok, failed };
}
