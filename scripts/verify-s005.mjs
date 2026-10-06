/**
 * S-005 验收测试（真实运行时 + 本地 mock 端点）
 * 前置：npm run dev 已启动；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-s005.mjs
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

const setLlm = (baseUrl) => `(() => {
  const key = 'elm.globalSettings';
  const cur = JSON.parse(localStorage.getItem(key) || '{}');
  cur.llm = { provider: 'openai-compatible', baseUrl: ${JSON.stringify(baseUrl)}, apiKey: 'test-key', model: 'mock-model', temperature: 0.4, enabled: true, authHeader: 'bearer' };
  if (!cur.decision) cur.decision = { enabled: false, workspaceId: '', region: 'cn-beijing', apiKey: '', naturalThreshold: 0.6, baseUrlOverride: '' };
  localStorage.setItem(key, JSON.stringify(cur));
  return true;
})()`;

const clickTest = (prev) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('[data-testid=test-llm]').click();
  const prev = ${JSON.stringify(prev ?? null)};
  for (let i = 0; i < 240; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=test-llm-result]');
    const text = pre ? pre.textContent : '';
    if (text && text !== prev && !text.includes('请求中')) return text;
  }
  return 'TIMEOUT';
})()`;

const readLogs = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  const logs = await new Promise(res => {
    const r = db.transaction('llmLogs').objectStore('llmLogs').getAll();
    r.onsuccess = () => res(r.result);
  });
  db.close();
  return JSON.stringify(logs);
})()`;

/** 清空历史调用记录，保证断言基于本次运行的数据 */
const clearLogs = `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const uid = (function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })();
  const db = await openDb('elm-' + uid);
  await new Promise(res => {
    const t = db.transaction('llmLogs', 'readwrite');
    t.objectStore('llmLogs').clear();
    t.oncomplete = () => res();
  });
  db.close();
  return true;
})()`;

const page = await openPage(`${APP}/settings/`);
await page.evaluate(waitForSelector('[data-testid=test-llm]'));
await page.evaluate(clearLogs);

// ---- 1) 成功 + 缓存 ----
await page.evaluate(setLlm(`${MOCK}/ok`));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=test-llm]'));
await resetStats();

const okFirst = await page.evaluate(clickTest(null));
record('AC-成功调用返回内容', typeof okFirst === 'string' && okFirst.includes('OK'), String(okFirst).slice(0, 60));

// 第二次点击的结果文本与第一次完全相同，因此不能用"文本变化"判定完成 → 固定等待
const okSecond = await page.evaluate(`(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('[data-testid=test-llm]').click();
  await wait(2500);
  const pre = document.querySelector('[data-testid=test-llm-result]');
  return pre ? pre.textContent : '';
})()`);
record('AC-重复调用仍成功（内容一致）', typeof okSecond === 'string' && okSecond.includes('OK'), String(okSecond).slice(0, 60));

let stats = await getStats();
record('AC-4 相同输入只发 1 次真实请求', stats.ok === 1, `mock 收到 ok 模式请求 ${stats.ok} 次`);

// ---- 2) 5xx 重试 ----
await page.evaluate(setLlm(`${MOCK}/fail`));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=test-llm]'));
await resetStats();

const failText = await page.evaluate(clickTest(null));
record('AC-2 5xx 失败提示可读', typeof failText === 'string' && failText.includes('HTTP 500'), String(failText).slice(0, 80));

stats = await getStats();
record('AC-2 5xx 重试到 3 次后放弃', stats.fail === 3, `mock 收到 fail 模式请求 ${stats.fail} 次`);

// ---- 3) 401 不重试 ----
await page.evaluate(setLlm(`${MOCK}/auth`));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=test-llm]'));
await resetStats();

const authText = await page.evaluate(clickTest(null));
record('AC-3 401 提示可读', typeof authText === 'string' && authText.includes('HTTP 401'), String(authText).slice(0, 80));

stats = await getStats();
record('AC-3 4xx 不重试（只请求 1 次）', stats.auth === 1, `mock 收到 auth 模式请求 ${stats.auth} 次`);

// ---- 4) 空内容不重试 ----
await page.evaluate(setLlm(`${MOCK}/empty`));
await page.reload();
await page.evaluate(waitForSelector('[data-testid=test-llm]'));
await resetStats();

const emptyText = await page.evaluate(clickTest(null));
record('AC-空内容报错带原始响应', typeof emptyText === 'string' && emptyText.includes('空内容'), String(emptyText).slice(0, 80));

stats = await getStats();
record('AC-空内容不重试', stats.empty === 1, `mock 收到 empty 模式请求 ${stats.empty} 次`);

// ---- 5) 用量记录 ----
const logs = JSON.parse(await page.evaluate(readLogs));
record('AC-5 调用记录已落库', logs.length === 5, `共 ${logs.length} 条`);
record('AC-5 成功记录 attempts=1', logs[0]?.ok === true && logs[0]?.attempts === 1, JSON.stringify(logs[0] ?? {}).slice(0, 120));
record('AC-5 缓存命中已标记', logs[1]?.cached === true, JSON.stringify(logs[1] ?? {}).slice(0, 120));
record('AC-5 5xx 记录 attempts=3', logs[2]?.ok === false && logs[2]?.attempts === 3, JSON.stringify(logs[2] ?? {}).slice(0, 120));
record('AC-5 401 记录 attempts=1', logs[3]?.ok === false && logs[3]?.attempts === 1, JSON.stringify(logs[3] ?? {}).slice(0, 120));
record('AC-5 失败原因已保存', typeof logs[2]?.error === 'string' && logs[2].error.length > 0, String(logs[2]?.error ?? '').slice(0, 60));

// 本测试故意触发 500/401，浏览器会把它们记为网络错误 → 排除“Failed to load resource”
const realErrors = page.consoleErrors.filter((e) => !e.includes('Failed to load resource'));
record('控制台无意外错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

await page.close();
mock.kill();

const passed = results.filter(Boolean).length;
console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
process.exitCode = passed === results.length ? 0 : 1;
