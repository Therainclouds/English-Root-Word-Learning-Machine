/**
 * S-007 词根数据离线自检（纯 node，不需要浏览器与 dev server）
 *
 * 做法：把涉及的 TS 编译到临时目录（CommonJS）后 require，
 * 因此对真实源码做校验，不存在"测试里另写一份数据"的漂移。
 *
 * 运行：node scripts/verify-morphemes.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscBin = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

/** 期望能切出的词（正例） */
const EXPECT_SEGMENTED = [
  'inspect', 'respect', 'prospect', 'suspect', 'expect', 'construct', 'instruct',
  'destruction', 'production', 'conduct', 'produce', 'reduce', 'report', 'support',
  'transport', 'portable', 'prefer', 'transfer', 'refer', 'submit', 'commit',
  'transmit', 'position', 'possible', 'compose', 'oppose', 'suppose', 'predict',
  'prevent', 'invent', 'convention', 'provide', 'audible', 'corporation',
  'information', 'reform', 'transform', 'conform', 'express', 'impress',
  'describe', 'prescribe', 'office', 'observe', 'preserve', 'deserve',
  'conserve', 'conversation', 'review', 'concept', 'except',
];

/**
 * 期望切不出来的词（防误切回归）
 *
 * 注意：词素库扩充后，一些原先"切不出"的词变得**可以正确切分**了，
 * 例如 president = pre + sid + ent（"坐在前面的人"）、insect = in + sect（"切成两段"）、
 * accept = ac + cept、perform = per + form —— 这些应当移出本列表，而不是当成误切。
 * 这里只保留真正不可切分的日常本族词与外来借词。
 */
const EXPECT_UNSEGMENTED = [
  'interest', 'internal', 'instance', 'public', 'problem', 'member', 'number',
  'order', 'water', 'never', 'under', 'enter', 'center', 'after', 'letter',
  'better', 'matter', 'consider', 'remember', 'together', 'another', 'either',
  'children', 'universe', 'evidence', 'service', 'event', 'port', 'form',
  'credit', 'visit', 'video', 'maintain', 'difficult', 'general', 'insert',
  'uniform', 'machine', 'school', 'country', 'language', 'money', 'people',
  'system',
];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function compile() {
  if (!existsSync(tscBin)) throw new Error(`未找到 typescript：${tscBin}`);
  // 输出到项目内临时目录：lib/utils.ts 依赖 clsx，放在系统临时目录会解析不到 node_modules
  const out = mkdtempSync(join(root, '.verify-tmp-'));
  const res = spawnSync(
    process.execPath,
    [
      tscBin,
      'lib/types.ts',
      'lib/data/morphemes.ts',
      'lib/data/morph-segment.ts',
      'lib/utils.ts',
      'lib/srs.ts',
      'lib/quiz.ts',
      '--outDir', out,
      '--rootDir', '.',
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node',
      '--skipLibCheck',
      '--strict',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`tsc 编译失败：\n${res.stdout ?? ''}${res.stderr ?? ''}`);
  }
  return out;
}

const outDir = compile();
const require = createRequire(import.meta.url);

try {
  const { SEED_MORPHEMES } = require(join(outDir, 'lib/data/morphemes.js'));
  const { buildMorphemeIndex, segmentWord, needsGlue, needsMnemonic } = require(
    join(outDir, 'lib/data/morph-segment.js'),
  );

  const index = buildMorphemeIndex(SEED_MORPHEMES);
  const byId = new Map(SEED_MORPHEMES.map((m) => [m.id, m]));

  /* AC-1 种子数据完整性 */
  const ids = SEED_MORPHEMES.map((m) => m.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  const badShape = SEED_MORPHEMES.filter(
    (m) =>
      !m.form ||
      !Array.isArray(m.allomorphs) ||
      !m.allomorphs.includes(m.form) ||
      !/^m\.(root|prefix|suffix|combining_form)\./.test(m.id) ||
      m.id !== `m.${m.type}.${m.form}` ||
      !(m.confidence >= 0 && m.confidence <= 1) ||
      !(m.productivity > 0),
  );
  const byType = SEED_MORPHEMES.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, {});
  check(
    'AC-1 种子数据完整性',
    SEED_MORPHEMES.length >= 60 && dupIds.length === 0 && badShape.length === 0,
    `${SEED_MORPHEMES.length} 条（前缀 ${byType.prefix ?? 0} · 词根 ${byType.root ?? 0} · 后缀 ${byType.suffix ?? 0}）；` +
      `重复 id ${dupIds.length}；结构异常 ${badShape.length}`,
  );

  /* AC-2 引用完整性 + AC-3 切分可复原 + AC-4 字面义非空 */
  const all = [...EXPECT_SEGMENTED, ...EXPECT_UNSEGMENTED];
  const segments = new Map(all.map((w) => [w, segmentWord(w, index)]));

  const missingRefs = [];
  const notRestorable = [];
  const emptyGlue = [];
  for (const [word, res] of segments) {
    if (res.status !== 'segmented') continue;
    for (const ref of res.refs) if (!byId.has(ref.morphemeId)) missingRefs.push(`${word}:${ref.morphemeId}`);
    const joined = res.refs.map((r) => r.allomorph).join('');
    if (word.length - joined.length > 1) notRestorable.push(`${word}: ${joined}`);
    if (!res.literalGlue.trim()) emptyGlue.push(word);
  }
  check('AC-2 词素引用完整性', missingRefs.length === 0, missingRefs.join(', ') || '全部命中');
  check('AC-3 切分可复原（差 ≤1 字符）', notRestorable.length === 0, notRestorable.join(' | ') || '全部可复原');
  check('AC-4 已切分词的字面义非空', emptyGlue.length === 0, emptyGlue.join(', ') || '全部非空');

  /* AC-5 易混词素指向存在 */
  const dangling = SEED_MORPHEMES.flatMap((m) =>
    m.confusingWith.filter((id) => !byId.has(id)).map((id) => `${m.id} → ${id}`),
  );
  check('AC-5 易混词素指向存在', dangling.length === 0, dangling.join(', ') || '全部命中');

  /* AC-6 正例切出率 */
  const hit = EXPECT_SEGMENTED.filter((w) => segments.get(w).status === 'segmented');
  const missed = EXPECT_SEGMENTED.filter((w) => segments.get(w).status !== 'segmented');
  check(
    'AC-6 正例切出率 ≥ 90%',
    hit.length / EXPECT_SEGMENTED.length >= 0.9,
    `${hit.length}/${EXPECT_SEGMENTED.length}${missed.length ? `；未切出：${missed.join(', ')}` : ''}`,
  );

  /* AC-7 防误切回归 */
  const falsePositive = EXPECT_UNSEGMENTED.filter((w) => segments.get(w).status === 'segmented');
  check(
    'AC-7 噪声词零误切',
    falsePositive.length === 0,
    falsePositive.length ? `误切：${falsePositive.join(', ')}` : `${EXPECT_UNSEGMENTED.length} 个噪声词全部 unsegmented`,
  );

  /* AC-8 LLM 补全的触发条件（D10：只补助记与字面义，且不得重复请求） */
  const ruleGlue = { morphStatus: 'segmented', literalGlue: '[in] into, in + [spect] to look, see' };
  const polished = { morphStatus: 'segmented', literalGlue: 'to look into' };
  const unsegmentedWord = { morphStatus: 'unsegmented', literalGlue: '[in] into, in' };
  const bareMorpheme = { id: 'm.root.spect' };
  const richMorpheme = { id: 'm.root.spect', mnemonic: { story: '看（spect）→ 眼镜 spectacle' } };

  const glueOk =
    needsGlue(ruleGlue) === true &&
    needsGlue(polished) === false &&
    needsGlue(unsegmentedWord) === false &&
    needsMnemonic(bareMorpheme) === true &&
    needsMnemonic(richMorpheme) === false;
  check(
    'AC-8 LLM 补全触发条件（幂等）',
    glueOk,
    glueOk ? '规则版需润色、已润色/未切分跳过；缺助记才生成' : '判定不符预期',
  );

  /* AC-9 深度讲解的格式闸门（词源演变 / 派生词逐词拆解必须规范） */
  const withExplain = SEED_MORPHEMES.filter((m) => m.explain?.etymology);
  const badEtymology = withExplain.filter(
    (m) => m.explain.etymology.trim().length < 30 || m.explain.etymology.trim().length > 600,
  );
  const badDerivatives = withExplain.flatMap((m) =>
    (m.explain.derivatives ?? [])
      .filter((d) => !d.word?.trim() || !d.gloss?.includes('→'))
      .map((d) => `${m.id}:${d.word}`),
  );
  const tooShortExplain = withExplain.filter((m) => (m.explain.etymology ?? '').includes('。') === false);
  check(
    'AC-9 讲解格式（标杆）',
    withExplain.length >= 8 && badEtymology.length === 0 && badDerivatives.length === 0,
    `${withExplain.length} 条讲解；长度异常 ${badEtymology.length}；派生词格式异常 ${badDerivatives.length}` +
      (badDerivatives.length ? ` → ${badDerivatives.slice(0, 3).join(', ')}` : '') +
      (tooShortExplain.length ? `；疑似缺句读 ${tooShortExplain.length}` : ''),
  );

  /* AC-10 误切黑名单生效（防回归：名单里的词一律不得被切分） */
  const { NON_SEGMENTABLE } = require(join(outDir, 'lib/data/morph-segment.js'));
  const blackHits = [...NON_SEGMENTABLE].filter((w) => segmentWord(w, index).status === 'segmented');
  check(
    'AC-10 误切黑名单生效',
    NON_SEGMENTABLE.size >= 10 && blackHits.length === 0,
    `${NON_SEGMENTABLE.size} 个受保护词；仍被切分 ${blackHits.length}` +
      (blackHits.length ? ` → ${blackHits.join(', ')}` : ''),
  );

  /* AC-11 词根卡独立预算（D11）：两边互不挤占 */
  const { buildSession, isMorphemeCard, MORPH_DAILY_NEW_LIMIT } = require(join(outDir, 'lib/srs.js'));

  const stage1Cards = ['alpha', 'beta'].map((k) => ({
    id: `w.${k}:rec`, familyId: 'f1', wordId: `w.${k}`, template: 'word_to_meaning',
    direction: 'receptive', front: k, back: k, interleaveGroup: 0,
  }));
  const morphCards = [
    { id: 'w.inspect:morph', template: 'word_to_morpheme', direction: 'receptive' },
    { id: 'm.root.spect:prod', template: 'morpheme_to_words', direction: 'productive' },
  ].map((c) => ({ ...c, familyId: '', wordId: '', front: c.id, back: c.id, interleaveGroup: 1 }));
  const sessionCards = [...stage1Cards, ...morphCards];
  const none = new Map();

  // 阶段 1 额度用尽 → 不应再派普通新卡，但词根卡仍按自己的预算派
  const s1Full = buildSession({ cards: sessionCards, states: none, newLimit: 2, learnedToday: 2, morphLearnedToday: 0 });
  // 词根额度用尽 → 不应再派词根卡，普通卡不受影响
  const morphFull = buildSession({
    cards: sessionCards, states: none, newLimit: 2, learnedToday: 0,
    morphLearnedToday: MORPH_DAILY_NEW_LIMIT,
  });
  const bothFree = buildSession({ cards: sessionCards, states: none, newLimit: 2, learnedToday: 0, morphLearnedToday: 0 });

  const budgetOk =
    isMorphemeCard(morphCards[0]) === true &&
    isMorphemeCard(stage1Cards[0]) === false &&
    s1Full.queue.length === 2 && s1Full.queue.every((c) => isMorphemeCard(c)) &&
    morphFull.queue.length === 2 && morphFull.queue.every((c) => !isMorphemeCard(c)) &&
    bothFree.morphNewCount === 2 && bothFree.newCount === 4;
  check(
    'AC-11 词根卡独立预算（D11）',
    budgetOk,
    budgetOk
      ? `阶段 1 用尽仍派 ${s1Full.queue.length} 张词根卡；词根用尽仍派 ${morphFull.queue.length} 张普通卡`
      : JSON.stringify({ s1: s1Full.queue.length, morph: morphFull.queue.length, both: bothFree.newCount }),
  );

  /* AC-12 客观判定不得把正确答案判错：产出卡答案完整 + 干扰项语义不重叠 */
  const { buildQuiz } = require(join(outDir, 'lib/quiz.js'));

  const derivations = Array.from({ length: 12 }, (_, i) => `deriv${i}`);
  const prodCard = {
    id: 'm.root.spect:prod', familyId: '', wordId: '', template: 'morpheme_to_words',
    direction: 'productive', front: 'spect — to look', back: derivations.join(', '), interleaveGroup: 0,
  };
  const prodQuiz = buildQuiz(prodCard, undefined, []);
  const ninthAnswerable = prodQuiz?.answers.includes('deriv8') === true;

  const similarWords = [
    { id: 'w1', definitionL1: '关于；大约' },
    { id: 'w2', definitionL1: '大约' },        // 与正确答案互相包含，不能当干扰项
    { id: 'w3', definitionL1: '机器' },
    { id: 'w4', definitionL1: '国家' },
    { id: 'w5', definitionL1: '语言' },
  ];
  const meaningCard = {
    id: 'w.about:rec', familyId: 'f', wordId: 'w1', template: 'word_to_meaning',
    direction: 'receptive', front: 'about', back: '大约', interleaveGroup: 0,
  };
  const meaningQuiz = buildQuiz(meaningCard, similarWords[0], similarWords);
  const noOverlap = meaningQuiz?.choices.includes('大约') === false;

  check(
    'AC-12 判定不误伤正确答案',
    prodQuiz?.answers.length === 12 && ninthAnswerable && noOverlap === true,
    `派生词答案 ${prodQuiz?.answers.length}/12（第 9 个可判对 ${ninthAnswerable}）；` +
      `相似释义未进选项 ${noOverlap}`,
  );

  /* AC-13 排程引擎（FSRS-6）与目标保持率必须真实生效 */
  const {
    schedule, configureScheduler, createInitialState, currentRetention, retentionOf, FSRS_BASE_PARAMS,
  } = require(join(outDir, 'lib/srs.js'));

  const probeCard = { id: 'w.probe:rec', direction: 'receptive', interleaveGroup: 0 };
  const probeSeq = (retention) => {
    configureScheduler(retention);
    let state = createInitialState(probeCard);
    const seq = [];
    let now = Date.now();
    for (let i = 0; i < 4; i += 1) {
      state = schedule(state, 4, now); // 4 = 答对（D12 的 GRADE_RIGHT）
      seq.push(state.intervalDays);
      now = state.dueAt;
    }
    return seq;
  };
  const seq90 = probeSeq(0.9);
  const seq95 = probeSeq(0.95);
  const engineOk =
    seq90.length === 4 &&
    seq90[0] === 0 && // 首次答对仍在学习步骤内（分钟级，尚未排到天级间隔）
    seq90[3] > seq90[0] + 5 && // 间隔必须随成功复习持续增长
    seq95[3] < seq90[3] && // 目标保持率越高，间隔越短
    FSRS_BASE_PARAMS.enable_short_term === true && // 分钟级学习步骤已启用（学习页为快照式队列）
    Array.isArray(FSRS_BASE_PARAMS.learning_steps) &&
    FSRS_BASE_PARAMS.learning_steps.length === 2 &&
    FSRS_BASE_PARAMS.maximum_interval === 365;
  check(
    'AC-13 FSRS 排程 + 学习步骤 + 目标保持率',
    engineOk && currentRetention() === 0.95,
    `保持率 0.9 → ${seq90.join('/')} 天；0.95 → ${seq95.join('/')} 天（首项 0 天＝仍在分钟级步骤）；当前生效 ${currentRetention()}`,
  );

  /* AC-14 旧数据迁移：SM-2 时代的 0–1 stability 不能被当成"不到 1 天" */
  configureScheduler(0.9);
  const legacyState = {
    cardId: 'w.legacy:rec', dueAt: Date.now(), intervalDays: 35, lapses: 0, reps: 4,
    direction: 'receptive', stability: 0.8, interleaveGroup: 0,
    lastReviewedAt: Date.now() - 35 * 86400000,
  };
  const migratedNext = schedule(legacyState, 4, Date.now());
  check(
    'AC-14 旧状态迁移（0–1 → 天数）',
    migratedNext.intervalDays >= 21 && migratedNext.difficulty >= 1 && migratedNext.difficulty <= 10,
    `旧用户（已复习 4 次 / 上次间隔 35 天）再答对一次 → 下次 ${migratedNext.intervalDays} 天，D=${migratedNext.difficulty.toFixed(2)}`,
  );

  /* AC-16 会话队列推进：分钟级到期的卡必须追加到**队尾**（不能顶掉当前题） */
  const { reviveDue } = require(join(outDir, 'lib/srs.js'));
  const baseQueue = ['a', 'b', 'c'];
  const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'd' }, { id: 'e' }];
  const now2 = Date.now();
  const dueAtMap = { a: 0, b: 0, d: now2 - 1000, e: now2 + 60000 };
  const advanced = reviveDue(baseQueue, candidates, (id) => dueAtMap[id] ?? Infinity, now2);
  const unchanged = reviveDue(baseQueue, [], () => 0, now2);
  const queueOk =
    JSON.stringify(advanced) === JSON.stringify(['a', 'b', 'c', 'd']) && // 已在队列的忽略、未到期的忽略、到期的追加队尾
    advanced !== baseQueue &&
    unchanged === baseQueue; // 无变化时返回原引用（避免 setState 空更新）
  check(
    'AC-16 到期卡追加到队尾',
    queueOk,
    `['a','b','c'] + 到期 d、未到期 e → ${JSON.stringify(advanced)}；无变化时返回原引用 ${unchanged === baseQueue}`,
  );

  /* AC-15 实际保持率统计（零参数的个体基准指标） */
  const statLogs = [...Array(80).fill({ grade: 4 }), ...Array(20).fill({ grade: 0 })];
  const stats = retentionOf(statLogs);
  const emptyStats = retentionOf([]);
  check(
    'AC-15 实际保持率统计',
    Math.abs(stats.rate - 0.8) < 1e-9 && stats.sample === 100 && stats.enough === true && emptyStats.rate === null,
    `80/100 → ${stats.rate}（样本 ${stats.sample}）；空样本 → ${emptyStats.rate}`,
  );

  /* 附加观测：对真实词表的切出率（有词表文件时才跑，不作断言） */
  const listPath = join(root, 'public/wordlists/top-10000.txt');
  if (existsSync(listPath)) {
    const words = readFileSync(listPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.split(/[\t,]/)[0].trim().toLowerCase())
      .filter((w) => /^[a-z]{4,}$/.test(w));
    const n = Math.min(words.length, 3000);
    const startedAt = Date.now();
    let count = 0;
    for (let i = 0; i < n; i += 1) if (segmentWord(words[i], index).status === 'segmented') count += 1;
    console.log(`ℹ️  词表观测：前 ${n} 词切出 ${count} 个（${((count / n) * 100).toFixed(1)}%），耗时 ${Date.now() - startedAt}ms`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n结果：**${passed}/${results.length} 通过**`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
