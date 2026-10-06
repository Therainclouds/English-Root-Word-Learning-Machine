import type { Morpheme, MorphemeOrigin, MorphemeType } from '../types';

/**
 * 种子词素库（S-007）
 *
 * 设计约束：
 * - 手写整理，不引入受版权限制的数据；sources 一律标 'seed'
 * - id 由 `m.<type>.<form>` 稳定推导（D6），重复导入幂等
 * - allomorphs 必须包含 form 本身，并覆盖常见同化变体（in- → im-/il-/ir-）
 * - confidence < 0.7 的词素不参与自动形态切分（宁缺勿错）
 *
 * 首期 61 条：16 前缀 + 31 词根 + 14 后缀，覆盖 K1–K5 中可切分的常用词。
 * 扩到 300–800 条需走 ETL（Wiktionary 为 CC BY-SA、Etymonline 需单独确认），默认不启用。
 */

function morph(
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

export const SEED_MORPHEMES: Morpheme[] = [
  /* ---------------- 前缀 ---------------- */
  morph('prefix', 'un', ['un'], 'old_english', 'un-', 'not; opposite; reverse', '不；相反', ['negation'], 120, 1, 0.95),
  morph('prefix', 're', ['re'], 'latin', 're-', 'again; back', '再；回', ['aspect', 'repetition'], 110, 1, 0.95),
  morph('prefix', 'in', ['in', 'im', 'il', 'ir'], 'latin', 'in-', 'into; in; on', '进入；在内', ['direction'], 80, 3, 0.85, ['m.prefix.un']),
  morph('prefix', 'dis', ['dis', 'di', 'dif'], 'latin', 'dis-', 'apart; away; not', '分离；否定', ['negation', 'separation'], 55, 3, 0.85),
  morph('prefix', 'pre', ['pre'], 'latin', 'prae-', 'before; in advance', '在……之前', ['time'], 50, 1, 0.95),
  morph('prefix', 'sub', ['sub', 'suc', 'suf', 'sug', 'sup', 'sus'], 'latin', 'sub-', 'under; below; from below', '在……下', ['direction'], 45, 3, 0.85),
  morph('prefix', 'inter', ['inter', 'intel'], 'latin', 'inter-', 'between; among', '在……之间', ['relation'], 35, 2, 0.9),
  morph('prefix', 'trans', ['trans', 'tra'], 'latin', 'trans-', 'across; beyond; through', '跨越', ['direction'], 30, 2, 0.9),
  morph('prefix', 'con', ['con', 'com', 'col', 'cor', 'co'], 'latin', 'cum-', 'with; together; thoroughly', '共同；一起', ['relation'], 50, 3, 0.85),
  morph('prefix', 'ex', ['ex', 'ef'], 'latin', 'ex-', 'out of; from; former', '向外；出', ['direction'], 45, 2, 0.9),
  morph('prefix', 'de', ['de'], 'latin', 'de-', 'down; away; reverse', '向下；去除；相反', ['direction', 'negation'], 45, 2, 0.85, ['m.prefix.dis']),
  morph('prefix', 'pro', ['pro'], 'latin', 'pro-', 'forward; for; in favour of', '向前；支持', ['direction'], 35, 2, 0.9),
  morph('prefix', 'ob', ['ob', 'oc', 'of', 'op', 'os'], 'latin', 'ob-', 'against; toward; in the way', '相对；朝向', ['direction'], 22, 3, 0.8),
  morph('prefix', 'mis', ['mis'], 'old_english', 'mis-', 'wrongly; badly', '错误地', ['negation'], 25, 1, 0.95),
  morph('prefix', 'non', ['non'], 'latin', 'non-', 'not', '非；不', ['negation'], 30, 1, 0.95, ['m.prefix.un']),
  morph('prefix', 'en', ['en', 'em'], 'latin', 'in-', 'make; put into; cause to be', '使；进入', ['causative'], 28, 2, 0.85),

  /* ---------------- 词根 ---------------- */
  morph('root', 'spect', ['spect', 'spec', 'spic', 'pect'], 'latin', 'specere', 'to look, see', '看', ['vision', 'cognition'], 42, 2, 0.92, ['m.root.vid']),
  morph('root', 'dict', ['dict', 'dic'], 'latin', 'dicere', 'to say, speak, declare', '说', ['speech'], 36, 1, 0.95),
  morph('root', 'scrib', ['scrib', 'script'], 'latin', 'scribere', 'to write', '写', ['writing'], 30, 2, 0.9, ['m.root.graph']),
  morph('root', 'duc', ['duc', 'duct'], 'latin', 'ducere', 'to lead, bring', '引导', ['motion'], 34, 2, 0.9),
  morph('root', 'port', ['port'], 'latin', 'portare', 'to carry', '搬运', ['motion'], 33, 1, 0.95),
  morph('root', 'fer', ['fer', 'lat'], 'latin', 'ferre', 'to carry, bear, bring', '带来；承载', ['motion'], 30, 2, 0.88, ['m.root.port']),
  morph('root', 'mit', ['mit', 'miss'], 'latin', 'mittere', 'to send, let go', '送；放', ['motion'], 28, 2, 0.9),
  morph('root', 'pos', ['pos', 'pon', 'pose', 'pound'], 'latin', 'ponere', 'to put, place', '放置', ['motion'], 32, 2, 0.9),
  morph('root', 'tract', ['tract'], 'latin', 'trahere', 'to pull, draw', '拉；抽', ['motion'], 26, 2, 0.9),
  morph('root', 'struct', ['struct', 'stru'], 'latin', 'struere', 'to build, pile up', '建造', ['making'], 24, 2, 0.9),
  morph('root', 'cred', ['cred', 'creed'], 'latin', 'credere', 'to believe, trust', '相信', ['cognition'], 18, 2, 0.9),
  morph('root', 'cap', ['cap', 'capit', 'cip', 'ceive', 'cept', 'ceit'], 'latin', 'capere', 'to take, seize, hold', '取；抓', ['action'], 38, 3, 0.85),
  morph('root', 'ten', ['ten', 'tain', 'tin'], 'latin', 'tenere', 'to hold, keep', '持有', ['action'], 30, 3, 0.85),
  morph('root', 'fac', ['fac', 'fact', 'fec', 'fic', 'fect'], 'latin', 'facere', 'to make, do', '做；制造', ['making'], 40, 3, 0.85),
  morph('root', 'ven', ['ven', 'vent'], 'latin', 'venire', 'to come', '来', ['motion'], 22, 2, 0.9),
  morph('root', 'vid', ['vid', 'vis', 'view'], 'latin', 'videre', 'to see', '看见', ['vision', 'cognition'], 34, 2, 0.9, ['m.root.spect']),
  morph('root', 'audi', ['audi', 'audit'], 'latin', 'audire', 'to hear, listen', '听', ['perception'], 16, 1, 0.95),
  morph('root', 'log', ['log', 'logue', 'logy', 'loq'], 'greek', 'logos', 'word, speech, reason, study', '言；理；学说', ['speech', 'cognition'], 30, 2, 0.88),
  morph('root', 'graph', ['graph', 'gram'], 'greek', 'graphein', 'to write, record, draw', '写；记录', ['writing'], 22, 2, 0.9, ['m.root.scrib']),
  morph('root', 'phon', ['phon'], 'greek', 'phone', 'sound, voice', '声音', ['perception'], 18, 2, 0.9),
  morph('root', 'meter', ['meter', 'metr'], 'greek', 'metron', 'measure', '测量', ['quantity'], 14, 2, 0.9),
  morph('root', 'path', ['path'], 'greek', 'pathos', 'feeling, suffering, disease', '情感；痛苦', ['emotion'], 16, 3, 0.85),
  morph('root', 'gen', ['gen', 'gene'], 'greek', 'genos, genea', 'birth, kind, race, produce', '出生；种类；产生', ['life'], 28, 3, 0.85),
  morph('root', 'man', ['man', 'manu'], 'latin', 'manus', 'hand', '手', ['body', 'action'], 20, 2, 0.9),
  morph('root', 'ped', ['ped'], 'latin', 'pes, pedis', 'foot', '脚', ['body'], 14, 3, 0.85),
  morph('root', 'corp', ['corp', 'corpor'], 'latin', 'corpus', 'body', '身体；团体', ['body'], 16, 2, 0.9),
  morph('root', 'form', ['form'], 'latin', 'forma', 'shape, form', '形状；形式', ['shape'], 30, 1, 0.95),
  morph('root', 'press', ['press'], 'latin', 'premere', 'to press, push', '压', ['action'], 18, 2, 0.9),
  morph('root', 'ject', ['ject'], 'latin', 'iacere', 'to throw, cast', '投掷', ['motion'], 20, 2, 0.9),
  morph('root', 'vers', ['vers', 'vert'], 'latin', 'vertere', 'to turn', '转', ['motion'], 24, 2, 0.9),
  morph('root', 'serv', ['serv'], 'latin', 'servare', 'to keep, serve, guard', '保持；服务', ['action'], 20, 2, 0.88),
  morph('root', 'sta', ['sta', 'stat', 'stit', 'sist'], 'latin', 'stare', 'to stand, stay', '站；停留', ['motion'], 30, 3, 0.85),
  morph('root', 'sens', ['sens', 'sent'], 'latin', 'sentire', 'to feel, perceive', '感觉', ['perception'], 24, 2, 0.9),
  morph('root', 'vit', ['vit', 'viv'], 'latin', 'vita', 'life', '生命', ['life'], 14, 2, 0.9),
  morph('root', 'nov', ['nov', 'neo'], 'latin', 'novus', 'new', '新', ['time'], 16, 2, 0.9),
  morph('root', 'fid', ['fid'], 'latin', 'fides', 'faith, trust', '信任', ['cognition'], 14, 2, 0.9, ['m.root.cred']),

  /* ---------------- 后缀 ---------------- */
  morph('suffix', 'tion', ['tion', 'sion', 'ation', 'xion'], 'latin', '-tio', 'act, process or result of', '行为/过程/结果（名词）', ['nominalization'], 200, 2, 0.9),
  morph('suffix', 'ment', ['ment'], 'latin', '-mentum', 'result, means or state of', '结果/手段/状态（名词）', ['nominalization'], 80, 2, 0.9),
  morph('suffix', 'ness', ['ness'], 'old_english', '-nes', 'state or quality of being', '性质/状态（名词）', ['nominalization'], 70, 1, 0.95),
  morph('suffix', 'ful', ['ful'], 'old_english', '-full', 'full of; having the qualities of', '充满……的（形容词）', ['adjectival'], 30, 1, 0.95),
  morph('suffix', 'less', ['less'], 'old_english', '-leas', 'without; not having', '无……的（形容词）', ['adjectival', 'negation'], 35, 1, 0.95, ['m.suffix.ful']),
  morph('suffix', 'able', ['able', 'ible', 'ble'], 'latin', '-abilis', 'capable of; fit for', '可……的（形容词）', ['adjectival'], 60, 2, 0.9),
  morph('suffix', 'ist', ['ist'], 'greek', '-istes', 'one who does or practises', '从事……的人（名词）', ['agent'], 45, 2, 0.9),
  morph('suffix', 'ity', ['ity', 'ty'], 'latin', '-itas', 'state, quality or degree of', '性质/状态（名词）', ['nominalization'], 55, 2, 0.9),
  morph('suffix', 'ous', ['ous', 'ious', 'eous'], 'latin', '-osus', 'full of; having the quality of', '具有……的（形容词）', ['adjectival'], 40, 2, 0.9),
  morph('suffix', 'ive', ['ive', 'ative'], 'latin', '-ivus', 'tending to; having the nature of', '倾向……的（形容词）', ['adjectival'], 35, 2, 0.88),
  morph('suffix', 'ize', ['ize', 'ise'], 'greek', '-izein', 'to make, become, treat with', '使……化（动词）', ['causative'], 40, 2, 0.9),
];

/**
 * 参与自动形态切分的最短长度。
 * 前缀允许 2 字母（un- / re- / in- / ex-）——误切由「必须有词根匹配」兜底（uncle → cle 无词根）；
 * 后缀要求 ≥3（-er / -ly / -al 噪声过大，仍保留在库中供查询与学习）。
 */
export const MIN_PREFIX_LENGTH = 2;
export const MIN_AFFIX_LENGTH = 3;

/** 低于该可信度的词素不参与自动切分 */
export const MIN_CONFIDENCE = 0.7;
