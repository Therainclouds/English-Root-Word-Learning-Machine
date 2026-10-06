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
  // 客观判定只有"对 / 错"两档（D12）。若按 SM-2 原始公式把答错当作 q=0，
  // 一次失误就扣 0.8 的 ease（2.5 → 1.7，两次触底 1.3），此后即便一路答对，
  // 间隔按 ef 缩放也几乎不再增长 —— 两次手滑等于这个词永久报废。
  // 这里把答对映射为 q=4（ease 不变）、答错映射为 q=2（−0.32），方向不变但留出恢复空间；
  // grade 5 仍按 q=5 处理，供将来恢复难度自评时使用。
  const q = grade >= 5 ? 5 : grade >= 3 ? 4 : 2;
  const next = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  return clamp(Number(next.toFixed(3)), 1.3, 3.2);
}

function computeStability(reps: number, lapses: number, grade: number) {
  const base = reps === 0 ? 0 : 1 - 1 / (1 + reps);
  // 失误惩罚：0.12/次会让"错过一次"的词族需要连续答对约 10 次才够到
  // path.ts 的掌握线（stability ≥ 0.8），体感是永远解锁不了。降为 0.06/次后约 6 次。
  const penalty = Math.max(0, 1 - lapses * 0.06);
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
  /** 词根卡独立每日新卡预算（D11） */
  morphNewLimit?: number;
  /** 今日已学的词根卡数量 */
  morphLearnedToday?: number;
  now?: number;
}

/** 词根卡（S-007）：与阶段 1 高频词卡分开计量，避免挤占复习预算（D11） */
export function isMorphemeCard(card: Card) {
  return card.template === 'word_to_morpheme' || card.template === 'morpheme_to_words';
}

/**
 * 词根卡的独立每日新卡预算（D11）。
 * 默认 5：词根卡单卡信息量大（一次要读词源、异形、派生词），
 * 且切分词已达 257 个（约 500 张卡），不设上限会瞬间淹没阶段 1 的高频词。
 */
export const MORPH_DAILY_NEW_LIMIT = 5;

/**
 * 新卡按「识别 → 产出」交替排列。
 * 之前直接按 cards 原序取（`w.xx:prod` 在 `w.xx:rec` 之前，因为 'p' < 'r'），
 * 结果一整批新卡全是产出方向 —— 新手还没认过这个词就要拼出来，连续答错。
 * 先认后说：同一词的两张卡相邻出现，也更符合"能认 ≠ 能说"的双向设计。
 */
function alternateDirections(list: Card[]): Card[] {
  const rec = list.filter((c) => c.direction === 'receptive');
  const prod = list.filter((c) => c.direction === 'productive');
  const out: Card[] = [];
  for (let i = 0; i < Math.max(rec.length, prod.length); i += 1) {
    if (rec[i]) out.push(rec[i]);
    if (prod[i]) out.push(prod[i]);
  }
  return out;
}

/** 组一场学习：到期卡优先（按逾期程度），再补新卡（受每日上限约束），整体交错 */
export function buildSession({
  cards,
  states,
  newLimit,
  learnedToday,
  morphNewLimit = MORPH_DAILY_NEW_LIMIT,
  morphLearnedToday = 0,
  now = Date.now(),
}: SessionInput) {
  const due: Card[] = [];
  const fresh: Card[] = [];
  const freshMorph: Card[] = [];

  for (const card of cards) {
    const state = states.get(card.id);
    if (!state) {
      // 新卡按来源分池：词根卡不占阶段 1 的额度（D11）
      if (isMorphemeCard(card)) freshMorph.push(card);
      else fresh.push(card);
    } else if (state.dueAt <= now) {
      due.push(card);
    }
  }

  due.sort((a, b) => (states.get(a.id)!.dueAt ?? 0) - (states.get(b.id)!.dueAt ?? 0));

  const remainingNew = Math.max(0, newLimit - learnedToday);
  const remainingMorph = Math.max(0, morphNewLimit - morphLearnedToday);
  const stage1New = alternateDirections(fresh).slice(0, remainingNew);
  const morphNew = alternateDirections(freshMorph).slice(0, remainingMorph);
  const newCards = [...stage1New, ...morphNew];

  return {
    queue: [...interleave(due, (c) => c.interleaveGroup), ...interleave(newCards, (c) => c.interleaveGroup)],
    dueCount: due.length,
    newCount: newCards.length,
    morphNewCount: morphNew.length,
    morphDueCount: due.filter(isMorphemeCard).length,
  };
}
