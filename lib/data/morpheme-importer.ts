'use client';

import { getSharedDb } from '../db';
import { SEED_MORPHEMES } from './morphemes';
import { buildMorphemeIndex, segmentWord } from './morph-segment';
import { NODE_FAMILY_CAP } from './path-nodes';
import type { Card, Morpheme, MorphemeRef, Word } from '../types';

/**
 * S-007 词根库导入
 *
 * 幂等保证（D6）：
 *   词素 m.<type>.<form> · 识别卡 w.<lemma>:morph · 产出卡 m.<type>.<form>:prod
 * 重复导入不产生重复卡片，也不触碰任何 elm-<userId>（D2）。
 *
 * 只写共享库：词素 / 词的切分字段 / 卡片 / s3-root 节点挂载。
 */

/** 词根卡所属的路径节点（PathNodeType 已有 morpheme_set） */
export const MORPH_NODE_ID = 's3-root';

export interface MorphemeImportResult {
  morphemes: number;
  segmented: number;
  unsegmented: number;
  cardsAdded: number;
  nodeFamilies: number;
  /** 被保留的已有讲解 / 助记条数（重新导入不会抹掉 LLM 成果） */
  preserved: number;
  durationMs: number;
}

function refsText(refs: MorphemeRef[]) {
  return refs.map((r) => r.allomorph).join(' + ');
}

/**
 * 种子是**基线**而不是权威。
 *
 * 重新导入时如果直接 put 种子，会把 LLM 已生成（或手写补充）的 `explain` / `mnemonic`
 * 抹成空值——用户点过"批量补全词根讲解"后再导一次就全白烧了。
 * 规则：种子里有的以种子为准（便于种子迭代升级内容），种子为空的沿用库中已有值。
 */
function mergeMorpheme(seed: Morpheme, existing: Morpheme | undefined): Morpheme {
  if (!existing) return seed;
  const merged: Morpheme = { ...seed };
  if (!merged.mnemonic?.story?.trim() && existing.mnemonic?.story?.trim()) {
    merged.mnemonic = existing.mnemonic;
  }
  if (!merged.explain && existing.explain) merged.explain = existing.explain;
  return merged;
}

export async function importMorphemes(custom?: Morpheme[]): Promise<MorphemeImportResult> {
  const startedAt = Date.now();
  const morphemes = custom?.length ? custom : SEED_MORPHEMES;
  const index = buildMorphemeIndex(morphemes);

  const db = await getSharedDb();
  const words = (await db.getAll('words')) as Word[];
  const existingCards = (await db.getAll('cards')) as Card[];
  const nodes = (await db.getAll('pathNodes')) as { id: string; targetFamilyIds?: string[] }[];
  const existingCardIds = new Set(existingCards.map((c) => c.id));
  const existingById = new Map(
    ((await db.getAll('morphemes')) as Morpheme[]).map((m) => [m.id, m]),
  );

  /* 1. 切分所有词
   * 切分结果一律以**本次计算**为准：库里的 decomposition / literalGlue 是上一次导入的旧值，
   * 首次导入时为空，直接读旧值会导致派生词索引与卡片内容为空（初次验收踩到的坑）。 */
  const updatedWords: Word[] = [];
  const segmented: Word[] = [];
  const refsByLemma = new Map<string, MorphemeRef[]>();
  const glueByLemma = new Map<string, string>();
  let unsegmented = 0;

  for (const word of words) {
    const result = segmentWord(word.lemma, index);
    if (result.status !== 'segmented') {
      unsegmented += 1;
      if (word.morphStatus !== 'unsegmented') updatedWords.push({ ...word, morphStatus: 'unsegmented' });
      continue;
    }

    segmented.push(word);
    refsByLemma.set(word.lemma, result.refs);
    glueByLemma.set(word.lemma, result.literalGlue);
    const same =
      word.morphStatus === 'segmented' &&
      word.literalGlue === result.literalGlue &&
      word.decomposition?.length === result.refs.length &&
      word.decomposition?.every(
        (r, i) =>
          r.morphemeId === result.refs[i].morphemeId &&
          r.allomorph === result.refs[i].allomorph &&
          r.position === result.refs[i].position,
      );
    if (!same) {
      updatedWords.push({
        ...word,
        decomposition: result.refs,
        literalGlue: result.literalGlue,
        morphStatus: 'segmented',
      });
    }
  }

  /* 2. 词素 → 派生词（反向索引，供产出卡使用） */
  const derivatives = new Map<string, string[]>();
  for (const word of segmented) {
    for (const ref of refsByLemma.get(word.lemma) ?? []) {
      const list = derivatives.get(ref.morphemeId) ?? [];
      if (!list.includes(word.lemma)) list.push(word.lemma);
      derivatives.set(ref.morphemeId, list);
    }
  }

  /* 3. 生成卡片 */
  const cards: Card[] = [];

  // 识别方向：给出词，要求切分 + 字面义合成
  segmented.forEach((word, i) => {
    const id = `w.${word.lemma.replace(/\s+/g, '_')}:morph`;
    if (existingCardIds.has(id)) return;
    const refs = refsByLemma.get(word.lemma) ?? [];
    const glue = glueByLemma.get(word.lemma) ?? '';
    cards.push({
      id,
      familyId: word.familyId,
      wordId: word.id,
      template: 'word_to_morpheme',
      direction: 'receptive',
      front: word.lemma,
      back: `${refsText(refs)} — ${glue}`,
      hint: glue,
      // 同一词根的派生词分散到不同交错组（root-data-schema §2.6）
      interleaveGroup: i % 7,
    });
  });

  // 产出方向：给出词根与核心义，要求列出派生词
  morphemes.forEach((morpheme, i) => {
    const id = `${morpheme.id}:prod`;
    if (existingCardIds.has(id)) return;
    const words = derivatives.get(morpheme.id) ?? [];
    if (!words.length) return;
    cards.push({
      id,
      familyId: '',
      wordId: '',
      morphemeId: morpheme.id,
      template: 'morpheme_to_words',
      direction: 'productive',
      front: `${morpheme.form} — ${morpheme.coreMeaning}`,
      // 全量派生词：判定时用完整答案集，展示时再截断（截断在这里会导致"写出第 9 个也判错"）
      back: words.join(', '),
      hint: morpheme.l1Gloss,
      interleaveGroup: (i + 3) % 7,
    });
  });

  /* 4. 写入共享库（分批事务，不触碰任何用户库）
   * merge：保留库中已有的 explain / mnemonic，避免重复导入抹掉 LLM 生成的内容 */
  const merged = morphemes.map((m) => mergeMorpheme(m, existingById.get(m.id)));
  const preserved = merged.filter(
    (m, i) =>
      m.explain !== morphemes[i].explain || m.mnemonic !== morphemes[i].mnemonic,
  ).length;

  const morphemeTx = db.transaction('morphemes', 'readwrite');
  for (const row of merged) morphemeTx.store.put(row);
  await morphemeTx.done;

  if (updatedWords.length) {
    const tx = db.transaction('words', 'readwrite');
    for (const row of updatedWords) tx.store.put(row);
    await tx.done;
  }

  if (cards.length) {
    const tx = db.transaction('cards', 'readwrite');
    for (const row of cards) tx.store.put(row);
    await tx.done;
  }

  /* 5. 挂到阶段 3 的 morpheme_set 节点（不重算 s1-*，避免影响 S-001） */
  const familyIds = [...new Set(segmented.map((w) => w.familyId))].slice(0, NODE_FAMILY_CAP);
  if (nodes.length) {
    const tx = db.transaction('pathNodes', 'readwrite');
    for (const node of nodes) {
      if (node.id !== MORPH_NODE_ID) continue;
      tx.store.put({ ...node, targetFamilyIds: familyIds });
    }
    await tx.done;
  }

  return {
    morphemes: morphemes.length,
    segmented: segmented.length,
    unsegmented,
    cardsAdded: cards.length,
    nodeFamilies: familyIds.length,
    preserved,
    durationMs: Date.now() - startedAt,
  };
}
