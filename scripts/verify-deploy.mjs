/**
 * 部署前自检：把构建产物当作真实静态站托管起来，用浏览器走一遍。
 *
 * 为什么需要：静态导出最容易在"本地 dev 正常、部署后 404"上翻车
 * （资源路径、子路由、trailingSlash、缺 .nojekyll 等）。
 *
 * 前置：已跑 `npm run build`（产物在 out/）；Edge/Chrome 以 --remote-debugging-port=9222 启动
 * 运行：node scripts/verify-deploy.mjs
 */
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'out');
const PORT = Number(process.env.DEPLOY_PORT ?? 4173);
const CDP = process.env.CDP_BASE ?? 'http://127.0.0.1:9222';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ---------- 1. 产物完整性（不依赖浏览器） ---------- */

if (!existsSync(DIST)) {
  console.error(`未找到产物目录 ${DIST}，请先执行 npm run build`);
  process.exit(1);
}

const routes = ['index.html', 'learn/index.html', 'library/index.html', 'reading/index.html', 'settings/index.html'];
const missingRoutes = routes.filter((r) => !existsSync(join(DIST, r)));
record('AC-1 页面路由齐全', missingRoutes.length === 0, missingRoutes.length ? `缺失：${missingRoutes.join(', ')}` : `${routes.length} 个路由`);

const hasAssets = existsSync(join(DIST, '_next', 'static'));
record('AC-2 静态资源目录存在', hasAssets, hasAssets ? '_next/static 已生成' : '缺少 _next/static');

const dictPath = join(DIST, 'wordlists', 'definitions-zh.json');
let dictInfo = '缺失';
if (existsSync(dictPath)) {
  const dict = JSON.parse(readFileSync(dictPath, 'utf8'));
  dictInfo = `${Object.keys(dict.entries).length} 词条 / ${(statSync(dictPath).size / 1024 / 1024).toFixed(2)} MB`;
}
record('AC-3 内置词典随产物发布', existsSync(dictPath), dictInfo);

/* ---------- 2. 用真实浏览器访问（含子路由与资源 404） ---------- */

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  else if (!extname(p)) p += '/index.html';
  try {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(join(DIST, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
});
await new Promise((r) => server.listen(PORT, r));
const ORIGIN = `http://localhost:${PORT}`;

async function openPage(url) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`无法打开页面：${res.status}（CDP 是否已启动？）`);
  const page = await res.json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  const badResponses = [];
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
      // 日志条目的 text 不含 URL，必须配合 entry.url 判断，否则 favicon 会被误报
      const u = msg.params.entry.url ?? '';
      if (!t.includes('favicon') && !u.includes('favicon')) errors.push(`${t}${u ? ` @ ${u}` : ''}`);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      const u = msg.params.response.url;
      if (!u.includes('favicon')) badResponses.push(`${msg.params.response.status} ${u}`);
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
  await send('Network.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  return { evaluate, errors, badResponses, close: () => send('Page.close').catch(() => undefined) };
}

try {
  const home = await openPage(`${ORIGIN}/`);
  await new Promise((r) => setTimeout(r, 7000));
  const dom = JSON.parse(
    await home.evaluate(`JSON.stringify({
      title: document.title,
      mounted: !!document.querySelector('a[href*="learn"]'),
      text: (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 120),
    })`),
  );
  record('AC-4 首页可挂载', dom.mounted === true && !!dom.title, `${dom.title} · ${dom.text.slice(0, 60)}`);
  record('AC-5 首页无资源 404', home.badResponses.length === 0, home.badResponses.slice(0, 3).join(' | ') || '无');
  record('AC-6 首页控制台零错误', home.errors.length === 0, home.errors.slice(0, 2).join(' | ') || '无');
  await home.close();

  const settings = await openPage(`${ORIGIN}/settings/`);
  await new Promise((r) => setTimeout(r, 6000));
  const sdom = JSON.parse(
    await settings.evaluate(`JSON.stringify({
      hasDictBtn: !!document.querySelector('[data-testid=import-dict-btn]'),
      hasMorphBtn: !!document.querySelector('[data-testid=import-morph-btn]'),
    })`),
  );
  record('AC-7 子路由可直达（子路径托管）', sdom.hasDictBtn && sdom.hasMorphBtn, `内置释义按钮 ${sdom.hasDictBtn} · 词根库按钮 ${sdom.hasMorphBtn}`);
  record('AC-8 子路由无资源 404', settings.badResponses.length === 0, settings.badResponses.slice(0, 3).join(' | ') || '无');
  await settings.close();
} finally {
  server.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n结果：**${passed}/${results.length} 通过**`);
process.exitCode = passed === results.length ? 0 : 1;
