/**
 * S-008 FSRS 排程引擎验收（真实运行时，非单测）
 *
 * 前置：
 *   1. npm run dev 已启动
 *   2. 已用 --remote-debugging-port=9222 启动 Edge/Chrome
 * 运行：node scripts/verify-fsrs.mjs
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

/** 在学习页真实作答一张卡（选择 / 输入 → 提交 → 判定 → 下一张） */
const ANSWER_ONE = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('[data-testid=choice-0]') || document.querySelector('[data-testid=answer-input]')) break;
    await wait(250);
  }
  const choice = document.querySelector('[data-testid=choice-0]');
  if (choice) {
    choice.click();
  } else {
    const input = document.querySelector('[data-testid=answer-input]');
    if (!input) return 'NO_CARD';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'zzz-not-correct');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(250);
    const submit = document.querySelector('[data-testid=submit-answer]');
    if (!submit) return 'NO_SUBMIT_BTN';
    submit.click();
  }
  for (let i = 0; i < 30; i++) {
    if (document.querySelector('[data-testid=answer-verdict]')) break;
    await wait(200);
  }
  const next = document.querySelector('[data-testid=next-card]');
  if (!next) return 'NO_NEXT_BTN';
  next.click();
  await wait(900);
  return 'ANSWERED';
})()`;

/** 读当前用户库里最近更新的复习状态，检查 FSRS 字段是否落库 */
const READ_STATES = `(async () => {
  const openDb = (name) => new Promise((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = (db, store) => new Promise(res => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
  });
  const uidRaw = localStorage.getItem('elm.activeUser');
  let uid = uidRaw; try { uid = JSON.parse(uidRaw); } catch {}
  const db = await openDb('elm-' + uid);
  const states = await all(db, 'reviewStates');
  const logs = await all(db, 'reviewLogs');
  db.close();
  const withFsrs = states.filter(s => typeof s.difficulty === 'number' && typeof s.fsrsState === 'number' && typeof s.elapsedDays === 'number');
  const latest = withFsrs.sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))[0];
  return JSON.stringify({
    states: states.length,
    withFsrsFields: withFsrs.length,
    logsWithFeatures: logs.filter(l => typeof l.elapsedDays === 'number').length,
    latest: latest ? { cardId: latest.cardId, S: latest.stability, D: latest.difficulty, state: latest.fsrsState, ivl: latest.intervalDays, reps: latest.reps, lapses: latest.lapses } : null,
  });
})()`;

const READ_HOME = `JSON.stringify({
  hasRetentionPanel: (document.body.innerText || '').includes('实际保持率'),
  retentionLine: ((document.body.innerText || '').match(/实际保持率[\\s\\S]{0,40}/) ?? [''])[0].replace(/\\n+/g, ' '),
})`;

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. 准备一张卡并真实作答
const learn = await openPage(`${APP}/learn/`);
await sleep(6000);
const answered = await learn.evaluate(ANSWER_ONE);
record('前置：真实作答一张卡', answered === 'ANSWERED', answered);
record('AC-12 学习页控制台零错误', learn.errors.length === 0, learn.errors.slice(0, 2).join(' | ') || '无');
await learn.close();
await sleep(800);

// 2. 落库状态必须带 FSRS 字段（S / D / state / elapsedDays）
const home = await openPage(`${APP}/`);
await sleep(6000);
const states = JSON.parse(await home.evaluate(READ_STATES));
record(
  'AC-1 复习状态落库 FSRS 字段',
  states.withFsrsFields > 0,
  `${states.withFsrsFields}/${states.states} 条带 S/D/state/elapsedDays` +
    (states.latest ? `；最新 ${states.latest.cardId} S=${states.latest.S.toFixed(3)} D=${states.latest.D.toFixed(2)} state=${states.latest.state} ivl=${states.latest.ivl}d` : ''),
);
record(
  'AC-2 复习日志记录 elapsedDays',
  states.logsWithFeatures > 0,
  `${states.logsWithFeatures} 条带 elapsedDays（FSRS 参数优化所需特征）`,
);

// 3. 首页「实际保持率」面板
const dom = JSON.parse(await home.evaluate(READ_HOME));
record('AC-3 首页展示实际保持率', dom.hasRetentionPanel === true, dom.retentionLine);
record('AC-12 首页控制台零错误', home.errors.length === 0, home.errors.slice(0, 2).join(' | ') || '无');
await home.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n结果：**${passed}/${results.length} 通过**`);
process.exitCode = passed === results.length ? 0 : 1;
