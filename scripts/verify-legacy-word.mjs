/**
 * 回归测试：没有 definitionStatus 的旧数据，导入词表后不得丢失已有释义。
 * 前置：npm run dev 已启动；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-legacy-word.mjs
 */
import { openPage, waitFor } from './cdp-client.mjs';

const APP = process.env.APP_BASE ?? 'http://localhost:3000';
const LEMMA = process.env.LEMMA ?? 'about';

const results = [];
const record = (name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * 把该词的 definitionStatus 删掉，并把释义改成哨兵值，模拟 v3 之前的旧数据。
 * 同时返回该词族的当前 freqRank —— 导入时必须沿用它，
 * 否则用 "rank=1" 会把已有词族的排名覆盖掉，进而打乱词频排序与路径挂载。
 */
const makeLegacy = (lemma) => `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const db = await openDb('elm-shared');
  const id = 'w.' + ${JSON.stringify(lemma)};
  const word = await new Promise(res => { const r = db.transaction('words').objectStore('words').get(id); r.onsuccess = () => res(r.result); });
  if (!word) { db.close(); return JSON.stringify({ error: 'NO_WORD' }); }
  const family = await new Promise(res => { const r = db.transaction('wordFamilies').objectStore('wordFamilies').get(word.familyId); r.onsuccess = () => res(r.result); });
  const legacy = { ...word, definitionEn: 'LEGACY-SENTINEL-DEFINITION', definitionL1: '旧数据' };
  delete legacy.definitionStatus;
  await new Promise(res => {
    const t = db.transaction('words', 'readwrite');
    t.objectStore('words').put(legacy);
    t.oncomplete = () => res();
  });
  db.close();
  return JSON.stringify({ ok: 'LEGACY_READY', rank: family?.freqRank ?? 1 });
})()`;

const readWord = (lemma) => `(async () => {
  const openDb = (name) => new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); });
  const db = await openDb('elm-shared');
  const word = await new Promise(res => { const r = db.transaction('words').objectStore('words').get('w.' + ${JSON.stringify(lemma)}); r.onsuccess = () => res(r.result); });
  const family = word ? await new Promise(res => { const r = db.transaction('wordFamilies').objectStore('wordFamilies').get(word.familyId); r.onsuccess = () => res(r.result); }) : null;
  db.close();
  return JSON.stringify({ status: word?.definitionStatus, definitionEn: word?.definitionEn ?? '', rank: family?.freqRank });
})()`;

const runImport = (lemma, rank) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const ta = document.querySelector('[data-testid=wordlist-input]');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(`${lemma}\t${rank}`)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(400);
  document.querySelector('[data-testid=import-btn]').click();
  for (let i = 0; i < 120; i++) {
    await wait(250);
    const pre = document.querySelector('[data-testid=import-result]');
    if (pre && !pre.textContent.includes('导入中')) return pre.textContent;
  }
  return 'TIMEOUT';
})()`;

const page = await openPage(`${APP}/settings/`);
const waited = await waitFor(page, '[data-testid=wordlist-input]', 60000);
record('前置：设置页加载完成', waited > 0, `等待 ${waited}ms`);

const legacy = JSON.parse(await page.evaluate(makeLegacy(LEMMA)));
record('前置：制造无 definitionStatus 的旧数据', legacy.ok === 'LEGACY_READY', JSON.stringify(legacy));

const output = await page.evaluate(runImport(LEMMA, legacy.rank));
record('导入执行完成', String(output).includes('完成'), String(output).slice(0, 120));

const after = JSON.parse(await page.evaluate(readWord(LEMMA)));
record('旧数据释义未被清空', after.definitionEn === 'LEGACY-SENTINEL-DEFINITION', after.definitionEn.slice(0, 60));
record('旧数据状态归一化为 ready', after.status === 'ready', `status=${after.status}`);
record('词频排名未被测试本身打乱', after.rank === legacy.rank, `freqRank ${legacy.rank} → ${after.rank}`);

const realErrors = page.consoleErrors.filter((e) => !e.includes('Failed to load resource'));
record('控制台无意外错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

await page.close();

const passed = results.filter(Boolean).length;
console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
process.exitCode = passed === results.length ? 0 : 1;
