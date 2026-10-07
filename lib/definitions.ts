'use client';

import { getSharedDb } from './db';
import { explainWord, type WordExplanation } from './llm';
import type { Card, LlmConfig, Sense, Word } from './types';

/**
 * S-002 释义按需生成与缓存
 *
 * - 写回**共享库**：一个人生成，所有人受益
 * - 只改释义相关字段，不动 id / familyId / freqRank
 * - 同词并发只发一次请求（inflight 去重）
 * - 失败不阻塞学习：保持 pending，由界面提示重试
 */

const inflight = new Map<string, Promise<Word | null>>();

function isValidExplanation(exp: WordExplanation | null | undefined) {
  const text = exp?.definitionEn?.trim() ?? '';
  return text.length > 0 && text.length <= 200;
}

/**
 * 卡片背面文案。
 *
 * 默认英文优先（D7：减少母语中介）——大模型生成的英文释义简短精准，适合做考点。
 *
 * 但**内置词典来源的词必须传 `preferL1 = true`**：ECDICT 的英文来自 WordNet，
 * 其 synset 顺序不按常用度，首条常常是非常用义甚至术语
 * （实测：`run` → "n. a score in baseball…"、`about` → "adj. on the move"）。
 * 而词典的中文释义来自传统词典、按常用度排列，对中文学习者更可靠。
 */
export function backText(definitionEn: string, definitionL1: string, preferL1 = false) {
  const en = definitionEn?.trim() ?? '';
  const zh = definitionL1?.trim() ?? '';
  if (preferL1) return zh || en || '（释义待生成）';
  return en || zh || '（释义待生成）';
}

export function isPending(word: Word | undefined) {
  return !!word && (word.definitionStatus === 'pending' || !word.definitionEn.trim());
}

/**
 * 是否值得让大模型重写释义。
 *
 * 默认只处理"待生成"的词；开启 `redoDictionary` 时，**内置词典来源**的词也算在内
 * （S-009 的词典数据覆盖率高但质量有限：英文来自 WordNet、中文来自传统词典，
 * 用户配好大模型后应当能升级这批释义）。大模型生成或手写的词永不被自动覆盖。
 */
export function needsLlmDefinition(word: Word | undefined, redoDictionary = false) {
  if (!word) return false;
  if (isPending(word)) return true;
  return redoDictionary && (word.sources ?? []).includes('ecdict');
}

export async function ensureDefinition(
  cfg: LlmConfig,
  wordId: string,
  opts?: { redoDictionary?: boolean },
): Promise<Word | null> {
  const db = await getSharedDb();
  const word = (await db.get('words', wordId)) as Word | undefined;
  if (!word) return null;
  if (!needsLlmDefinition(word, opts?.redoDictionary)) return word;

  const pending = inflight.get(wordId);
  if (pending) return pending;

  const task = (async (): Promise<Word | null> => {
    try {
      const explanation = await explainWord(cfg, word.lemma);
      if (!isValidExplanation(explanation)) return word;

      const definitionEn = explanation.definitionEn.trim();
      const definitionL1 = explanation.definitionL1?.trim() || word.definitionL1;
      const updated: Word = {
        ...word,
        definitionEn,
        definitionL1,
        collocations: explanation.collocations?.length ? explanation.collocations : word.collocations,
        definitionStatus: 'ready',
      };

      const tx = db.transaction(['words', 'senses', 'cards'], 'readwrite');
      tx.objectStore('words').put(updated);

      const senseId = `${wordId}.s1`;
      const sense = (await tx.objectStore('senses').get(senseId)) as Sense | undefined;
      tx.objectStore('senses').put({
        id: senseId,
        wordId,
        senseOrder: sense?.senseOrder ?? 1,
        definitionEn,
        definitionL1,
        senseFreqShare: sense?.senseFreqShare ?? 1,
        register: sense?.register ?? 'general',
        exampleSentenceIds: sense?.exampleSentenceIds ?? [],
      });

      const back = backText(definitionEn, definitionL1);
      const receptive = (await tx.objectStore('cards').get(`${wordId}:rec`)) as Card | undefined;
      if (receptive) tx.objectStore('cards').put({ ...receptive, back });
      const productive = (await tx.objectStore('cards').get(`${wordId}:prod`)) as Card | undefined;
      if (productive) tx.objectStore('cards').put({ ...productive, front: back });

      await tx.done;
      return updated;
    } catch {
      return word; // 失败保持 pending
    } finally {
      inflight.delete(wordId);
    }
  })();

  inflight.set(wordId, task);
  return task;
}

/** 批量补全（用于词表导入后的一次性回填，串行以避免打爆限流） */
export async function ensureDefinitions(
  cfg: LlmConfig,
  wordIds: string[],
  onProgress?: (done: number, total: number) => void,
  opts?: { redoDictionary?: boolean },
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < wordIds.length; i += 1) {
    const result = await ensureDefinition(cfg, wordIds[i], opts);
    if (result && result.definitionStatus === 'ready') ok += 1;
    else failed += 1;
    onProgress?.(i + 1, wordIds.length);
  }
  return { ok, failed };
}
