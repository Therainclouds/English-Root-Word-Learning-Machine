/**
 * S-001 验收测试（真实运行时，非单测）
 * 前置：
 *   1. npm run dev 已启动
 *   2. 已用 --remote-debugging-port=9222 启动 Edge/Chrome
 *   3. node scripts/fetch-wordlist.mjs 3000 已生成 public/wordlists/top-10000.txt
 * 运行：node scripts/verify-s001.mjs
 */
const CDP = process.env.CDP_BASE ?? 'http://127.0.0.1:9222';
const APP = process.env.APP_BASE ?? 'http://localhost:3000';
const IMPORT_ROWS = Number(process.env.IMPORT_ROWS ?? 3000);

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
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const names = (await indexedDB.databases()).map(d => d.name).sort();
  const counts = {};
  for (const n of names) {
    const db = await openDb(n);
    counts[n] = {};
    for (const s of Array.from(db.objectStoreNames)) {
      counts[n][s] = await new Promise(res => {
        const c = db.transaction(s).objectStore(s).count();
        c.onsuccess = () => res(c.result);
      });
    }
    db.close();
  }
  const udb = await openDb('elm-' + uid);
  const states = await new Promise(res => {
    const r = udb.transaction('reviewStates').objectStore('reviewStates').getAll();
    r.onsuccess = () => res(r.result);
  });
  udb.close();
  return JSON.stringify({
    userId: uid,
    counts,
    reviewStates: states.map(s => ({ cardId: s.cardId, dueAt: s.dueAt, reps: s.reps })),
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

const runImport = (rows) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const res = await fetch('/wordlists/top-10000.txt');
  if (!res.ok) return 'NO_WORDLIST';
  const text = (await res.text()).split('\\n').filter(Boolean).slice(0, ${rows}).join('\\n');
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
  for (let i = 0; i < 240; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=import-result]');
    if (pre && !pre.textContent.includes('导入中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. 先在学习页评一张卡，制造用户学习状态
const learn = await openPage(`${APP}/learn/`);
await sleep(5000);
const graded = await learn.evaluate(GRADE_ONE);
record('前置：评一张卡产生用户状态', graded === 'GRADED', graded);
const before = JSON.parse(await learn.evaluate(SNAPSHOT));
await learn.close();
await sleep(500);

const beforeUser = before.counts[`elm-${before.userId}`] ?? {};
record(
  '前置：用户库存在复习状态',
  (beforeUser.reviewStates ?? 0) >= 1,
  `reviewStates=${beforeUser.reviewStates ?? 0}`,
);

// 2. 导入 3000 词
const settings = await openPage(`${APP}/settings/`);
await sleep(5000);
const importOutput = await settings.evaluate(runImport(IMPORT_ROWS));
record('导入执行完成', typeof importOutput === 'string' && importOutput.includes('完成'), importOutput);

const after = JSON.parse(await settings.evaluate(SNAPSHOT));
const sharedBefore = before.counts['elm-shared'] ?? {};
const sharedAfter = after.counts['elm-shared'] ?? {};

record(
  'AC-1 词族计数 ≥ 3000',
  (sharedAfter.wordFamilies ?? 0) >= 3000,
  `${sharedBefore.wordFamilies ?? 0} → ${sharedAfter.wordFamilies ?? 0}`,
);
record(
  'AC-2 卡片数 = 词条数 × 2',
  sharedAfter.cards === sharedAfter.words * 2,
  `cards=${sharedAfter.cards} words=${sharedAfter.words}`,
);
record(
  'AC-4 用户复习状态未被改动',
  JSON.stringify(before.reviewStates) === JSON.stringify(after.reviewStates),
  `${before.reviewStates.length} 条，dueAt ${before.reviewStates[0]?.dueAt ?? '-'} → ${after.reviewStates[0]?.dueAt ?? '-'}`,
);

// 3. 幂等：再导入一次
const secondOutput = await settings.evaluate(runImport(IMPORT_ROWS));
const after2 = JSON.parse(await settings.evaluate(SNAPSHOT));
const shared2 = after2.counts['elm-shared'] ?? {};
record('AC-3 重复导入幂等（词族）', shared2.wordFamilies === sharedAfter.wordFamilies, `${sharedAfter.wordFamilies} → ${shared2.wordFamilies}`);
record('AC-3 重复导入幂等（卡片）', shared2.cards === sharedAfter.cards, `${sharedAfter.cards} → ${shared2.cards}`);

// 4. 路径节点挂载
const nodeCheck = await settings.evaluate(`(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const db = await openDb('elm-shared');
  const nodes = await new Promise(res => { const r = db.transaction('pathNodes').objectStore('pathNodes').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  const nonEmpty = nodes.filter(n => n.targetFamilyIds.length).map(n => n.id + ':' + n.targetFamilyIds.length);
  const all = nodes.flatMap(n => n.targetFamilyIds);
  const unique = new Set(all).size === all.length;
  return JSON.stringify({ nonEmpty, unique, total: nodes.length });
})()`);
const nodeInfo = JSON.parse(nodeCheck);
record('AC-5 路径节点挂载非空且不重复', nodeInfo.nonEmpty.length >= 4 && nodeInfo.unique, nodeInfo.nonEmpty.join(' '));

record('控制台无错误', settings.errors.length === 0, settings.errors.slice(0, 3).join(' | '));
record('第二次导入回显', secondOutput.includes('完成'), String(secondOutput).slice(0, 160));

await settings.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过 ===`);
process.exitCode = failed.length ? 1 : 0;
