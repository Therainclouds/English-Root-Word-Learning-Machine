/**
 * S-003 验收测试（真实运行时）
 * 前置：npm run dev 已启动；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-s003.mjs
 */
import { openPage, waitFor } from './cdp-client.mjs';

const APP = process.env.APP_BASE ?? 'http://localhost:3000';
const MASTER_N = Number(process.env.MASTER_N ?? 400);

const results = [];
const record = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** 页面上的文案是「生词率 12.3%」，必须用正则取值，不能直接 parseFloat */
const parseRate = (text) => {
  const m = /([\d.]+)\s*%/.exec(String(text ?? ''));
  return m ? Number(m[1]) : NaN;
};

/** 测试夹具：把前 N 个高频词族的识别卡标记为已掌握，模拟"学过 K1"的用户 */
const masterTopFamilies = (n) => `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const shared = await openDb('elm-shared');
  const families = await new Promise(res => { const r = shared.transaction('wordFamilies').objectStore('wordFamilies').getAll(); r.onsuccess = () => res(r.result); });
  const cards = await new Promise(res => { const r = shared.transaction('cards').objectStore('cards').getAll(); r.onsuccess = () => res(r.result); });
  shared.close();
  const top = families.sort((a, b) => a.freqRank - b.freqRank).slice(0, ${n}).map(f => f.id);
  const topSet = new Set(top);
  const targets = cards.filter(c => c.direction === 'receptive' && topSet.has(c.familyId));
  const udb = await openDb('elm-' + uid);
  for (const card of targets) {
    await new Promise(res => {
      const t = udb.transaction('reviewStates', 'readwrite');
      t.objectStore('reviewStates').put({
        cardId: card.id, dueAt: Date.now() - 86400000, intervalDays: 60, ease: 2.6,
        lapses: 0, reps: 6, direction: 'receptive', stability: 0.95,
        interleaveGroup: card.interleaveGroup,
      });
      t.oncomplete = () => res();
    });
  }
  udb.close();
  return JSON.stringify({ masteredFamilies: top.length, cards: targets.length });
})()`;

const clearUserStates = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  await new Promise(res => { const t = db.transaction('reviewStates', 'readwrite'); t.objectStore('reviewStates').clear(); t.oncomplete = () => res(); });
  db.close();
  return true;
})()`;

/** 读页面上的统计与高亮情况 */
const readStats = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 100; i++) {
    if (document.querySelector('[data-testid=passage-text]')) break;
    await wait(200);
  }
  const el = document.querySelector('[data-testid=unknown-rate]');
  const text = document.querySelector('[data-testid=passage-text]');
  if (!el || !text) return JSON.stringify({ missing: true });
  const body = document.body.innerText;
  const highlighted = Array.from(document.querySelectorAll('[data-testid=unknown-token]')).map(b => b.textContent);
  const plain = text.innerText;
  const words = (plain.match(/[A-Za-z][A-Za-z'’-]*/g) || []);
  return JSON.stringify({
    rateText: el.textContent.trim(),
    highlightedCount: document.querySelectorAll('[data-testid=unknown-token]').length,
    highlightedSample: highlighted.slice(0, 12),
    totalWords: words.length,
    verdictTooHard: body.includes('生词率过高'),
    verdictTooEasy: body.includes('偏简单'),
    verdictIdeal: body.includes('难度合适'),
    title: document.querySelector('h1')?.textContent ?? '',
  });
})()`;

const countUserStates = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  const states = await new Promise(res => { const r = db.transaction('reviewStates').objectStore('reviewStates').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  return String(states.length);
})()`;

const clickFirstUnknownAndAdd = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const token = document.querySelector('[data-testid=unknown-token]');
  if (!token) return 'NO_TOKEN';
  token.click();
  await wait(700);
  const btn = document.querySelector('[data-testid=add-to-learning]');
  if (!btn) return 'NO_BUTTON';
  btn.click();
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const msg = document.querySelector('[data-testid=reading-message]');
    if (msg && msg.textContent) return msg.textContent;
  }
  return 'TIMEOUT';
})()`;

const page = await openPage(`${APP}/reading/`);
const loaded = await waitFor(page, '[data-testid=passage-text]', 40000);
record('前置：阅读页加载完成', loaded > 0, `等待 ${loaded}ms`);

// ---- AC-1：生词率过高时给出明确提示（先清空掌握度） ----
await page.evaluate(clearUserStates);
await page.reload();
await waitFor(page, '[data-testid=passage-text]', 30000);

const worst = JSON.parse(await page.evaluate(readStats));
record('AC-1 零基础时判定生词率过高', worst.verdictTooHard === true, `生词率 ${worst.rateText}`);
record('AC-3 未知词被着色', worst.highlightedCount > 0, `高亮 ${worst.highlightedCount} 个`);

// ---- 夹具：掌握前 N 个高频词族 ----
const fixture = JSON.parse(await page.evaluate(masterTopFamilies(MASTER_N)));
record('夹具：标记已掌握词族', fixture.masteredFamilies > 0, `${fixture.masteredFamilies} 词族 / ${fixture.cards} 卡`);
await page.reload();
await waitFor(page, '[data-testid=passage-text]', 30000);

const better = JSON.parse(await page.evaluate(readStats));
const worstRate = parseRate(worst.rateText);
const betterRate = parseRate(better.rateText);
record('AC-3 掌握后生词率下降', betterRate < worstRate, `${worstRate}% → ${betterRate}%`);

// ---- AC-2：显示值与高亮数量一致（两条独立计算路径） ----
const computed = (better.highlightedCount / better.totalWords) * 100;
record(
  'AC-2 显示生词率与高亮数量一致（±0.5%）',
  Math.abs(computed - betterRate) <= 0.5,
  `显示 ${betterRate}% vs 由高亮计数推算 ${computed.toFixed(1)}%（总词 ${better.totalWords}）`,
);

// ---- AC-3：已掌握的词不着色（'the' 确实出现在该篇正文中） ----
const highlightedLower = better.highlightedSample.map((t) => String(t).toLowerCase());
record(
  'AC-3 已掌握的词不再高亮',
  !highlightedLower.includes('the') && better.highlightedCount > 0,
  `高亮样本：${better.highlightedSample.join(', ')}`,
);

// ---- AC-4：加入今日学习，只影响当前用户 ----
const before = Number(await page.evaluate(countUserStates));
const addResult = await page.evaluate(clickFirstUnknownAndAdd);
record('AC-4 加入今日学习成功', typeof addResult === 'string' && addResult.includes('已加入'), String(addResult).slice(0, 60));

const after = Number(await page.evaluate(countUserStates));
record('AC-4 当前用户新增 1 条复习状态', after === before + 1, `${before} → ${after}`);

// 新建第二个用户，确认互不影响
const originalUser = await page.evaluate(`localStorage.getItem('elm.activeUser')`);
const secondUser = await page.evaluate(`(() => {
  const users = JSON.parse(localStorage.getItem('elm.users') || '[]');
  const id = 'u_test_' + Date.now();
  users.push({ id, name: '隔离测试用户', createdAt: Date.now() });
  localStorage.setItem('elm.users', JSON.stringify(users));
  localStorage.setItem('elm.activeUser', JSON.stringify(id));
  return id;
})()`);
await page.reload();
await waitFor(page, '[data-testid=passage-text]', 30000);
const otherCount = Number(await page.evaluate(countUserStates));
record('AC-4 其他用户不受影响', otherCount === 0, `新用户复习状态 ${otherCount} 条`);

const otherStats = JSON.parse(await page.evaluate(readStats));
record('AC-4 新用户回到零基础状态', otherStats.verdictTooHard === true, `生词率 ${otherStats.rateText}`);

// 还原环境：切回原用户并移除测试用户
await page.evaluate(`(() => {
  const users = JSON.parse(localStorage.getItem('elm.users') || '[]').filter(u => u.id !== ${JSON.stringify(secondUser)});
  localStorage.setItem('elm.users', JSON.stringify(users));
  localStorage.setItem('elm.activeUser', ${JSON.stringify(originalUser)});
  return true;
})()`);

const realErrors = page.consoleErrors.filter((e) => !e.includes('Failed to load resource'));
record('控制台无意外错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

await page.close();

const passed = results.filter(Boolean).length;
console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
process.exitCode = passed === results.length ? 0 : 1;
