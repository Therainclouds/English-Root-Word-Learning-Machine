import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 去掉标点并小写，用于文本切分统计 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'’\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function todayKey(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number) {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

/* ---------------- 产出卡的答案判定 ---------------- */

/** 归一化：小写、合并空白、去掉首尾标点、撇号统一 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[^\w']+|[^\w']+$/g, '');
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export type AnswerJudge = 'exact' | 'near' | 'miss';

/**
 * 判定学习者写下的答案与标准答案的关系。
 * - exact：归一化后完全一致
 * - near：编辑距离 ≤1（仅对长度 ≥4 的词放宽，短词差一个字母就是另一个词）
 * - miss：其余
 *
 * 判定结果只作为**自评参照**提示，最终评分仍然由学习者给出（避免机器误判直接改排程）。
 */
export function judgeAnswer(input: string, expected: string[]): AnswerJudge {
  const answer = normalizeAnswer(input);
  if (!answer || expected.length === 0) return 'miss';
  const targets = expected.map(normalizeAnswer).filter(Boolean);
  if (targets.includes(answer)) return 'exact';
  if (
    answer.length >= 4 &&
    targets.some((t) => t.length >= 4 && editDistance(answer, t) <= 1)
  ) {
    return 'near';
  }
  return 'miss';
}

export const JUDGE_TEXT: Record<AnswerJudge, string> = {
  exact: '完全一致',
  near: '拼写接近（核对一下字母）',
  miss: '不一致',
};

/** 把例句里的目标词挖空，作为"场景提示"（不能直接把答案摆在句子里） */
export function maskSentence(text: string, lemma: string): string {
  if (!text || !lemma) return text;
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '____');
}
