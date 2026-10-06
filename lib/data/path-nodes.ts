import type { PathNode, WordFamily } from '../types';

/**
 * 可视化学习路径的节点与依赖（Canvas 坐标，逻辑像素）。
 * 三阶段：1 词汇阅读基建 / 2 句法语块 / 3 扩展与词根。
 */
export const PATH_NODES: PathNode[] = [
  {
    id: 's1-k1a',
    title: 'K1 核心词族',
    subtitle: '最高频 1000 词族 · 前段',
    stage: 1,
    type: 'vocab_band',
    x: 110,
    y: 110,
    prereqIds: [],
    targetFamilyIds: [],
    estimatedMinutes: 600,
    masteryRule: { minStability: 0.85, minReps: 4 },
  },
  {
    id: 's1-k1b',
    title: 'K1 扩展词族',
    subtitle: '最高频 1000 词族 · 后段',
    stage: 1,
    type: 'vocab_band',
    x: 330,
    y: 110,
    prereqIds: ['s1-k1a'],
    targetFamilyIds: [],
    estimatedMinutes: 900,
    masteryRule: { minStability: 0.85, minReps: 4 },
  },
  {
    id: 's1-read-a1',
    title: 'A1 分级阅读',
    subtitle: '生词率 2%-5% 的短文',
    stage: 1,
    type: 'reading_set',
    x: 220,
    y: 260,
    prereqIds: ['s1-k1a'],
    targetFamilyIds: [],
    estimatedMinutes: 300,
    masteryRule: { minStability: 0.8, minReps: 3 },
  },
  {
    id: 's1-k2',
    title: 'K2 高频词族',
    subtitle: '第 2 个 1000 词族',
    stage: 1,
    type: 'vocab_band',
    x: 550,
    y: 110,
    prereqIds: ['s1-k1b'],
    targetFamilyIds: [],
    estimatedMinutes: 1200,
    masteryRule: { minStability: 0.85, minReps: 4 },
  },
  {
    id: 's1-read-a2',
    title: 'A2 分级阅读',
    subtitle: '窄读：同一主题连续输入',
    stage: 1,
    type: 'reading_set',
    x: 550,
    y: 260,
    prereqIds: ['s1-k2', 's1-read-a1'],
    targetFamilyIds: [],
    estimatedMinutes: 400,
    masteryRule: { minStability: 0.8, minReps: 3 },
  },
  {
    id: 's1-k3',
    title: 'K3 词族',
    subtitle: '第 3 个 1000 词族',
    stage: 1,
    type: 'vocab_band',
    x: 930,
    y: 110,
    prereqIds: ['s1-k2'],
    targetFamilyIds: [],
    estimatedMinutes: 1500,
    masteryRule: { minStability: 0.85, minReps: 4 },
  },
  {
    id: 's2-pattern',
    title: '核心句型自动化',
    subtitle: '限时句型 + 4/3/2 复述',
    stage: 2,
    type: 'grammar',
    x: 330,
    y: 420,
    prereqIds: ['s1-read-a2'],
    targetFamilyIds: [],
    estimatedMinutes: 600,
    masteryRule: { minStability: 0.85, minReps: 5 },
  },
  {
    id: 's2-chunk',
    title: '高频语块',
    subtitle: '整存整取，支撑实时交流',
    stage: 2,
    type: 'chunk_set',
    x: 550,
    y: 420,
    prereqIds: ['s2-pattern'],
    targetFamilyIds: [],
    estimatedMinutes: 700,
    masteryRule: { minStability: 0.85, minReps: 5 },
  },
  {
    id: 's2-scene',
    title: '日常场景对话',
    subtitle: 'LLM 陪练 + 纠错',
    stage: 2,
    type: 'scene',
    x: 800,
    y: 420,
    prereqIds: ['s2-chunk'],
    targetFamilyIds: [],
    estimatedMinutes: 800,
    masteryRule: { minStability: 0.8, minReps: 4 },
  },
  {
    id: 's3-academic',
    title: '学术词汇扩展',
    subtitle: 'K4-K9 词族',
    stage: 3,
    type: 'vocab_band',
    x: 550,
    y: 570,
    prereqIds: ['s1-k3'],
    targetFamilyIds: [],
    estimatedMinutes: 1500,
    masteryRule: { minStability: 0.85, minReps: 4 },
  },
  {
    id: 's3-root',
    title: '词根词缀系统',
    subtitle: '形态意识 · 派生树',
    stage: 3,
    type: 'morpheme_set',
    x: 800,
    y: 570,
    prereqIds: ['s3-academic'],
    targetFamilyIds: [],
    estimatedMinutes: 900,
    masteryRule: { minStability: 0.8, minReps: 4 },
  },
  {
    id: 's3-output',
    title: '听说输出训练',
    subtitle: '跟读 + 自由表达',
    stage: 3,
    type: 'scene',
    x: 1050,
    y: 420,
    prereqIds: ['s2-scene'],
    targetFamilyIds: [],
    estimatedMinutes: 1000,
    masteryRule: { minStability: 0.8, minReps: 4 },
  },
];

export const CANVAS_SIZE = { width: 1160, height: 660 };

/** 单个节点挂载词族的上限，避免进度分母过大导致永远无法解锁 */
export const NODE_FAMILY_CAP = 400;

/**
 * 按频段把词族挂到路径节点上（S-001）：
 * K1 拆前后两段，K2 / K3 各一段，K4 及以上进学术扩展节点。
 */
export function assignTargetFamilies(nodes: PathNode[], families: WordFamily[]): PathNode[] {
  const sorted = [...families].sort((a, b) => a.freqRank - b.freqRank);
  const k1 = sorted.filter((f) => f.freqBand === 'K1');
  const split = Math.ceil(k1.length * 0.6);

  const buckets: Record<string, WordFamily[]> = {
    's1-k1a': k1.slice(0, split),
    's1-k1b': k1.slice(split),
    's1-k2': sorted.filter((f) => f.freqBand === 'K2'),
    's1-k3': sorted.filter((f) => f.freqBand === 'K3'),
    's3-academic': sorted.filter((f) => f.freqBand === 'K4-5' || f.freqBand === 'K6-9' || f.freqBand === 'off'),
  };

  return nodes.map((node) => {
    const list = buckets[node.id];
    if (!list) return node;
    return { ...node, targetFamilyIds: list.slice(0, NODE_FAMILY_CAP).map((f) => f.id) };
  });
}
