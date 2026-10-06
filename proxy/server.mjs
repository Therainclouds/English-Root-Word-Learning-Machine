/**
 * 本地转发代理（零依赖）。
 * 用途：浏览器直连第三方大模型端点会被 CORS 拦截，本代理在本机完成转发，
 * 密钥只存在本机的 proxy/.env 里，不暴露给浏览器。
 *
 * 用法：
 *   1. 复制 proxy/.env.example 为 proxy/.env 并填写
 *   2. npm run proxy
 *   3. 应用设置页把 Base URL 填 http://localhost:8787
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnv(path.join(here, '.env'));

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM = process.env.UPSTREAM_BASE_URL;
const PREFIX = process.env.UPSTREAM_PATH_PREFIX || '';
const API_KEY = process.env.UPSTREAM_API_KEY || '';
const AUTH = (process.env.UPSTREAM_AUTH_HEADER || 'bearer').toLowerCase();

if (!UPSTREAM) {
  console.error('缺少 UPSTREAM_BASE_URL。请复制 proxy/.env.example 为 proxy/.env 并填写。');
  process.exit(1);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const target = new URL(`${PREFIX}${req.url}`, UPSTREAM);
  const headers = { 'content-type': req.headers['content-type'] || 'application/json' };

  if (API_KEY) {
    if (AUTH === 'bearer') headers.authorization = `Bearer ${API_KEY}`;
    else headers['x-api-key'] = API_KEY;
  }
  if (req.headers['anthropic-version']) headers['anthropic-version'] = req.headers['anthropic-version'];

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body.length ? body : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      ...CORS,
      'content-type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(text);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} → ${upstream.status}`);
  } catch (err) {
    res.writeHead(502, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
    console.error('转发失败：', err);
  }
});

server.listen(PORT, () => {
  console.log(`本地代理已启动: http://localhost:${PORT}  →  ${UPSTREAM}${PREFIX}`);
  console.log(`鉴权方式: ${AUTH}`);
});
