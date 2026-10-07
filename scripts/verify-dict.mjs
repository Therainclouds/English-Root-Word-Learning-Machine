/**
 * S-009 内置释义导入验收（真实运行时）
 *
 * 前置：
 *   1. npm run dev 已启动
 *   2. 已用 --remote-debugging-port=9222 启动 Edge/Chrome
 *   3. 共享词库已导入词表（否则没有可填的词）
 * 运行：node scripts/verify-dict.mjs
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
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result?.result?.value;
  };
  return { evaluate, errors, close: () => send('Page.close').catch(() => undefined) };
}

const RUN_IMPORT = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid=import-dict-btn]')) break;
    await wait(250);
  }
  const btn = document.querySelector('[data-testid=import-dict-btn]');
  if (!btn) return 'NO_BUTTON';
  btn.click();
  for (let i = 0; i < 400; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=dict-result]');
    if (pre && !pre.textContent.includes('导入中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

/** 直接读共享库统计释义就绪率（不依赖界面文案） */
const READ_COVERAGE = `(async () => {
  const openDb = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = (db, store) => new Promise(res => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
  });
  const db = await openDb('elm-shared');
  const words = await all(db, 'words');
  const cards = await all(db, 'cards');
  db.close();
  const ready = words.filter(w => w.definitionStatus === 'ready' && String(w.definitionEn ?? '').trim()).length;
  const withZh = words.filter(w => { const t = String(w.definitionL1 ?? '').trim(); return t && !t.includes('待生成'); }).length;
  const withIpa = words.filter(w => String(w.ipa ?? '').trim()).length;
  const ecDictSourced = words.filter(w => (w.sources ?? []).includes('ecdict')).length;
  return JSON.stringify({ total: words.length, ready, withZh, withIpa, ecDictSourced, cards: cards.length });
})()`;

/** 内置词典文件本身的可用性 */
const READ_DICT_FILE = `(async () => {
  const res = await fetch('/wordlists/definitions-zh.json');
  if (!res.ok) return JSON.stringify({ ok: false, status: res.status });
  const j = await res.json();
  return JSON.stringify({ ok: true, source: j.source, total: j.total, entries: Object.keys(j.entries).length, sample: j.entries['abandon'] ?? null });
})()`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const page = await openPage(`${APP}/settings/`);
await sleep(6000);

// AC-1 内置词典文件可加载
const dict = JSON.parse(await page.evaluate(READ_DICT_FILE));
record(
  'AC-1 内置词典数据可用',
  dict.ok === true && dict.entries >= 2900,
  `source=${dict.source} 词条 ${dict.entries}；示例 abandon=${JSON.stringify(dict.sample?.zh ?? '')}`,
);

const before = JSON.parse(await page.evaluate(READ_COVERAGE));

// AC-2 导入执行
const out1 = await page.evaluate(RUN_IMPORT);
const filled1 = Number(/填入释义 (\d+)/.exec(out1 ?? '')?.[1] ?? NaN);
record('AC-2 导入执行完成', typeof out1 === 'string' && out1.includes('完成'), (out1 ?? '').slice(0, 120));

const after = JSON.parse(await page.evaluate(READ_COVERAGE));
record(
  'AC-3 释义覆盖率达标（≥ 95%）',
  after.ready >= 2900 && after.withZh >= 2900 && after.ready >= before.ready,
  `就绪 ${before.ready} → ${after.ready} / ${after.total}；中文 ${after.withZh}、音标 ${after.withIpa}、标记 ecdict 来源 ${after.ecDictSourced}`,
);

// AC-4 重复导入结果稳定（词典来源可刷新，但覆盖率与内容不得退化）
const out2 = await page.evaluate(RUN_IMPORT);
const after2 = JSON.parse(await page.evaluate(READ_COVERAGE));
record(
  'AC-4 重复导入结果稳定',
  after2.ready === after.ready && after2.withZh === after.withZh && after2.total === after.total,
  `就绪 ${after.ready} → ${after2.ready}；中文 ${after.withZh} → ${after2.withZh}`,
);

record('AC-5 控制台零错误', page.errors.length === 0, page.errors.slice(0, 2).join(' | ') || '无');
await page.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n结果：**${passed}/${results.length} 通过**`);
process.exitCode = passed === results.length ? 0 : 1;
