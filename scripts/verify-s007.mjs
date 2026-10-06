/**
 * S-007 词根模块验收（真实运行时，非单测）
 * 前置：
 *   1. npm run dev 已启动
 *   2. 已用 --remote-debugging-port=9222 启动 Edge/Chrome
 * 运行：node scripts/verify-s007.mjs
 */
const CDP = process.env.CDP_BASE ?? 'http://127.0.0.1:9222';
const APP = process.env.APP_BASE ?? 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(url) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`无法打开页面：${res.status}`);
  const page = await res.json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const t = msg.params.entry.text;
      if (!t.includes('favicon')) errors.push(t);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return r.result?.result?.value;
  };

  return { evaluate, errors, close: () => send('Page.close').catch(() => undefined) };
}

const SNAPSHOT = `(async () => {
  const openDb = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = (db, store) => new Promise(res => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
  });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();

  const shared = await openDb('elm-shared');
  const morphemes = await all(shared, 'morphemes');
  const cards = await all(shared, 'cards');
  const words = await all(shared, 'words');
  const nodes = await all(shared, 'pathNodes');
  shared.close();

  const byTemplate = {};
  for (const c of cards) byTemplate[c.template] = (byTemplate[c.template] ?? 0) + 1;

  // 词素 → 派生词卡的交错组（只保留派生词 ≥3 的词素）
  const wordById = new Map(words.map(w => [w.id, w]));
  const groupsByMorpheme = {};
  for (const c of cards) {
    if (c.template !== 'word_to_morpheme') continue;
    const w = wordById.get(c.wordId);
    for (const ref of (w?.decomposition ?? [])) {
      if (ref.position !== 'root') continue;
      const set = groupsByMorpheme[ref.morphemeId] ?? new Set();
      set.add(c.interleaveGroup);
      groupsByMorpheme[ref.morphemeId] = set;
    }
  }
  const groups = {};
  for (const [id, set] of Object.entries(groupsByMorpheme)) {
    if (set.size > 0) groups[id] = [...set].sort();
  }

  // 阶段 1 节点挂载签名（count:first:last）——用于确认导入前后未被改动
  const nodeFamilies = {};
  for (const n of nodes) nodeFamilies[n.id] = (n.targetFamilyIds ?? []).length;
  const s1Signature = nodes
    .filter(n => n.id.startsWith('s1-'))
    .map(n => n.id + ':' + (n.targetFamilyIds ?? []).length + ':' + ((n.targetFamilyIds ?? [])[0] ?? '-') + ':' + ((n.targetFamilyIds ?? []).slice(-1)[0] ?? '-'))
    .join('|');

  let reviewStates = [];
  if (uid) {
    const udb = await openDb('elm-' + uid);
    reviewStates = await all(udb, 'reviewStates');
    udb.close();
  }

  return JSON.stringify({
    userId: uid,
    morphemes: morphemes.length,
    cardsTotal: cards.length,
    byTemplate,
    groups,
    nodeFamilies,
    s1Signature,
    reviewStates: reviewStates.map(s => ({ cardId: s.cardId, dueAt: s.dueAt, reps: s.reps })),
  });
})()`;

const GRADE_ONE = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('[data-testid=reveal-btn]')) break;
    await wait(250);
  }
  const reveal = document.querySelector('[data-testid=reveal-btn]');
  if (!reveal) return 'NO_CARD';
  reveal.click();
  await wait(400);
  const grade = document.querySelector('[data-testid=grade-4]');
  if (!grade) return 'NO_GRADE_BTN';
  grade.click();
  await wait(700);
  return 'GRADED';
})()`;

/** 前置：先导入真实词表（3000 词），否则共享库只有 90 个种子词，切分样本不足 */
const RUN_WORDLIST = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const res = await fetch('/wordlists/top-10000.txt');
  if (!res.ok) return 'NO_WORDLIST';
  const text = (await res.text()).split('\\\\n').filter(Boolean).slice(0, 3000).join('\\\\n');
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid=wordlist-input]')) break;
    await wait(250);
  }
  const ta = document.querySelector('[data-testid=wordlist-input]');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  document.querySelector('[data-testid=import-btn]').click();
  for (let i = 0; i < 400; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=import-result]');
    if (pre && !pre.textContent.includes('导入中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

const RUN_IMPORT = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid=import-morph-btn]')) break;
    await wait(250);
  }
  const btn = document.querySelector('[data-testid=import-morph-btn]');
  if (!btn) return 'NO_BUTTON';
  btn.click();
  for (let i = 0; i < 240; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=morph-result]');
    if (pre && !pre.textContent.includes('导入中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

const CHECK_LEARN = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('[data-testid=reveal-btn]')) break;
    await wait(250);
  }
  const front = document.querySelector('.text-3xl');
  const label = document.querySelector('.uppercase');
  return JSON.stringify({ front: front?.textContent ?? '', label: label?.textContent ?? '' });
})()`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. 先评一张卡，制造用户学习状态
const learn = await openPage(`${APP}/learn/`);
await sleep(5000);
const graded = await learn.evaluate(GRADE_ONE);
record('前置：评一张卡产生用户状态', graded === 'GRADED', graded);
const pre = JSON.parse(await learn.evaluate(SNAPSHOT));
await learn.close();
await sleep(500);

// 2. 先铺满真实词表，再导入词根库
const settings = await openPage(`${APP}/settings/`);
await sleep(5000);
const wordlistOutput = await settings.evaluate(RUN_WORDLIST);
record(
  '前置：导入 3000 词表（构造真实词库）',
  typeof wordlistOutput === 'string' && wordlistOutput.includes('完成'),
  (wordlistOutput ?? '').slice(0, 90),
);

const before = JSON.parse(await settings.evaluate(SNAPSHOT));
const output = await settings.evaluate(RUN_IMPORT);
record('导入执行完成', typeof output === 'string' && output.includes('完成'), output);

const duration = Number(/耗时 (\d+)ms/.exec(output ?? '')?.[1] ?? NaN);
record('AC-13 导入耗时 < 3s', Number.isFinite(duration) && duration < 3000, `${duration}ms`);

const after = JSON.parse(await settings.evaluate(SNAPSHOT));
record(
  'AC-6 词素数 ≥ 60',
  after.morphemes >= 60,
  `${before.morphemes ?? 0} → ${after.morphemes}`,
);

const morphCards = after.byTemplate['word_to_morpheme'] ?? 0;
const rootCards = after.byTemplate['morpheme_to_words'] ?? 0;
record(
  'AC-6 两类词根卡片已生成',
  morphCards > 0 && rootCards > 0,
  `word_to_morpheme=${morphCards} · morpheme_to_words=${rootCards}`,
);

record(
  'AC-8 阶段 1 路径节点未被改动',
  before.s1Signature === after.s1Signature,
  before.s1Signature === after.s1Signature ? '签名一致' : `${before.s1Signature} ≠ ${after.s1Signature}`,
);
record(
  'AC-8 词根挂载到 s3-root 节点',
  (after.nodeFamilies['s3-root'] ?? 0) > 0,
  `s3-root: ${before.nodeFamilies['s3-root'] ?? 0} → ${after.nodeFamilies['s3-root'] ?? 0}`,
);

const spread = Object.entries(after.groups);
const widest = spread.sort((a, b) => b[1].length - a[1].length)[0];
record(
  'AC-9 同一词根的派生卡交错分散（≥3 组）',
  !!widest && widest[1].length >= 3,
  widest ? `${widest[0]} → 组 ${widest[1].join('/')}` : '无',
);

// 3. 幂等：再导入一次
const second = await settings.evaluate(RUN_IMPORT);
const after2 = JSON.parse(await settings.evaluate(SNAPSHOT));
record('AC-7 重复导入幂等（卡片总数）', after2.cardsTotal === after.cardsTotal, `${after.cardsTotal} → ${after2.cardsTotal}`);
record('AC-7 重复导入幂等（词素数）', after2.morphemes === after.morphemes, `${after.morphemes} → ${after2.morphemes}`);
record(
  'AC-7 用户复习状态未被改动（含词表导入前后）',
  JSON.stringify(pre.reviewStates) === JSON.stringify(after2.reviewStates),
  `${pre.reviewStates.length} 条，dueAt ${pre.reviewStates[0]?.dueAt ?? '-'} → ${after2.reviewStates[0]?.dueAt ?? '-'}`,
);
record('第二次导入未新增卡片', /新增卡片 0/.test(second ?? ''), (second ?? '').slice(0, 120));
await settings.close();
await sleep(500);

// 4. 学习页可正常渲染（LLM 未启用也可学）
const learn2 = await openPage(`${APP}/learn/`);
await sleep(5000);
const rendered = JSON.parse(await learn2.evaluate(CHECK_LEARN));
record('AC-10 学习页卡片可渲染', !!rendered.front, `${rendered.label} · ${rendered.front.slice(0, 40)}`);
record('AC-10 控制台零错误', learn2.errors.length === 0, learn2.errors.slice(0, 2).join(' | ') || '无');
await learn2.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n结果：**${passed}/${results.length} 通过**`);
process.exitCode = passed === results.length ? 0 : 1;
