'use client';

import type { WordFamily } from './types';

/**
 * S-003 分级阅读：分词 + 生词率 + 着色
 *
 * 生词率以**词族**为判定单位。已知词族集合来自用户的 SRS 掌握度。
 * 由于词族表只登记了原形（members 多为 [lemma]），这里用轻量后缀还原
 * 作为近似匹配，避免把 inspected / quickly 误判为生词。
 */

/** 只保留字母、内部连字符与撇号，其余视为分隔 */
const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

export function normalizeToken(token: string) {
  return token.toLowerCase().replace(/^['’-]+|['’-]+$/g, '');
}

/**
 * 轻量后缀还原（非完整词形还原，仅用于降低误判）。
 * 返回按可信度排序的候选原形，命中任一即视为已知。
 */
export function lemmaCandidates(token: string): string[] {
  const word = normalizeToken(token);
  if (word.length < 3) return [word];

  const out = new Set<string>([word]);
  const add = (v: string) => {
    if (v.length >= 2) out.add(v);
  };

  if (word.endsWith("'s") || word.endsWith('’s')) add(word.slice(0, -2));
  if (word.endsWith('s')) {
    add(word.slice(0, -1));
    if (word.endsWith('es')) add(word.slice(0, -2));
    if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith('ed')) {
    add(word.slice(0, -2));
    add(word.slice(0, -1)); // 双写辅音：stopped → stopp(e)
    if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`);
  }
  if (word.endsWith('ing')) {
    add(word.slice(0, -3));
    add(`${word.slice(0, -3)}e`); // making → make
  }
  if (word.endsWith('ly')) add(word.slice(0, -2));
  if (word.endsWith('er')) add(word.slice(0, -2));
  if (word.endsWith('est')) add(word.slice(0, -3));
  return [...out];
}

/** 用户已知词族的原形集合 */
export function buildKnownLemmas(families: WordFamily[], knownFamilyIds: Set<string>) {
  const known = new Set<string>();
  for (const family of families) {
    if (!knownFamilyIds.has(family.id)) continue;
    for (const member of family.members.length ? family.members : [family.headword]) {
      known.add(normalizeToken(member));
    }
    known.add(normalizeToken(family.headword));
  }
  return known;
}

export interface TokenSpan {
  text: string;
  /** 是否为可判定/可点击的单词 */
  isWord: boolean;
  known: boolean;
  /** 用于查词的原形（best-effort） */
  lemma?: string;
}

export function isKnownToken(token: string, knownLemmas: Set<string>) {
  return lemmaCandidates(token).some((candidate) => knownLemmas.has(candidate));
}

/** 把原文切成 词 / 非词 片段，标注已知与否 */
export function segment(text: string, knownLemmas: Set<string>): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let cursor = 0;

  for (const match of text.matchAll(WORD_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      spans.push({ text: text.slice(cursor, start), isWord: false, known: true });
    }
    const raw = match[0];
    const candidates = lemmaCandidates(raw);
    const lemma = candidates.find((c) => knownLemmas.has(c)) ?? normalizeToken(raw);
    spans.push({
      text: raw,
      isWord: true,
      known: isKnownToken(raw, knownLemmas),
      lemma,
    });
    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), isWord: false, known: true });
  }
  return spans;
}

/** 生词率 = 未知词元 / 总词元（以词族为单位去重统计未知词形） */
export function unknownRate(spans: TokenSpan[]) {
  const words = spans.filter((s) => s.isWord);
  if (!words.length) {
    return { rate: 0, unknownWords: 0, totalWords: 0, unknownLemmas: [] as string[] };
  }
  const unknownLemmas = [...new Set(words.filter((s) => !s.known).map((s) => s.lemma ?? ''))].filter(Boolean);
  const unknownWords = words.filter((s) => !s.known).length;
  return {
    rate: unknownWords / words.length,
    unknownWords,
    totalWords: words.length,
    unknownLemmas,
  };
}

export const COMPREHENSIBLE_RANGE = { min: 0.02, max: 0.05 };

export type DifficultyVerdict = 'too_easy' | 'ideal' | 'too_hard';

export function verdictOf(rate: number): DifficultyVerdict {
  if (rate > COMPREHENSIBLE_RANGE.max) return 'too_hard';
  if (rate < COMPREHENSIBLE_RANGE.min) return 'too_easy';
  return 'ideal';
}

export const VERDICT_META: Record<DifficultyVerdict, { label: string; hint: string; tone: string }> = {
  too_easy: {
    label: '偏简单',
    hint: '生词率低于 2%，可读性很高但附带习得收益有限，适合练流利度',
    tone: 'text-sky-400',
  },
  ideal: {
    label: '难度合适',
    hint: '生词率落在 2%–5%，可理解输入与附带习得的最佳区间',
    tone: 'text-emerald-400',
  },
  too_hard: {
    label: '生词率过高',
    hint: '生词率超过 5%，建议先补充该频段词汇再回来读',
    tone: 'text-amber-400',
  },
};
