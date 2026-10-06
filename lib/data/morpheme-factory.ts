import type { Morpheme, MorphemeOrigin, MorphemeType } from '../types';

/**
 * 词素构造工厂（被 morphemes.ts 与 morphemes-extended.ts 共用）
 *
 * id 由 `m.<type>.<form>` 稳定推导（D6）；coverageGain 由派生力估算，
 * 避免每条数据都手填两个相关联的数值。
 */
export function morph(
  type: MorphemeType,
  form: string,
  allomorphs: string[],
  origin: MorphemeOrigin,
  etymon: string,
  coreMeaning: string,
  l1Gloss: string,
  semanticField: string[],
  productivity: number,
  difficulty = 2,
  confidence = 0.9,
  confusingWith: string[] = [],
): Morpheme {
  return {
    id: `m.${type}.${form}`,
    type,
    form,
    allomorphs,
    origin,
    etymon,
    coreMeaning,
    l1Gloss,
    semanticField,
    productivity,
    coverageGain: Number((productivity * 0.00007).toFixed(4)),
    difficulty,
    confusingWith,
    confidence,
    sources: ['seed'],
  };
}
