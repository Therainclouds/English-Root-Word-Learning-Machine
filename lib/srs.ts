import { createEmptyCard, fsrs, Rating, State, type Card as FsrsCard } from 'ts-fsrs';
import type { Card, ReviewState } from './types';
import { clamp } from './utils';

/**
 * 排程引擎：FSRS-6（`ts-fsrs`，MIT）。
 *
 * 依据 DSR 模型（Difficulty / Stability / Retrievability）+ 幂律遗忘曲线，
 * 21 个参数取官方默认值——那是在约 17 亿条真实复习记录上训练出来的
 * （见 `docs/learning-science.md` 与 specs/008）。不再使用 SM-2（1987）的
 * "ease × 固定乘数"：1987 年没有数据可用，现在有了。
 *
 * 保留的硬约束：排程必须是**确定性**的，不能交给 LLM（D4）。
 */

/** 客观判定只有两档（D12）：答错 = Again，答对 = Good */
function ratingOf(grade: number) {
  return grade >= 3 ? Rating.Good : Rating.Again;
}

/**
 * 调度器参数。
 *
 * - `enable_fuzz`：给长间隔加抖动，避免同批导入的卡永远撞在同一天到期
 * - `enable_short_term` + `learning_steps`：**启用分钟级学习步骤**（Anki 默认的同款语义
 *   `1m 10m`）。新卡先在分钟级巩固、再"毕业"到天级间隔；答错的卡 10 分钟后在同一会话内重现。
 *   官方基准显示同日复习恰是所有算法的软肋（FSRS-6 在含同日复习场景 log loss 由 0.3460 升到 0.3842），
 *   补上它比调参更有效。
 *   ⚠️ 前提：学习页必须是**快照式队列**（见 `app/learn/page.tsx`），否则分钟级到期卡会插到
 *   队列最前面、把用户正在答的题顶掉。
 * - `maximum_interval: 365`：一年封顶。实测默认参数下"连续答对 5 次"会排到 586 天后，
 *   对语言学习不现实；封顶后长间隔仍正常维持，只是不再无限拉长。
 */
export const FSRS_BASE_PARAMS = {
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
  maximum_interval: 365,
} as const;

/** 目标保持率可用区间：下限会让间隔夸张到失真，上限会让复习量爆炸 */
const RETENTION_RANGE: [number, number] = [0.7, 0.97];
const DEFAULT_RETENTION = 0.9;

let scheduler = fsrs({ ...FSRS_BASE_PARAMS, request_retention: DEFAULT_RETENTION });
/** 当前生效的保持率（ts-fsrs 的 FSRS 实例不暴露 params，自己记一份） */
let activeRetention = DEFAULT_RETENTION;

/**
 * 注入目标保持率 —— 让设置页的「目标保持率」滑块真正生效。
 *
 * 此前 `learning.retentionTarget` 是个摆设：设置页有滑块、类型里有字段、默认值也有，
 * 但排程代码从未读过它。FSRS 的 `request_retention` 正是它的归宿：
 * 实测 0.9 → 间隔序列 [14, 57, 196] 天，0.95 → [6, 15, 34] 天。
 *
 * @returns 实际生效的保持率（可能被夹到合法区间）
 */
export function configureScheduler(retention?: number) {
  const value = clamp(retention ?? DEFAULT_RETENTION, RETENTION_RANGE[0], RETENTION_RANGE[1]);
  scheduler = fsrs({ ...FSRS_BASE_PARAMS, request_retention: value });
  activeRetention = value;
  return value;
}

/** 当前生效的保持率（供界面回显与自检） */
export function currentRetention() {
  return activeRetention;
}

const DAY_MS = 86400000;

/**
 * 是否是 SM-2 时代的旧状态。
 * 旧 `stability` 是 0–1 的启发式掌握度，直接喂给 FSRS 会被当成"不到 1 天"，严重低估。
 */
function looksLegacy(state: ReviewState) {
  return state.reps > 0 && state.stability <= 1;
}

/**
 * 迁移旧状态：用 `intervalDays` 重新估计 S。
 * FSRS 的定义保证 I(0.9) = S，所以"上次被安排的间隔"就是 S 最合理的估计。
 */
function toFsrsCard(state: ReviewState): FsrsCard {
  const legacy = looksLegacy(state);
  return {
    due: new Date(state.dueAt),
    stability: legacy ? Math.max(1, state.intervalDays) : state.stability,
    difficulty: state.difficulty ?? 5,
    elapsed_days: state.elapsedDays ?? 0,
    scheduled_days: state.intervalDays,
    learning_steps: state.learningSteps ?? 0,
    reps: state.reps,
    lapses: state.lapses,
    state: (state.fsrsState ?? (state.reps > 0 ? State.Review : State.New)) as State,
    last_review: state.lastReviewedAt ? new Date(state.lastReviewedAt) : undefined,
  };
}

export function createInitialState(card: Card, now = Date.now()): ReviewState {
  const empty = createEmptyCard(new Date(now));
  return {
    cardId: card.id,
    dueAt: now,
    intervalDays: 0,
    lapses: 0,
    reps: 0,
    direction: card.direction,
    stability: empty.stability,
    difficulty: empty.difficulty,
    fsrsState: empty.state,
    learningSteps: 0,
    elapsedDays: 0,
    interleaveGroup: card.interleaveGroup,
  };
}

/** 核心排程：输入当前状态与评分，输出新状态 */
export function schedule(state: ReviewState, grade: number, now = Date.now()): ReviewState {
  const prev = toFsrsCard(state);
  const { card } = scheduler.next(prev, new Date(now), ratingOf(grade));

  // 自己算 elapsedDays：ts-fsrs 的 `card.elapsed_days` 已标记 deprecated，不依赖它
  const elapsedDays = state.lastReviewedAt
    ? Math.max(0, Math.round((now - state.lastReviewedAt) / DAY_MS))
    : 0;

  return {
    ...state,
    dueAt: card.due.getTime(),
    intervalDays: Math.max(0, card.scheduled_days),
    stability: card.stability,
    difficulty: card.difficulty,
    fsrsState: card.state,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    elapsedDays,
    lastReviewedAt: now,
  };
}

export function isDue(state: ReviewState | undefined, now = Date.now()) {
  return !state || state.dueAt <= now;
}

/* ---------------- 可提取性与真实保持率 ---------------- */

/**
 * FSRS-6 遗忘曲线：R(t,S) = (1 + factor · t/S)^(−w20)，
 * 其中 factor = 0.9^(−1/w20) − 1 保证 R(S,S) = 0.9。
 * w20 取官方默认参数集的第 21 个值（我们只使用默认参数集）。
 */
const DECAY = 0.1542;

export function forgettingCurve(elapsedDays: number, stabilityDays: number) {
  if (stabilityDays <= 0) return 0;
  const factor = Math.pow(0.9, -1 / DECAY) - 1;
  return Math.pow(1 + factor * (elapsedDays / stabilityDays), -DECAY);
}

/** 某张卡当前的可提取性（0–1）：0 = 完全忘了，1 = 刚复习完 */
export function retrievability(state: ReviewState | undefined, now = Date.now()) {
  if (!state) return 0;
  if (state.reps === 0 || state.stability <= 0) return 1;
  const elapsed = Math.max(0, (now - (state.lastReviewedAt ?? now)) / DAY_MS);
  return forgettingCurve(elapsed, state.stability);
}

export interface RetentionStats {
  /** 实测保持率（0–1）；样本为 0 时返回 null */
  rate: number | null;
  /** 参与统计的复习次数 */
  sample: number;
  /** 样本是否足够（< 20 次只作参考） */
  enough: boolean;
}

/**
 * 「我的真实保持率」：最近 N 次复习里答对的比例。
 *
 * 为什么值得单独做：官方基准显示 MOVING-AVG（零参数，只用"用户近期的平均保持率"）
 * 的预测误差 0.3369，几乎追平最强配置 FSRS-7 recency（0.3363）——
 * 也就是说**"这个人整体是什么水平"比算法结构更决定预测能力**。
 * 把这个数字直接摊给学习者看，是零参数、零风险的收益。
 */
export function retentionOf(logs: { grade: number }[], windowSize = 100): RetentionStats {
  const recent = logs.slice(-windowSize);
  if (!recent.length) return { rate: null, sample: 0, enough: false };
  const hit = recent.filter((l) => l.grade >= 3).length;
  return { rate: hit / recent.length, sample: recent.length, enough: recent.length >= 20 };
}

/* ---------------- 组卷 ---------------- */

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

/**
 * 会话队列推进（纯函数，学习页与离线自检共用）。
 *
 * 把"已到期但不在队列里"的卡追加到**队尾**：启用分钟级学习步骤后，答错的卡会在
 * 1 / 10 分钟后到期，它应当在同一会话里重现——但不能插到队首，否则用户正答着的题会被顶掉。
 * 抽成纯函数是为了让这个行为能被离线验收覆盖（否则只能靠等 1 分钟的真实时钟）。
 *
 * @param queueIds   当前会话队列（cardId 顺序）
 * @param candidates 候选卡（通常是本次 `session.queue`）
 * @param dueAtOf    取某张卡的到期时间（无状态返回 Infinity，即视为未到期）
 * @returns 新队列；无变化时返回**原引用**，便于 `setState` 跳过更新
 */
export function reviveDue(
  queueIds: string[],
  candidates: { id: string }[],
  dueAtOf: (id: string) => number,
  now = Date.now(),
) {
  const inQueue = new Set(queueIds);
  const revived: string[] = [];
  for (const c of candidates) {
    if (inQueue.has(c.id)) continue;
    if (dueAtOf(c.id) <= now) revived.push(c.id);
  }
  return revived.length ? [...queueIds, ...revived] : queueIds;
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
