'use client';

import { getSharedDb } from '../db';
import { backText } from '../definitions';
import type { Card, Sense, Word } from '../types';

/**
 * 内置释义导入（离线词典，零 LLM 依赖）。
 *
 * 数据由 `scripts/build-definitions.mjs` 在**构建期**从 ECDICT 生成：
 * 3000 词命中 2996 条（99.9%），含中文释义、英文释义、音标、BNC 词频与考纲标签，
 * 打包后仅 0.62 MB。
 *
 * 解决的痛点：用户没有配置大模型时，词表导入后绝大多数卡因"释义待生成"无法客观作答
 * （实测首页「实际保持率」只有 6%~7%，全是瞎猜）。有了内置释义，**开箱即可学习**。
 *
 * 幂等与安全性：
 * - 已 ready 且英文释义非空的词**不覆盖**（大模型生成的内容通常更贴合学习场景，不能倒退）
 * - 补写 `senses` 时保留原有的例句关联与词性，只更新释义文本
 * - 只写共享库（D2），不触碰任何用户进度
 */

export interface DefinitionImportResult {
  /** 共享词库词数 */
  total: number;
  /** 本次填入释义的词数 */
  filled: number;
  /** 已有释义、跳过 */
  skippedReady: number;
  /** 词典未收录 */
  missing: number;
  durationMs: number;
}

interface Entry {
  zh: string;
  en: string;
  ph: string;
  bnc: number;
  frq: number;
  tag: string;
}

interface Payload {
  source: string;
  sourceUrl: string;
  license: string;
  total: number;
  entries: Record<string, Entry>;
}

/** 读取内置词典文件（不写库，仅用于界面预览覆盖情况） */
export async function loadBuiltinDictionary(): Promise<Payload> {
  const res = await fetch('/wordlists/definitions-zh.json');
  if (!res.ok) throw new Error(`内置释义数据不可用（HTTP ${res.status}）`);
  return (await res.json()) as Payload;
}

export async function importBuiltinDefinitions(): Promise<DefinitionImportResult> {
  const startedAt = Date.now();
  const payload = await loadBuiltinDictionary();

  const db = await getSharedDb();
  const words = (await db.getAll('words')) as Word[];
  const allCards = (await db.getAll('cards')) as Card[];
  const allSenses = (await db.getAll('senses')) as Sense[];

  const cardMap = new Map(allCards.map((c) => [c.id, c]));
  const senseMap = new Map(allSenses.map((s) => [s.id, s]));

  const updatedWords: Word[] = [];
  const updatedSenses: Sense[] = [];
  const updatedCards: Card[] = [];
  let skippedReady = 0;
  let missing = 0;

  for (const word of words) {
    const entry = payload.entries[word.lemma.toLowerCase()];
    if (!entry) {
      missing += 1;
      continue;
    }
    // 大模型生成或手写的释义不覆盖；词典来源的允许刷新
    // （否则修好词典数据后无法重新导入，只能让用户清库）
    const fromDict = (word.sources ?? []).includes('ecdict');
    if (word.definitionStatus === 'ready' && word.definitionEn.trim() && !fromDict) {
      skippedReady += 1;
      continue;
    }

    const definitionEn = entry.en || entry.zh;
    const definitionL1 = entry.zh || word.definitionL1;
    if (!definitionEn) {
      missing += 1;
      continue;
    }

    updatedWords.push({
      ...word,
      definitionEn,
      definitionL1,
      ipa: word.ipa || entry.ph || '',
      definitionStatus: 'ready',
      sources: word.sources.includes('ecdict') ? word.sources : [...word.sources, 'ecdict'],
    });

    const senseId = `${word.id}.s1`;
    const existing = senseMap.get(senseId);
    updatedSenses.push({
      id: senseId,
      wordId: word.id,
      senseOrder: existing?.senseOrder ?? 1,
      definitionEn,
      definitionL1,
      senseFreqShare: existing?.senseFreqShare ?? 1,
      register: existing?.register ?? word.register,
      exampleSentenceIds: existing?.exampleSentenceIds ?? [],
    });

    // 词典来源：卡片背面用中文优先 —— 见 backText 的注释（WordNet 首条常为非常用义）
    const back = backText(definitionEn, definitionL1, true);
    const receptive = cardMap.get(`${word.id}:rec`);
    if (receptive) updatedCards.push({ ...receptive, back });
    const productive = cardMap.get(`${word.id}:prod`);
    if (productive) updatedCards.push({ ...productive, front: back });
  }

  if (updatedWords.length) {
    const tx = db.transaction(['words', 'senses', 'cards'], 'readwrite');
    for (const w of updatedWords) tx.objectStore('words').put(w);
    for (const s of updatedSenses) tx.objectStore('senses').put(s);
    for (const c of updatedCards) tx.objectStore('cards').put(c);
    await tx.done;
  }

  return {
    total: words.length,
    filled: updatedWords.length,
    skippedReady,
    missing,
    durationMs: Date.now() - startedAt,
  };
}
