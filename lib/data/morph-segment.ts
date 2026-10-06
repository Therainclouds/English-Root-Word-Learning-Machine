import type { Morpheme, MorphemeRef, MorphStatus } from '../types';
import { MIN_AFFIX_LENGTH, MIN_CONFIDENCE, MIN_PREFIX_LENGTH } from './morphemes';

/**
 * 确定性形态切分（S-007 / D4：切分由代码负责，不交给 LLM）
 *
 * 策略：前缀 → 词根 → 后缀 的顺序，按异形长度贪心最长匹配，
 * 并要求「拼接可复原原词」（容差 ≤1 个字符：连接元音或屈折尾）。
 *
 * 宁缺勿错：切不出来标 unsegmented，不生成词根卡，
 * 也不给似是而非的拆解。
 */

export interface SegmentResult {
  status: MorphStatus;
  refs: MorphemeRef[];
  /** 规则生成的字面义合成；LLM 可后续润色（D10） */
  literalGlue: string;
  /** 未被词素覆盖的字符数（连接字母 / 屈折尾） */
  gap: number;
}

interface Candidate {
  morpheme: Morpheme;
  allomorph: string;
}

export interface MorphemeIndex {
  prefixes: Candidate[];
  suffixes: Candidate[];
  roots: Candidate[];
  byId: Map<string, Morpheme>;
}

/** 允许的最大未覆盖字符数（连接元音 / 词根脱落） */
const MAX_GAP = 1;
/** 词干最短长度：短于此不予切分，避免 un + able 之类噪声 */
const MIN_STEM_LENGTH = 3;

function spread(list: Morpheme[], type: Morpheme['type'], minLength: number): Candidate[] {
  const out: Candidate[] = [];
  for (const morpheme of list) {
    if (morpheme.type !== type) continue;
    if (morpheme.confidence < MIN_CONFIDENCE) continue;
    for (const allomorph of morpheme.allomorphs) {
      if (allomorph.length < minLength) continue;
      out.push({ morpheme, allomorph });
    }
  }
  // 长异形优先，避免 in- 抢在 inter- 前面命中
  return out.sort((a, b) => b.allomorph.length - a.allomorph.length);
}

export function buildMorphemeIndex(morphemes: Morpheme[]): MorphemeIndex {
  return {
    prefixes: spread(morphemes, 'prefix', MIN_PREFIX_LENGTH),
    suffixes: spread(morphemes, 'suffix', MIN_AFFIX_LENGTH),
    roots: spread(morphemes, 'root', MIN_AFFIX_LENGTH),
    byId: new Map(morphemes.map((m) => [m.id, m])),
  };
}

/** stem 与词根异形的差异；无法匹配返回 null */
function matchGap(stem: string, allomorph: string): number | null {
  if (stem === allomorph) return 0;
  // 词干比词根长（连接元音 / 屈折尾）：possible → poss vs pos
  if (stem.startsWith(allomorph)) return stem.length - allomorph.length;
  // 词干比词根短（词根脱落）：仅当词干够长才接受。
  // 否则 3 字母词干会误配 4 字母词根：enter → en + terr、after → af + terr。
  if (stem.length >= 4 && allomorph.startsWith(stem)) return allomorph.length - stem.length;
  return null;
}

export function segmentWord(lemma: string, index: MorphemeIndex): SegmentResult {
  const word = lemma.toLowerCase().trim();
  if (word.length < 4) return { status: 'unsegmented', refs: [], literalGlue: '', gap: 0 };

  let best: { refs: MorphemeRef[]; gap: number; covered: number } | null = null;

  const prefixOptions: (Candidate | null)[] = [null, ...index.prefixes];
  const suffixOptions: (Candidate | null)[] = [null, ...index.suffixes];

  for (const prefix of prefixOptions) {
    if (prefix && !word.startsWith(prefix.allomorph)) continue;
    const start = prefix ? prefix.allomorph.length : 0;

    for (const suffix of suffixOptions) {
      if (suffix && !word.endsWith(suffix.allomorph)) continue;
      const end = word.length - (suffix ? suffix.allomorph.length : 0);
      if (end - start < MIN_STEM_LENGTH) continue;

      const stem = word.slice(start, end);

      for (const root of index.roots) {
        const gap = matchGap(stem, root.allomorph);
        if (gap === null || gap > MAX_GAP) continue;

        const refs: MorphemeRef[] = [];
        if (prefix) refs.push({ morphemeId: prefix.morpheme.id, position: 'prefix', allomorph: prefix.allomorph });
        refs.push({ morphemeId: root.morpheme.id, position: 'root', allomorph: root.allomorph });
        if (suffix) refs.push({ morphemeId: suffix.morpheme.id, position: 'suffix', allomorph: suffix.allomorph });

        // 单词素词（如 form / port）没有学习价值，不生成卡
        if (refs.length < 2) continue;

        const covered = refs.reduce((sum, r) => sum + r.allomorph.length, 0);
        const better =
          !best ||
          gap < best.gap ||
          (gap === best.gap && covered > best.covered) ||
          (gap === best.gap && covered === best.covered && refs.length > best.refs.length);
        if (better) best = { refs, gap, covered };
      }
    }
  }

  if (!best) return { status: 'unsegmented', refs: [], literalGlue: '', gap: 0 };
  return {
    status: 'segmented',
    refs: best.refs,
    literalGlue: glueOf(best.refs, index.byId),
    gap: best.gap,
  };
}

/** 字面义合成的规则版：[in] into, in + [spect] to look, see */
export function glueOf(refs: MorphemeRef[], byId: Map<string, Morpheme>): string {
  return refs
    .map((ref) => {
      const morpheme = byId.get(ref.morphemeId);
      return `[${ref.allomorph}] ${morpheme?.coreMeaning ?? '?'}`;
    })
    .join(' + ');
}

/**
 * 是否需要 LLM 润色字面义：规则版带方括号（"[in] into, in + [spect] to look, see"）。
 * 纯函数，不依赖存储层——供 lib/llm/morpheme.ts 与离线自检共用。
 */
export function needsGlue(word: { morphStatus?: string; literalGlue?: string } | undefined) {
  return !!word && word.morphStatus === 'segmented' && !!word.literalGlue?.includes('[');
}

/** 词素是否缺少助记（已有 story 则不再请求，保证幂等） */
export function needsMnemonic(morpheme: { mnemonic?: { story?: string } } | undefined) {
  return !!morpheme && !morpheme.mnemonic?.story?.trim();
}

export interface SegmentSummary {
  total: number;
  segmented: number;
  unsegmented: number;
}

/** 批量切分；返回 lemma → 结果 */
export function segmentMany(lemmas: string[], morphemes: Morpheme[]): Map<string, SegmentResult> {
  const index = buildMorphemeIndex(morphemes);
  const out = new Map<string, SegmentResult>();
  for (const lemma of lemmas) out.set(lemma, segmentWord(lemma, index));
  return out;
}
