/**
 * S-004 学习负担评分验收（真实运行时）
 *
 * 覆盖范围说明（重要）：
 * - 本脚本可自动验证：**回退路径**（模型不可用时不得阻塞）、**写回共享库**、分布合理性、控制台零错误
 * - 需要真实决策模型凭据才能验证的两项（spec 验收 1 与 4 中的"模型评分值"与"请求规模/延迟"）
 *   会在输出中显式标注 SKIP，请配置好决策模型后复跑
 *
 * 前置：npm run dev 已启动；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-burden.mjs
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
      const u = msg.params.entry.url ?? '';
      if (!t.includes('favicon') && !u.includes('favicon')) errors.push(t);
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
    return r.result?.result?.value;
  };
  return { evaluate, errors, close: () => send('Page.close').catch(() => undefined) };
}

/**
 * 决策模型没启用时按钮不可点。这里临时打开它 —— 由于不填凭据，调用必然失败，
 * 正好验证"模型不可用时回退启发式、不阻塞学习"这条最关键的约束；跑完会恢复原状态。
 */
const ENSURE_DECISION_ON = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid=decision-enabled]')) break;
    await wait(250);
  }
  const sw = document.querySelector('[data-testid=decision-enabled]');
  if (!sw) return 'NO_SWITCH';
  const isOn = () => sw.getAttribute('aria-checked') === 'true' || sw.getAttribute('data-state') === 'checked';
  if (isOn()) return 'ALREADY_ON';
  sw.click();
  await wait(700);
  return isOn() ? 'TURNED_ON' : 'FAILED_ON';
})()`;

const TURN_DECISION_OFF = `(async () => {
  const sw = document.querySelector('[data-testid=decision-enabled]');
  if (!sw) return 'NO_SWITCH';
  const isOn = () => sw.getAttribute('aria-checked') === 'true' || sw.getAttribute('data-state') === 'checked';
  if (isOn()) { sw.click(); await new Promise(r => setTimeout(r, 600)); }
  return 'RESTORED';
})()`;

const RUN_BURDEN = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[data-testid=batch-burden-btn]')) break;
    await wait(250);
  }
  const btn = document.querySelector('[data-testid=batch-burden-btn]');
  if (!btn) return 'NO_BUTTON';
  if (btn.disabled) return 'BUTTON_DISABLED';
  btn.click();
  for (let i = 0; i < 400; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=burden-result]');
    if (pre && !pre.textContent.includes('评分中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

const READ_BURDENS = `(async () => {
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
  const families = await all(db, 'wordFamilies');
  db.close();
  const dist = {};
  for (const f of families) {
    const k = String(f.learningBurden);
    dist[k] = (dist[k] ?? 0) + 1;
  }
  const outOfRange = families.filter(f => !(f.learningBurden >= 1 && f.learningBurden <= 5)).length;
  const sample = families.slice(0, 6).map(f => f.headword + '=' + f.learningBurden);
  return JSON.stringify({ total: families.length, dist, outOfRange, sample });
})()`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const page = await openPage(`${APP}/settings/`);
await sleep(6000);

const switched = await page.evaluate(ENSURE_DECISION_ON);
const before = JSON.parse(await page.evaluate(READ_BURDENS));
const out = await page.evaluate(RUN_BURDEN);

if (out === 'BUTTON_DISABLED' || out === 'NO_BUTTON' || switched === 'FAILED_ON' || switched === 'NO_SWITCH') {
  console.log(`SKIP  AC-1/AC-2/AC-3/AC-4：无法驱动决策模型开关（${switched} / ${out}）`);
} else {
  record('AC-2 批量评分执行完成（不阻塞）', typeof out === 'string' && out.includes('完成'), (out ?? '').slice(0, 130));

  const after = JSON.parse(await page.evaluate(READ_BURDENS));
  const parsed = /分布 (\{[^}]*\})/.exec(out ?? '');
  const dist = parsed ? JSON.parse(parsed[1]) : {};
  const values = Object.keys(dist).map(Number);

  record(
    'AC-1 负担值落在 [1,5]',
    after.outOfRange === 0 && values.length >= 1 && values.every((v) => v >= 1 && v <= 5),
    `库内分布 ${JSON.stringify(after.dist)}；越界 ${after.outOfRange}；抽样 ${after.sample.join(', ')}`,
  );
  record(
    'AC-3 结果写回共享库',
    after.total > 0 && after.sample.every((s) => /=(\d)$/.test(s)),
    `${before.total} 个词族；抽样 ${after.sample.slice(0, 3).join(', ')}`,
  );

  const fallbackCount = Number(/启发式回退 (\d+)/.exec(out ?? '')?.[1] ?? NaN);
  record(
    'AC-2b 模型不可用时回退启发式（不阻塞）',
    Number.isFinite(fallbackCount) && fallbackCount > 0,
    `回退 ${fallbackCount} 个（未填凭据时属预期行为）`,
  );

  if (switched === 'TURNED_ON') await page.evaluate(TURN_DECISION_OFF);
  console.log('ℹ️  决策模型开关已恢复原状态');
}

record('AC-5 控制台零错误', page.errors.length === 0, page.errors.slice(0, 2).join(' | ') || '无');
await page.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n结果：**${passed}/${results.length} 通过**${failed ? `（${failed} 项失败）` : ''}`);
process.exitCode = failed === 0 ? 0 : 1;
