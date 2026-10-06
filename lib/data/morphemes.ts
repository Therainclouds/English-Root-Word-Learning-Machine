import type { Morpheme, MorphemeExplain, MorphemeOrigin, MorphemeType } from '../types';

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

const RAW_MORPHEMES: Morpheme[] = [
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

/**
 * 深度讲解（深入学习用）
 *
 * 这里只**手写高频词根作为质量标杆**：说明词源演变、异形成因、派生词的字面义合成、以及易混辨析。
 * 其余词根由 LLM 按同样的结构与口吻批量补全（设置页「批量补全词根讲解」），写回共享库后不再重复请求（D10）。
 *
 * 写作要求（也是给 LLM 的 few-shot 标准）：
 * - etymology：讲"为什么是这个意思"，要有语义演变的因果，不要只重复中文对应
 * - allomorphNote：解释异形从哪来（音变 / 同化 / 拉丁与法语双通道）
 * - derivatives：字面义合成 → 现代义，如 report = re(back) + port(carry) → 把消息带回来 → 报告
 * - confusion：说清与近义词根的**区别点**，而不是各自释义
 */
const EXPLAIN_SEED: Record<string, MorphemeExplain> = {
  'm.root.port': {
    etymology:
      '拉丁 portare =「搬运、携带」。罗马人的"搬运"既指货物也指门户（porta 门是货物进出之口），这两条线英语都继承了：transport 是"搬运到别处"，portal 是"门"。核心始终是"把东西从 A 处带到 B 处"。',
    allomorphNote: '形位稳定，几乎只有 port 一形（portable / porter / export 皆同）。注意 port 单独作名词是"港口"，正是"货物进出之口"。',
    derivatives: [
      { word: 'transport', gloss: 'trans(across) + port(carry) → 横着搬运 → 运输' },
      { word: 'export', gloss: 'ex(out) + port → 运出去 → 出口' },
      { word: 'import', gloss: 'im(in) + port → 运进来 → 进口' },
      { word: 'support', gloss: 'sup(under) + port → 在下面扛着 → 支持' },
      { word: 'report', gloss: 're(back) + port → 把消息带回来 → 报告' },
    ],
    confusion:
      '与 fer（to carry）区分：port 偏"位置搬运/运输"（有明确的起点终点），fer 偏"承载、带来"（refer / transfer / suffer），且 fer 另有 lat 异形。',
  },
  'm.root.spect': {
    etymology:
      '拉丁 specere =「看」。罗马人用"看"造出一整族词：看的人（spectator）、被看的事物（spectacle）、在下面偷偷看（suspect）。进入英语后核心义从"用眼看"扩展到"审视、观点"——perspective 就是"透过…看"→ 视角。',
    allomorphNote:
      '有四个形：spect 是基本形（inspect）；spec 见于 spectacle / species；spic 是元音弱化（suspicious = su + spic）；pect 是词首 s 脱落（expect = ex + pect）。',
    derivatives: [
      { word: 'inspect', gloss: 'in(into) + spect → 往里看 → 检查' },
      { word: 'respect', gloss: 're(again) + spect → 一再回看、看重 → 尊重' },
      { word: 'suspect', gloss: 'sus(under) + spect → 在下面偷偷看 → 怀疑' },
      { word: 'prospect', gloss: 'pro(forward) + spect → 向前看 → 前景' },
      { word: 'expect', gloss: 'ex(out) + pect → 向外张望等待 → 期待' },
    ],
    confusion:
      '三条"看"要分清：spect（拉丁"看"的动作）、vid/vis（拉丁"看见"，偏结果：video / visible）、scope（希腊"看/观察工具"：telescope / microscope）。',
  },
  'm.root.dict': {
    etymology:
      '拉丁 dicere =「说、宣告」。古罗马的"说"带权威意味（dictator 是说话算数的人），所以 dict 系词常含"规定、权威地说"：dictate 是口述/命令，dictionary 是收录说法的书。',
    allomorphNote: 'dict 与 dic 交替：名词与结合形多用 dict（diction / predict），-ate 等动词后缀前可能出现 dic。拼写上以 dict 为主。',
    derivatives: [
      { word: 'predict', gloss: 'pre(before) + dict → 事先说 → 预测' },
      { word: 'contradict', gloss: 'contra(against) + dict → 说反话 → 反驳' },
      { word: 'dictate', gloss: 'dict + ate → 说出来让人记下 → 口述；引申为命令' },
      { word: 'addict', gloss: 'ad(toward) + dict → 原义"被指派、献身于" → 上瘾' },
    ],
    confusion:
      '与希腊词根 log（word / reason）分工：dict 偏日常与权威语境（predict / contradict），log 偏学术（dialogue / -ology）。',
  },
  'm.root.scrib': {
    etymology:
      '拉丁 scribere =「写」，原义是"用尖笔在蜡板上划刻"——所以它天生带"留下痕迹"的意味。英语里 scrib 多用于"书写行为与文件"，与希腊的 graph（写、画、记录）大致分工。',
    allomorphNote: 'scrib 出现在动词（describe / prescribe / subscribe），script 出现在名词与分词（script / description / manuscript）。',
    derivatives: [
      { word: 'describe', gloss: 'de(down) + scrib → 写下来 → 描述' },
      { word: 'prescribe', gloss: 'pre(before) + scrib → 事先写好 → 开处方 / 规定' },
      { word: 'subscribe', gloss: 'sub(under) + scrib → 在文件下面签名 → 订阅 / 认购' },
      { word: 'manuscript', gloss: 'manu(hand) + script → 手写的 → 手稿' },
    ],
    confusion: '与 graph（希腊"写/画"）区分：-graph 常带"图、记录仪"意味（photograph / paragraph / telegraph）。',
  },
  'm.root.duc': {
    etymology:
      '拉丁 ducere =「引导、牵引」。核心是"带着走"：把人带向某处（conduct）、把水引过去（aqueduct 高架渠）、把孩子带大（educate 原义"引出来、养育"）。',
    allomorphNote: 'duc 出现在动词（produce / reduce / introduce），duct 多出现在名词与过去分词（product / conductor / duct 管道）。',
    derivatives: [
      { word: 'produce', gloss: 'pro(forward) + duc → 向前引出 → 生产' },
      { word: 'reduce', gloss: 're(back) + duc → 往回引 → 减少' },
      { word: 'conduct', gloss: 'con(together) + duc → 带着一起走 → 引导 / 指挥' },
      { word: 'education', gloss: 'e(out) + duc → 把（潜能）引出来 → 教育' },
    ],
    confusion: '与 fer（carry）都含"带"：duc 强调"引领方向"，fer 强调"承载移动"。aqueduct（引水道）对比 transfer（转移）。',
  },
  'm.root.fer': {
    etymology:
      '拉丁 ferre =「携带、承受」。它是不规则动词，完成时词干变成 lat，于是英语里 fer 与 lat 两形同义并存：transfer / translate 是同一个词根的两种形态。核心是"从一处带到另一处"，并引申为"承受"（suffer = 在下面承受）。',
    allomorphNote: 'fer 用于多数情况（transfer / prefer / refer）；lat 出现在 -ion / -ive 等后缀前（translation / relative / collate）。',
    derivatives: [
      { word: 'transfer', gloss: 'trans(across) + fer → 横着带过去 → 转移' },
      { word: 'refer', gloss: 're(back) + fer → 带回到…上 → 参考 / 提及' },
      { word: 'prefer', gloss: 'pre(before) + fer → 放到前面 → 更喜欢' },
      { word: 'translate', gloss: 'trans + lat → 把意义带过去 → 翻译' },
    ],
    confusion: '与 port 区分：fer 是"携带、承载"（可带抽象物：preference），port 是"运输、搬运"（偏具体位移）。',
  },
  'm.root.mit': {
    etymology:
      '拉丁 mittere =「送、放手」。核心动作是"让…离开自己"：送出（submit → 提交）、放出（emit → 发射）、放开允许（permit → 许可）。"发送"这个动作天然带方向，所以搭配的前缀决定意思。',
    allomorphNote: 'mit 出现在动词（submit / permit / commit），miss 出现在名词与形容词（mission / missile / permission）。',
    derivatives: [
      { word: 'submit', gloss: 'sub(under) + mit → 送到下面 → 提交；引申为服从' },
      { word: 'permit', gloss: 'per(through) + mit → 放它过去 → 许可' },
      { word: 'commit', gloss: 'com(together) + mit → 一起交托出去 → 承诺；引申为犯（错）' },
      { word: 'mission', gloss: 'miss + ion → 被送去（要做的事）→ 使命' },
    ],
    confusion: '与 pos（放置）区分：mit 强调"使离开、发送"，pos 强调"放在某处不动"。submit vs deposit 是典型对照。',
  },
  'm.root.pos': {
    etymology:
      '拉丁 ponere =「放置、摆放」。核心是"把东西放在某个位置"，引申出"设定、假定、姿态"：position 是位置，posture 是姿势，suppose 是"放在下面当基础"→ 假设。',
    allomorphNote: 'pos / pose 最常见（compose / position）；pon 出现在 -ent 前（component / proponent）；pound 是日耳曼化形式（compound / expound）。',
    derivatives: [
      { word: 'compose', gloss: 'com(together) + pos → 放在一起 → 组成 / 作曲' },
      { word: 'oppose', gloss: 'op(against) + pos → 放在对面 → 反对' },
      { word: 'suppose', gloss: 'sup(under) + pos → 放在下面作为基础 → 假设' },
      { word: 'deposit', gloss: 'de(down) + pos → 放下 → 存放 / 押金' },
    ],
    confusion: '与 sta（站立）、mit（发送）三者常混：pos 是"放到某处"（有动作），sta 是"站在某处"（状态），mit 是"送出去"。',
  },
};

/** 合并标杆讲解后的种子词素（导入器与离线自检都读这个） */
export const SEED_MORPHEMES: Morpheme[] = RAW_MORPHEMES.map((m) =>
  EXPLAIN_SEED[m.id] ? { ...m, explain: EXPLAIN_SEED[m.id] } : m,
);

/** 低于该可信度的词素不参与自动切分 */
export const MIN_CONFIDENCE = 0.7;
