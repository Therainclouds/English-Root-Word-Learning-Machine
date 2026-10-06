import type { Card, NodeRuntime, NodeStatus, PathNode, ReviewState, WordFamily } from './types';

/** 判定一个词族是否已掌握：识别方向达到稳定度与复现次数门槛 */
export function isFamilyKnown(
  familyId: string,
  cardsByFamily: Map<string, Card[]>,
  states: Map<string, ReviewState>,
  minStability = 0.8,
  minReps = 3,
) {
  const cards = cardsByFamily.get(familyId) ?? [];
  const receptive = cards.filter((c) => c.direction === 'receptive');
  if (!receptive.length) return false;
  return receptive.every((card) => {
    const state = states.get(card.id);
    return !!state && state.stability >= minStability && state.reps >= minReps;
  });
}

export function computeKnownFamilies(
  families: WordFamily[],
  cards: Card[],
  states: Map<string, ReviewState>,
) {
  const cardsByFamily = new Map<string, Card[]>();
  for (const card of cards) {
    if (!cardsByFamily.has(card.familyId)) cardsByFamily.set(card.familyId, []);
    cardsByFamily.get(card.familyId)!.push(card);
  }
  const known = new Set<string>();
  for (const family of families) {
    if (isFamilyKnown(family.id, cardsByFamily, states)) known.add(family.id);
  }
  return known;
}

/**
 * 路径节点状态机（由 SRS 稳定度驱动，不交给 LLM）：
 * locked → available → learning ⇄ due → mastered → 解锁后继
 */
export function computeRuntime(
  nodes: PathNode[],
  cards: Card[],
  states: Map<string, ReviewState>,
  now = Date.now(),
): Record<string, NodeRuntime> {
  const cardsByFamily = new Map<string, Card[]>();
  for (const card of cards) {
    if (!cardsByFamily.has(card.familyId)) cardsByFamily.set(card.familyId, []);
    cardsByFamily.get(card.familyId)!.push(card);
  }

  const result: Record<string, NodeRuntime> = {};
  const statusById: Record<string, NodeStatus> = {};

  for (const node of nodes) {
    const nodeCards = node.targetFamilyIds.flatMap((id) => cardsByFamily.get(id) ?? []);
    const total = nodeCards.length;
    const learned = nodeCards.filter((c) => (states.get(c.id)?.reps ?? 0) > 0).length;
    const mastered = nodeCards.filter((c) => {
      const s = states.get(c.id);
      return !!s && s.stability >= node.masteryRule.minStability && s.reps >= node.masteryRule.minReps;
    }).length;
    const due = nodeCards.some((c) => {
      const s = states.get(c.id);
      return !!s && s.reps > 0 && s.dueAt <= now;
    });

    const prereqOk = node.prereqIds.every((id) => statusById[id] === 'mastered' || statusById[id] === 'learning' || statusById[id] === 'due');

    let status: NodeStatus = 'locked';
    if (!prereqOk) status = 'locked';
    else if (total === 0) status = 'available';
    else if (mastered / total >= 0.9) status = 'mastered';
    else if (learned === 0) status = 'available';
    else if (due) status = 'due';
    else status = 'learning';

    statusById[node.id] = status;
    // learned = 学过（≥1 次复习）的卡片数，mastered = 达掌握门槛的卡片数。
    // 早前这里把 learned 直接填成 mastered，导致刚学完一天的用户看到进度永远是 0/N。
    result[node.id] = { nodeId: node.id, status, learned, mastered, total };
  }

  return result;
}

export const STATUS_META: Record<NodeStatus, { label: string; color: string; ring: string }> = {
  locked: { label: '未解锁', color: '#71717a', ring: 'rgba(113,113,122,0.35)' },
  available: { label: '可开始', color: '#a1a1aa', ring: 'rgba(161,161,170,0.5)' },
  learning: { label: '学习中', color: '#38bdf8', ring: 'rgba(56,189,248,0.6)' },
  due: { label: '待复习', color: '#fbbf24', ring: 'rgba(251,191,36,0.7)' },
  mastered: { label: '已掌握', color: '#34d399', ring: 'rgba(52,211,153,0.7)' },
};
