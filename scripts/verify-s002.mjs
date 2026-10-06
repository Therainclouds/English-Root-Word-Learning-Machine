/**
 * S-002 验收测试（真实运行时 + 本地 mock 端点）
 * 前置：npm run dev 已启动；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-s002.mjs
 */
import { spawn } from 'node:child_process';
import { openPage, sleep, waitForSelector } from './cdp-client.mjs';

const MOCK = process.env.MOCK_BASE ?? 'http://127.0.0.1:8899';
const APP = process.env.APP_BASE ?? 'http://localhost:3000';

const mock = spawn(process.execPath, ['scripts/mock-llm.mjs'], { stdio: 'ignore' });
await sleep(1500);

const resetStats = () => fetch(`${MOCK}/__reset`).then((r) => r.json());
const getStats = () => fetch(`${MOCK}/__stats`).then((r) => r.json());

const results = [];
const record = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const setLlm = (baseUrl, enabled) => `(() => {
  const key = 'elm.globalSettings';
  const cur = JSON.parse(localStorage.getItem(key) || '{}');
  cur.llm = { provider: 'openai-compatible', baseUrl: ${JSON.stringify(baseUrl)}, apiKey: 'test-key', model: 'mock-model', temperature: 0.4, enabled: ${enabled}, authHeader: 'bearer' };
  if (!cur.decision) cur.decision = { enabled: false, workspaceId: '', region: 'cn-beijing', apiKey: '', naturalThreshold: 0.6, baseUrlOverride: '' };
  localStorage.setItem(key, JSON.stringify(cur));
  return true;
})()`;

/** 找一个仍为 pending 的词（返回 lemma 与 wordId） */
const findPending = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const db = await openDb('elm-shared');
  const words = await new Promise(res => {
    const r = db.transaction('words').objectStore('words').getAll();
    r.onsuccess = () => res(r.result);
  });
  db.close();
  const pending = words.filter(w => w.definitionStatus === 'pending');
  if (!pending.length) return JSON.stringify({ none: true, total: words.length });
  pending.sort((a, b) => a.lemma.localeCompare(b.lemma));
  const w = pending[0];
  return JSON.stringify({ wordId: w.id, lemma: w.lemma, pendingCount: pending.length, total: words.length });
})()`;

const readWord = (wordId) => `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const db = await openDb('elm-shared');
  const word = await new Promise(res => {
    const r = db.transaction('words').objectStore('words').get(${JSON.stringify(wordId)});
    r.onsuccess = () => res(r.result);
  });
  const rec = await new Promise(res => {
    const r = db.transaction('cards').objectStore('cards').get(${JSON.stringify(wordId)} + ':rec');
    r.onsuccess = () => res(r.result);
  });
  db.close();
  return JSON.stringify({ status: word?.definitionStatus, definitionEn: word?.definitionEn ?? '', cardBack: rec?.back ?? '' });
})()`;

/** 注意：搜索是子串匹配（ability 会命中 disability），必须按词首精确挑选 */
const selectWord = (lemma) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const input = document.querySelector('[data-testid=library-search]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, ${JSON.stringify(lemma)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(500);
  // 必须按词条名精确匹配：搜索是子串匹配，'a' 会命中 'about' 且 'about' 可能排在前面
  const items = Array.from(document.querySelectorAll('[data-testid=library-item]'));
  const item = items.find(el => (el.querySelector('.font-medium')?.textContent ?? '').trim() === ${JSON.stringify(lemma)});
  if (!item) return 'NO_ITEM';
  item.click();
  await wait(600);
  const hasBtn = !!document.querySelector('[data-testid=gen-def-btn]');
  return (hasBtn ? 'HAS_BTN' : 'NO_BTN') + '|' + item.textContent.trim();
})()`;

const clickGenerate = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('[data-testid=gen-def-btn]');
  if (!btn) return 'NO_BTN';
  btn.click();
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const msg = document.querySelector('[data-testid=gen-def-msg]');
    if (msg && msg.textContent) return msg.textContent;
  }
  return 'TIMEOUT';
})()`;

const clearLogs = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  await new Promise(res => { const t = db.transaction('llmLogs', 'readwrite'); t.objectStore('llmLogs').clear(); t.oncomplete = () => res(); });
  db.close();
  return true;
})()`;

const readLogs = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  const logs = await new Promise(res => { const r = db.transaction('llmLogs').objectStore('llmLogs').getAll(); r.onsuccess = () => res(r.result); });
  db.close();
  return JSON.stringify(logs);
})()`;

// ---- 准备 ----
const page = await openPage(`${APP}/library/`);
await page.evaluate(waitForSelector('[data-testid=library-search]'));
await page.evaluate(clearLogs);
await page.evaluate(setLlm(`${MOCK}/word`, true));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=library-search]'));
await resetStats();

const target = JSON.parse(await page.evaluate(findPending));
record('前置：存在待生成释义的词', !target.none, `pending=${target.pendingCount ?? 0} / total=${target.total ?? 0}`);
if (target.none) {
  console.log('无可测样本，终止');
  await page.close();
  mock.kill();
  process.exit(1);
}

// ---- AC-1/2：生成并写回共享库 ----
const selected = await page.evaluate(selectWord(target.lemma));
record(
  'AC-1 pending 词显示生成入口',
  String(selected).startsWith('HAS_BTN'),
  `目标「${target.lemma}」→ 选中 ${String(selected)}`,
);

const message = await page.evaluate(clickGenerate);
record('AC-1 生成成功提示', typeof message === 'string' && message.includes('已生成'), String(message).slice(0, 60));

const after = JSON.parse(await page.evaluate(readWord(target.wordId)));
record('AC-1 共享库状态变为 ready', after.status === 'ready', `status=${after.status}`);
record('AC-1 释义已写入', after.definitionEn.length > 0, after.definitionEn.slice(0, 60));
record('AC-1 卡片背面同步更新', after.cardBack === after.definitionEn, after.cardBack.slice(0, 60));

let stats = await getStats();
record('AC-1 只请求 1 次', stats.word === 1, `mock 收到 word 模式请求 ${stats.word} 次`);

// ---- AC-2：刷新后仍在（缓存生效于共享库） ----
await page.reload();
await page.evaluate(waitForSelector('[data-testid=library-search]'));
const persisted = JSON.parse(await page.evaluate(readWord(target.wordId)));
record('AC-2 刷新后释义仍在', persisted.status === 'ready' && persisted.definitionEn === after.definitionEn);

const stillPending = JSON.parse(await page.evaluate(findPending));
record(
  'AC-2 pending 数量减少 1',
  (stillPending.pendingCount ?? 0) === (target.pendingCount ?? 0) - 1,
  `${target.pendingCount} → ${stillPending.pendingCount}`,
);

// ---- 幂等：已 ready 的词不再出现生成入口 ----
const secondSelect = await page.evaluate(selectWord(target.lemma));
record('已 ready 的词不再提示生成', String(secondSelect).startsWith('NO_BTN'), String(secondSelect));

// ---- AC-4：大模型未启用时的降级 ----
await page.evaluate(setLlm(`${MOCK}/word`, false));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=library-search]'));
const disabled = JSON.parse(await page.evaluate(findPending));
const disabledSelect = disabled.none ? 'SKIP' : await page.evaluate(selectWord(disabled.lemma));
record(
  'AC-4 未启用大模型时给出提示且无按钮',
  disabledSelect === 'SKIP' || String(disabledSelect).startsWith('NO_BTN'),
  `${disabled.lemma ?? '-'} → ${disabledSelect}`,
);

const logs = JSON.parse(await page.evaluate(readLogs));
record('AC-用量记录已写入', logs.length >= 1, `${logs.length} 条`);

const realErrors = page.consoleErrors.filter((e) => !e.includes('Failed to load resource'));
record('控制台无意外错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

await page.close();
mock.kill();

const passed = results.filter(Boolean).length;
console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
process.exitCode = passed === results.length ? 0 : 1;
