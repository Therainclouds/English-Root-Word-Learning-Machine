'use client';

import { llmRepo } from '../db';
import type { LlmUsageLog } from '../types';

/**
 * 用量埋点：写入**当前用户**的 llmLogs 表（每人独立），
 * 便于排查"只有我这儿不通"。未设置用户时静默丢弃（不阻塞调用）。
 */
let currentUserId: string | null = null;

export function setLlmUser(userId: string | null) {
  currentUserId = userId;
}

export function recordLlmCall(entry: Omit<LlmUsageLog, 'seq' | 'at'> & { at?: number }) {
  if (!currentUserId) return;
  const userId = currentUserId;
  void llmRepo
    .log(userId, { ...entry, at: entry.at ?? Date.now() })
    .catch(() => undefined);
}
