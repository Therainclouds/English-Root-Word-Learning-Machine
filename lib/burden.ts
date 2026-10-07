'use client';

import { getSharedDb } from './db';
import { decide } from './llm/decision';
import type { DecisionConfig, Word, WordFamily } from './types';
import { clamp } from './utils';

/**
 * S-004 学习负担评分（决策模型）。
 *
 * 背景：`lib/data/seed.ts` 原本用 `lemma.length > 8 ? 3 : 2` 估算负担 —— 用词长代替学习难度
 * 是明显的失真，而 Nation 的 learning burden 是有明确输入维度的：形音匹配、拼写透明度、
 * 形态规则性、语义复杂度、搭配、与母语距离。这些正好是决策模型 `score` 的用途（D5）。
 *
 * 三条不可违背的约束：
 * 1. **不阻塞**：模型关闭 / 超时 / 低置信度 → 一律回退启发式，绝不打断学习流程
 * 2. **写回共享库**（D2）：一个人评分，所有人复用
 * 3. **只产出评分，不改排程**：负担如何进入间隔计算需要单独论证（见 spec 004）
 */

/** 启发式兜底：决策模型不可用时的近似值（即 S-004 之前的实现，保留以便对照与回退） */
export function heuristicBurden(lemma: string) {
  return clamp(lemma.length > 8 ? 3 : 2, 1, 5);
}

/** 置信度低于此值就忽略模型结果 */
export const MIN_CONFIDENCE = 0.5;

/**
 * 每批处理的词数上限（官方建议 questions ≤ 16）。
 * 注意：决策模型是「一个 state + 多个 question」的协议（`questions` 无法定位到 state 数组的某个元素），
 * 因此"批量"的实现是**逐个词请求 + 受控并发**，而不是一个请求塞多个词。
 */
export const BURDEN_BATCH_SIZE = 16;

/** 并发上限：决策模型通常有 QPS 限制，串行太慢、全开容易触发限流 */
export const BURDEN_CONCURRENCY = 3;

const BURDEN_CRITERIA = [
  '很容易：形音一致、拼写透明、中文有直接对应',
  '较容易：稍有拼写或发音不规则',
  '中等：多义或搭配受限',
  '较难：拼写与发音严重不对应，或抽象义为主',
  '很难：形近词多、语域受限、母语无对应概念',
];

export interface BurdenScore {
  familyId: string;
  lemma: string;
  /** 1–5 有序量表 */
  burden: number;
  confidence: number;
  source: 'model' | 'heuristic';
}

/** 受控并发映射（保持输入顺序） */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 给一个词族评分。模型不可用或置信度过低时返回启发式值（`source: 'heuristic'`）。
 */
export async function scoreBurden(
  cfg: DecisionConfig,
  family: WordFamily,
  word?: Word,
): Promise<BurdenScore> {
  const fallback: BurdenScore = {
    familyId: family.id,
    lemma: family.headword,
    burden: heuristicBurden(family.headword),
    confidence: 0,
    source: 'heuristic',
  };

  if (!cfg.enabled) return fallback;

  try {
    const result = await decide(
      cfg,
      {
        word: family.headword,
        pos: (word?.pos ?? family.pos ?? []).join(', '),
        ipa: word?.ipa ?? family.ipa ?? '',
        cefr: word?.cefr ?? family.cefr,
        /** 中文提示（若有）——母语对应概念的存在与否直接影响负担（Nation） */
        definition_l1: word?.definitionL1 ?? '',
      },
      {
        burden: {
          type: 'score',
          instructions: `对一个以中文为母语的学习者，记住这个英文词「${family.headword}」有多难？`,
          criteria: BURDEN_CRITERIA,
        },
        confusable: {
          type: 'noul',
          instructions: '这个词是否有常见形近词容易混淆？',
        },
      },
    );

    const answer = result.answers.burden;
    const score = answer?.score;
    const confidence = answer?.confidence ?? 0;
    if (typeof score !== 'number' || confidence < MIN_CONFIDENCE) return fallback;

    return {
      familyId: family.id,
      lemma: family.headword,
      burden: clamp(Math.round(score), 1, 5),
      confidence,
      source: 'model',
    };
  } catch {
    // 网络 / CORS / 限流一律静默回退：学习流程不能被评分阻塞
    return fallback;
  }
}

export interface BurdenBatchResult {
  total: number;
  fromModel: number;
  fallback: number;
  /** 返回值分布，便于确认"不是所有词都被打同一个分" */
  distribution: Record<string, number>;
  durationMs: number;
}

/**
 * 批量评分并写回共享库的 `wordFamilies.learningBurden`。
 *
 * @param limit 本次最多处理多少个词族
 */
export async function scoreBurdens(
  cfg: DecisionConfig,
  limit: number,
  onProgress?: (done: number, total: number) => void,
): Promise<BurdenBatchResult> {
  const startedAt = Date.now();
  const db = await getSharedDb();
  const families = (await db.getAll('wordFamilies')) as WordFamily[];
  const words = (await db.getAll('words')) as Word[];
  const wordByFamily = new Map(words.map((w) => [w.familyId, w]));

  const targets = families.slice(0, Math.max(0, limit));
  let done = 0;

  const scores = await mapLimit(targets, BURDEN_CONCURRENCY, async (family) => {
    const score = await scoreBurden(cfg, family, wordByFamily.get(family.id));
    done += 1;
    onProgress?.(done, targets.length);
    return score;
  });

  const updated: WordFamily[] = [];
  const distribution: Record<string, number> = {};
  let fromModel = 0;

  for (let i = 0; i < targets.length; i += 1) {
    const score = scores[i];
    if (score.source === 'model') fromModel += 1;
    distribution[String(score.burden)] = (distribution[String(score.burden)] ?? 0) + 1;
    if (targets[i].learningBurden !== score.burden) {
      updated.push({ ...targets[i], learningBurden: score.burden });
    }
  }

  if (updated.length) {
    const tx = db.transaction('wordFamilies', 'readwrite');
    for (const row of updated) tx.store.put(row);
    await tx.done;
  }

  return {
    total: targets.length,
    fromModel,
    fallback: targets.length - fromModel,
    distribution,
    durationMs: Date.now() - startedAt,
  };
}
