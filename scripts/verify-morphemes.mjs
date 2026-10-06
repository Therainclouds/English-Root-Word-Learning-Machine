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

/** 期望切不出来的词（防误切回归：日常高频本族词与噪声） */
const EXPECT_UNSEGMENTED = [
  'interest', 'internal', 'instance', 'public', 'problem', 'member', 'number',
  'order', 'water', 'never', 'under', 'enter', 'center', 'after', 'letter',
  'better', 'matter', 'consider', 'remember', 'together', 'another', 'either',
  'children', 'universe', 'evidence', 'audience', 'service', 'event', 'port',
  'form', 'credit', 'visit', 'video', 'capture', 'accept', 'maintain',
  'difficult', 'manage', 'manual', 'generate', 'general', 'president',
  'resident', 'incident', 'insect', 'insert', 'concert', 'uniform', 'perform',
  'permit', 'admit', 'insect',
];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function compile() {
  if (!existsSync(tscBin)) throw new Error(`未找到 typescript：${tscBin}`);
  const out = mkdtempSync(join(tmpdir(), 'elm-morph-'));
  const res = spawnSync(
    process.execPath,
    [
      tscBin,
      'lib/types.ts',
      'lib/data/morphemes.ts',
      'lib/data/morph-segment.ts',
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
  check(
    'AC-1 种子数据完整性',
    SEED_MORPHEMES.length >= 60 && dupIds.length === 0 && badShape.length === 0,
    `${SEED_MORPHEMES.length} 条；重复 id ${dupIds.length}；结构异常 ${badShape.length}`,
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
