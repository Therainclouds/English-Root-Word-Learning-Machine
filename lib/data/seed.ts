'use client';

import { cardsRepo, getSharedDb, passagesRepo, pathRepo, sentencesRepo, wordsRepo } from '../db';
import { buildPassageEntities } from './passages';
import type { Card, Cefr, FreqBand, Sentence, Sense, Word, WordFamily } from '../types';
import { SEED_WORDS } from './seed-words';
import { PATH_NODES, assignTargetFamilies } from './path-nodes';

function bandOf(rank: number): FreqBand {
  return rank <= 60 ? 'K1' : 'K2';
}

function cefrOf(rank: number): Cefr {
  if (rank <= 30) return 'A1';
  if (rank <= 65) return 'A2';
  return 'B1';
}

function familyIdOf(lemma: string) {
  return `fam.${lemma.replace(/\s+/g, '_')}`;
}

function wordIdOf(lemma: string) {
  return `w.${lemma.replace(/\s+/g, '_')}`;
}

function maskSentence(sentence: string, lemma: string) {
  const re = new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return sentence.replace(re, '____');
}

export function buildSeedEntities() {
  const families: WordFamily[] = [];
  const words: Word[] = [];
  const senses: Sense[] = [];
  const sentences: Sentence[] = [];
  const cards: Card[] = [];

  SEED_WORDS.forEach((row, index) => {
    const [lemma, pos, ipa, definitionEn, definitionL1, example] = row;
    const rank = index + 1;
    const familyId = familyIdOf(lemma);
    const wordId = wordIdOf(lemma);
    const sentenceId = `s.${index}`;
    const group = index % 7;

    families.push({
      id: familyId,
      headword: lemma,
      members: [lemma],
      freqRank: rank,
      freqBand: bandOf(rank),
      cefr: cefrOf(rank),
      stage: 1,
      pos,
      ipa,
      learningBurden: lemma.length > 8 ? 3 : 2,
      register: 'general',
      sources: ['seed'],
    });

    words.push({
      id: wordId,
      lemma,
      familyId,
      pos,
      ipa,
      definitionEn,
      definitionL1,
      collocations: [],
      synonyms: [],
      antonyms: [],
      cefr: cefrOf(rank),
      register: 'general',
      sources: ['seed'],
      definitionStatus: 'ready',
    });

    senses.push({
      id: `${wordId}.s1`,
      wordId,
      senseOrder: 1,
      definitionEn,
      definitionL1,
      senseFreqShare: 1,
      register: 'general',
      exampleSentenceIds: [sentenceId],
    });

    sentences.push({
      id: sentenceId,
      text: example,
      translationL1: undefined,
      targetWordIds: [wordId],
    });

    // 识别方向：见词 → 释义（句中）
    cards.push({
      id: `${wordId}:rec`,
      familyId,
      wordId,
      sentenceId,
      template: 'word_to_meaning',
      direction: 'receptive',
      front: lemma,
      back: definitionEn,
      hint: maskSentence(example, lemma),
      interleaveGroup: group,
    });

    // 产出方向：见释义 → 检索词形（能认 ≠ 能说，必须单独练）
    cards.push({
      id: `${wordId}:prod`,
      familyId,
      wordId,
      sentenceId,
      template: 'meaning_to_word',
      direction: 'productive',
      front: definitionEn,
      back: lemma,
      hint: maskSentence(example, lemma),
      interleaveGroup: group,
    });
  });

  return { families, words, senses, sentences, cards };
}

/**
 * 修复被误清空的种子词释义（非破坏性）。
 * 背景：v3 之前的旧数据没有 definitionStatus 字段，导入词表时会被判定为"未就绪"
 * 从而把 definitionEn 覆盖为空。此操作只补齐为空的英文释义。
 */
export async function repairSeedDefinitions(): Promise<number> {
  const { words } = buildSeedEntities();
  const db = await getSharedDb();
  let repaired = 0;

  for (const seedWord of words) {
    const current = (await db.get('words', seedWord.id)) as Word | undefined;
    if (!current || current.definitionEn?.trim()) continue;

    await db.put('words', {
      ...current,
      definitionEn: seedWord.definitionEn,
      definitionL1: current.definitionL1 || seedWord.definitionL1,
      definitionStatus: 'ready',
    } satisfies Word);

    const back = seedWord.definitionEn;
    const rec = (await db.get('cards', `${seedWord.id}:rec`)) as Card | undefined;
    if (rec) await db.put('cards', { ...rec, back });
    const prod = (await db.get('cards', `${seedWord.id}:prod`)) as Card | undefined;
    if (prod) await db.put('cards', { ...prod, front: back });

    repaired += 1;
  }
  return repaired;
}

/** 播种共享词库（所有用户共用一份内容） */
export async function ensureSeeded() {
  const count = await wordsRepo.countFamilies();
  if (count > 0) return;

  const { families, words, senses, sentences, cards } = buildSeedEntities();
  await wordsRepo.bulkPut(families, words, senses, sentences);
  await cardsRepo.bulkPut(cards);
  await pathRepo.bulkPut(assignTargetFamilies(PATH_NODES, families));
}

/**
 * 播种分级读物（S-003）。与词库分开判断：
 * 已导入词表的老库不会因为词族非空而跳过读物播种。
 */
export async function ensurePassagesSeeded() {
  const db = await getSharedDb();
  if ((await db.count('passages')) > 0) return;

  const { passages, sentences } = buildPassageEntities();
  await passagesRepo.bulkPut(passages);
  await sentencesRepo.bulkPut(sentences);
}

