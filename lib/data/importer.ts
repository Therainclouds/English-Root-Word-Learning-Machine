'use client';

import { getSharedDb } from '../db';
import { PATH_NODES, assignTargetFamilies } from './path-nodes';
import type { Card, Cefr, DefinitionStatus, FreqBand, Sense, Word, WordFamily } from '../types';

/**
 * S-001 词表导入
 *
 * 幂等保证（D6）：所有 id 由 lemma 稳定推导
 *   词族 fam.<lemma> · 词条 w.<lemma> · 义项 w.<lemma>.s1
 *   卡片 w.<lemma>:rec / w.<lemma>:prod
 * 重复导入不会产生重复卡片；已生成的释义不会被覆盖。
 */

export interface ParsedRow {
  lemma: string;
  rank: number;
  definitionL1?: string;
}

export interface ParseOutcome {
  rows: ParsedRow[];
  skipped: number;
}

export function parseWordlist(text: string): ParseOutcome {
  const map = new Map<string, ParsedRow>();
  let skipped = 0;
  let autoRank = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/[\t,]| {2,}/).map((p) => p.trim());
    const lemma = parts[0]?.toLowerCase();
    if (!lemma || !/^[a-z][a-z'\- ]*$/.test(lemma)) {
      skipped += 1;
      continue;
    }

    autoRank += 1;
    const given = Number(parts[1]);
    const rank = Number.isFinite(given) && given > 0 ? given : autoRank;
    const definitionL1 = parts[2] || undefined;

    const existing = map.get(lemma);
    if (!existing || rank < existing.rank) map.set(lemma, { lemma, rank, definitionL1 });
  }

  return { rows: [...map.values()].sort((a, b) => a.rank - b.rank), skipped };
}

export function bandOf(rank: number): FreqBand {
  if (rank <= 1000) return 'K1';
  if (rank <= 2000) return 'K2';
  if (rank <= 3000) return 'K3';
  if (rank <= 5000) return 'K4-5';
  if (rank <= 9000) return 'K6-9';
  return 'off';
}

export function cefrOf(rank: number): Cefr {
  if (rank <= 500) return 'A1';
  if (rank <= 1200) return 'A2';
  if (rank <= 2500) return 'B1';
  if (rank <= 5000) return 'B2';
  return 'C1';
}

export function familyIdOf(lemma: string) {
  return `fam.${lemma.replace(/\s+/g, '_')}`;
}

export function wordIdOf(lemma: string) {
  return `w.${lemma.replace(/\s+/g, '_')}`;
}

export interface ImportResult {
  imported: number;
  reused: number;
  cardsAdded: number;
  skipped: number;
  familiesTotal: number;
  durationMs: number;
}

export async function importWordlist(text: string): Promise<ImportResult> {
  const startedAt = Date.now();
  const { rows, skipped } = parseWordlist(text);
  if (!rows.length) throw new Error('没有解析到有效词条；请检查格式（每行：word 或 word<TAB>rank）');

  const db = await getSharedDb();
  const existingFamilies = (await db.getAll('wordFamilies')) as WordFamily[];
  const existingWords = (await db.getAll('words')) as Word[];
  const existingCardIds = new Set(((await db.getAll('cards')) as Card[]).map((c) => c.id));

  const familyById = new Map(existingFamilies.map((f) => [f.id, f]));
  const wordById = new Map(existingWords.map((w) => [w.id, w]));

  const families: WordFamily[] = [];
  const words: Word[] = [];
  const senses: Sense[] = [];
  const cards: Card[] = [];
  let reused = 0;

  rows.forEach((row, index) => {
    const familyId = familyIdOf(row.lemma);
    const wordId = wordIdOf(row.lemma);
    const band = bandOf(row.rank);
    const cefr = cefrOf(row.rank);
    const group = index % 7;

    const priorFamily = familyById.get(familyId);
    families.push({
      id: familyId,
      headword: row.lemma,
      members: priorFamily?.members ?? [row.lemma],
      freqRank: row.rank,
      freqBand: band,
      cefr,
      stage: 1,
      pos: priorFamily?.pos ?? ['n'],
      ipa: priorFamily?.ipa ?? '',
      learningBurden: priorFamily?.learningBurden ?? (row.lemma.length > 8 ? 3 : 2),
      register: priorFamily?.register ?? 'general',
      sources: priorFamily?.sources ?? ['import'],
    });

    const priorWord = wordById.get(wordId);
    // 兼容没有 definitionStatus 的旧数据：只要有英文释义就视为已就绪，不得覆盖
    const keepDefinition =
      !!priorWord &&
      (priorWord.definitionStatus === 'ready' ||
        (priorWord.definitionStatus === undefined && !!priorWord.definitionEn?.trim()));
    const definitionL1 = keepDefinition ? priorWord!.definitionL1 : row.definitionL1 ?? priorWord?.definitionL1 ?? '';
    const definitionEn = keepDefinition ? priorWord!.definitionEn : '';
    const status: DefinitionStatus = definitionEn ? 'ready' : 'pending';
    if (priorWord) reused += 1;

    words.push({
      id: wordId,
      lemma: row.lemma,
      familyId,
      pos: priorWord?.pos ?? ['n'],
      ipa: priorWord?.ipa ?? '',
      definitionEn,
      definitionL1,
      collocations: priorWord?.collocations ?? [],
      synonyms: priorWord?.synonyms ?? [],
      antonyms: priorWord?.antonyms ?? [],
      cefr,
      register: priorWord?.register ?? 'general',
      sources: priorWord?.sources ?? ['import'],
      definitionStatus: status,
    });

    senses.push({
      id: `${wordId}.s1`,
      wordId,
      senseOrder: 1,
      definitionEn,
      definitionL1,
      senseFreqShare: 1,
      register: 'general',
      exampleSentenceIds: [],
    });

    const back = definitionEn || definitionL1 || '（释义待生成）';

    if (!existingCardIds.has(`${wordId}:rec`)) {
      cards.push({
        id: `${wordId}:rec`,
        familyId,
        wordId,
        template: 'word_to_meaning',
        direction: 'receptive',
        front: row.lemma,
        back,
        interleaveGroup: group,
      });
    }
    if (!existingCardIds.has(`${wordId}:prod`)) {
      cards.push({
        id: `${wordId}:prod`,
        familyId,
        wordId,
        template: 'meaning_to_word',
        direction: 'productive',
        front: back,
        back: row.lemma,
        interleaveGroup: group,
      });
    }
  });

  // 分批写入：单事务内连续 put，避免上万次独立 await
  for (const storeName of ['wordFamilies', 'words', 'senses', 'cards'] as const) {
    const payload = { wordFamilies: families, words, senses, cards }[storeName];
    const tx = db.transaction(storeName, 'readwrite');
    for (const row of payload) tx.store.put(row);
    await tx.done;
  }

  // 按频段重算路径节点挂载
  const allFamilies = (await db.getAll('wordFamilies')) as WordFamily[];
  const nodes = assignTargetFamilies(PATH_NODES, allFamilies);
  const nodeTx = db.transaction('pathNodes', 'readwrite');
  for (const node of nodes) nodeTx.store.put(node);
  await nodeTx.done;

  return {
    imported: rows.length,
    reused,
    cardsAdded: cards.length,
    skipped,
    familiesTotal: allFamilies.length,
    durationMs: Date.now() - startedAt,
  };
}
