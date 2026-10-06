/**
 * 开发期自检脚本（不属于应用代码）：
 * 通过 CDP 打开页面，收集控制台错误与异常，并输出渲染后的文本。
 *
 * 用法：
 *   node --experimental-websocket scripts/check-page.mjs http://localhost:3000/
 * 前置：已用 --remote-debugging-port=9222 启动 Edge/Chrome
 */
const target = process.argv[2] ?? 'http://localhost:3000/';
const cdpBase = process.env.CDP_BASE ?? 'http://127.0.0.1:9222';
const waitMs = Number(process.env.WAIT_MS ?? 8000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget() {
  const res = await fetch(`${cdpBase}/json/new?${encodeURIComponent(target)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`无法创建标签页: ${res.status} ${await res.text()}`);
  return res.json();
}

const page = await openTarget();
const ws = new WebSocket(page.webSocketDebuggerUrl);

const events = [];
let nextId = 1;
const pending = new Map();

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    events.push(`EXCEPTION: ${d.exception?.description ?? d.text}`);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    events.push(
      `${msg.params.type.toUpperCase()}: ${msg.params.args
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')}`,
    );
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    events.push(`LOG: ${msg.params.entry.text}`);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

await sleep(waitMs);

const evalRes = await send('Runtime.evaluate', {
  expression:
    process.env.EVAL ??
    'document.body.innerText.replace(/\\n{2,}/g, "\\n").slice(0, 1200)',
  returnByValue: true,
  awaitPromise: true,
});

console.log('=== 控制台错误 ===');
console.log(events.length ? events.join('\n') : '（无）');
console.log('=== 页面文本 / 表达式结果 ===');
console.log(evalRes.result?.result?.value ?? '(空)');

await fetch(`${cdpBase}/json/close/${page.id}`).catch(() => undefined);
ws.close();
await sleep(100);
