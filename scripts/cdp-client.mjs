/**
 * 极简 CDP 客户端（开发期测试用，不属于应用代码）
 * 前置：Edge/Chrome 以 --remote-debugging-port=9222 启动
 */
const CDP = process.env.CDP_BASE ?? 'http://127.0.0.1:9222';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 页面内表达式：取当前用户 id。
 * 容错：localStorage 里可能是 JSON 字符串，也可能被误写成裸字符串。
 */
export const ACTIVE_USER_JS =
  `(function(){ const raw = localStorage.getItem('elm.activeUser'); if(!raw) return null; try { return JSON.parse(raw); } catch { return raw; } })()`;

export async function openPage(url) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`无法打开页面：${res.status} ${await res.text()}`);
  const page = await res.json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(
        msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text,
      );
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const text = msg.params.entry.text;
      if (!text.includes('favicon')) consoleErrors.push(text);
    }
  });

  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return r.result?.result?.value;
  };

  const reload = async () => {
    await send('Page.reload');
    await sleep(2500);
  };

  return {
    evaluate,
    reload,
    consoleErrors,
    close: () => send('Page.close').catch(() => undefined),
  };
}

/**
 * 从 Node 侧轮询等待选择器出现，返回等待毫秒数（0 = 超时）。
 * 比在页面内 await 更可靠：不依赖 CDP 对 promise 的返回值处理。
 */
export async function waitFor(page, selector, timeoutMs = 30000) {
  const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await page.evaluate(expr)) === true) return Date.now() - startedAt;
    await sleep(400);
  }
  return 0;
}

/** 在页面内等待选择器（返回表达式字符串，由调用方 evaluate） */
export const waitForSelector = (selector, timeoutMs = 15000) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + ${timeoutMs};
  while (Date.now() < deadline) {
    if (document.querySelector('${selector}')) return true;
    await wait(200);
  }
  return false;
})()`;
