import type { Cefr, FreqBand, WordFamily } from './types';

/**
 * 覆盖率估算。
 * 方法：采用 Nation 公布的分频段文本覆盖率经验值，频段内按词族平均分配权重。
 * 这是一个**估算**，用于反馈与激励，不等于真实语料测量。
 */
export const BAND_WEIGHT: Record<FreqBand, number> = {
  K1: 0.85,
  K2: 0.05,
  K3: 0.03,
  'K4-5': 0.02,
  'K6-9': 0.03,
  off: 0.02,
};

/** 各频段的词族规模参考值（Nation, 2006） */
export const BAND_SIZE: Record<FreqBand, number> = {
  K1: 1000,
  K2: 1000,
  K3: 1000,
  'K4-5': 2000,
  'K6-9': 4000,
  off: 10000,
};

export function perFamilyWeight(band: FreqBand) {
  return BAND_WEIGHT[band] / BAND_SIZE[band];
}

export interface CoverageReport {
  coverage: number;
  known: number;
  knownByBand: Record<FreqBand, number>;
  cefr: Cefr;
}

export function estimateCoverage(families: WordFamily[], known: Set<string>): CoverageReport {
  let coverage = 0;
  let knownCount = 0;
  const knownByBand: Record<FreqBand, number> = {
    K1: 0,
    K2: 0,
    K3: 0,
    'K4-5': 0,
    'K6-9': 0,
    off: 0,
  };

  for (const family of families) {
    if (!known.has(family.id)) continue;
    coverage += perFamilyWeight(family.freqBand);
    knownByBand[family.freqBand] += 1;
    knownCount += 1;
  }

  return { coverage, known: knownCount, knownByBand, cefr: cefrFromCoverage(coverage) };
}

/** 覆盖率 → CEFR 粗估（仅作参考锚点） */
export function cefrFromCoverage(coverage: number): Cefr {
  if (coverage < 0.4) return 'A1';
  if (coverage < 0.7) return 'A2';
  if (coverage < 0.85) return 'B1';
  if (coverage < 0.93) return 'B2';
  if (coverage < 0.97) return 'C1';
  return 'C2';
}

/** 分级阅读生词率：确保落在可理解输入区间 [2%, 5%] */
export function unknownRate(text: string, knownLemmas: Set<string>) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z'’\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return 0;
  const unknown = tokens.filter((t) => !knownLemmas.has(t)).length;
  return unknown / tokens.length;
}

export const COMPREHENSIBLE_RANGE = { min: 0.02, max: 0.05 };
