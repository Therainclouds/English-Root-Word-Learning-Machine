import type { Card, ReviewState } from './types';
import { clamp } from './utils';

/**
 * SM-2 排程（预留 FSRS 接口：替换本文件的 schedule 即可）。
 * 依据：间隔效应 + 提取练习；排程必须确定性，不能交给 LLM。
 */

export const GRADE_OPTIONS = [
  { value: 0, label: '忘了', hint: '完全想不起来' },
  { value: 3, label: '困难', hint: '想起来了但很吃力' },
  { value: 4, label: '良好', hint: '稍作思考后答对' },
  { value: 5, label: '简单', hint: '立刻答出' },
] as const;

/** 新卡前几次的间隔（天），符合"目标保持期的 10%-20%"缩放 */
const INITIAL_INTERVALS = [1, 3, 7, 16, 35];

export function createInitialState(card: Card, now = Date.now()): ReviewState {
  return {
    cardId: card.id,
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    lapses: 0,
    reps: 0,
    direction: card.direction,
    stability: 0,
    interleaveGroup: card.interleaveGroup,
  };
}

/** 核心排程：输入当前状态与评分，输出新状态 */
export function schedule(state: ReviewState, grade: number, now = Date.now()): ReviewState {
  const ef = updateEase(state.ease, grade);
  const next: ReviewState = { ...state, ease: ef, lastReviewedAt: now };

  if (grade < 3) {
    next.lapses = state.lapses + 1;
    next.reps = 0;
    next.intervalDays = 1;
  } else {
    next.reps = state.reps + 1;
    if (next.reps <= INITIAL_INTERVALS.length) {
      const factor = grade === 5 ? 1.3 : grade === 3 ? 0.8 : 1;
      next.intervalDays = Math.max(1, Math.round(INITIAL_INTERVALS[next.reps - 1] * factor));
    } else {
      const factor = grade === 5 ? 1.2 : grade === 3 ? 0.85 : 1;
      next.intervalDays = Math.max(1, Math.round(state.intervalDays * ef * factor));
    }
  }

  next.dueAt = now + next.intervalDays * 86400000;
  next.stability = computeStability(next.reps, next.lapses, grade);
  return next;
}

function updateEase(ease: number, grade: number) {
  const next = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  return clamp(Number(next.toFixed(3)), 1.3, 3.2);
}

function computeStability(reps: number, lapses: number, grade: number) {
  const base = reps === 0 ? 0 : 1 - 1 / (1 + reps);
  const penalty = Math.max(0, 1 - lapses * 0.12);
  const recency = grade < 3 ? 0.4 : grade === 3 ? 0.75 : 1;
  return clamp(base * penalty * recency, 0, 1);
}

export function isDue(state: ReviewState | undefined, now = Date.now()) {
  return !state || state.dueAt <= now;
}

/** 交错：同组不相邻登场 */
function interleave<T>(items: T[], groupOf: (t: T) => number): T[] {
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const g = groupOf(item);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(item);
  }
  const result: T[] = [];
  const keys = [...buckets.keys()];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const k of keys) {
      const bucket = buckets.get(k)!;
      if (bucket.length) {
        result.push(bucket.shift()!);
        remaining = true;
      }
    }
  }
  return result;
}

export interface SessionInput {
  cards: Card[];
  states: Map<string, ReviewState>;
  newLimit: number;
  learnedToday: number;
  now?: number;
}

/** 组一场学习：到期卡优先（按逾期程度），再补新卡（受每日上限约束），整体交错 */
export function buildSession({ cards, states, newLimit, learnedToday, now = Date.now() }: SessionInput) {
  const due: Card[] = [];
  const fresh: Card[] = [];

  for (const card of cards) {
    const state = states.get(card.id);
    if (!state) fresh.push(card);
    else if (state.dueAt <= now) due.push(card);
  }

  due.sort((a, b) => (states.get(a.id)!.dueAt ?? 0) - (states.get(b.id)!.dueAt ?? 0));

  const remainingNew = Math.max(0, newLimit - learnedToday);
  const newCards = fresh.slice(0, remainingNew);

  return {
    queue: [...interleave(due, (c) => c.interleaveGroup), ...interleave(newCards, (c) => c.interleaveGroup)],
    dueCount: due.length,
    newCount: newCards.length,
  };
}
