/**
 * 本地 mock 大模型端点（开发期测试用）。
 * 按路径前缀区分行为，用于验证 S-005 的重试 / 缓存 / 不重试：
 *   /ok/*      → 200 + 合法 OpenAI 响应
 *   /fail/*    → 500（可重试）
 *   /auth/*    → 401（不可重试）
 *   /empty/*   → 200 但内容为空（不可重试）
 *   GET /__stats → 各模式累计请求数
 *   GET /__reset → 清零统计
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 8899);
const stats = { ok: 0, fail: 0, auth: 0, empty: 0, word: 0 };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.url === '/__stats') return sendJson(res, 200, stats);
  if (req.url === '/__reset') {
    stats.ok = 0;
    stats.fail = 0;
    stats.auth = 0;
    stats.empty = 0;
    stats.word = 0;
    return sendJson(res, 200, stats);
  }

  for await (const _ of req) {
    /* 丢弃请求体 */
  }

  if (req.url.startsWith('/ok/')) {
    stats.ok += 1;
    return sendJson(res, 200, {
      choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    });
  }
  if (req.url.startsWith('/fail/')) {
    stats.fail += 1;
    return sendJson(res, 500, { error: 'mock server exploded' });
  }
  if (req.url.startsWith('/auth/')) {
    stats.auth += 1;
    return sendJson(res, 401, { error: 'invalid api key' });
  }
  // 返回合法的释义 JSON（S-002）
  if (req.url.startsWith('/word/')) {
    stats.word += 1;
    const payload = {
      definitionEn: 'to look at something carefully to check it',
      definitionL1: '检查；审视',
      senses: [
        { order: 1, definitionEn: 'to check something carefully', definitionL1: '检查', example: 'They inspected the car.' },
      ],
      collocations: ['carefully inspect', 'inspect the goods'],
      confusions: [],
      mnemonic: 'in- 进入 + spect 看 → 往里看',
    };
    return sendJson(res, 200, {
      choices: [
        { message: { role: 'assistant', content: JSON.stringify(payload) }, finish_reason: 'stop' },
      ],
    });
  }
  if (req.url.startsWith('/empty/')) {
    stats.empty += 1;
    return sendJson(res, 200, {
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    });
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`mock LLM 已启动: http://127.0.0.1:${PORT}`);
});
