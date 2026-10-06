/**
 * S-003 读物扩充：从 TED 抓演讲文稿，生成分级读物
 *
 * 用法：
 *   node scripts/fetch-ted.mjs <slug 或 URL> [<slug 或 URL> ...]
 *   node scripts/fetch-ted.mjs --file scripts/ted-slugs.txt
 *
 * 例：
 *   node scripts/fetch-ted.mjs dan_gilbert_the_surprising_science_of_happiness
 *   node scripts/fetch-ted.mjs https://www.ted.com/talks/xyz_the_title/transcript
 *
 * 产物：`public/passages/ted.json`（按 id 增量合并，不会覆盖已抓的文章）
 *
 * ⚠️ 授权：TED Talks 采用 CC BY–NC–ND。
 *   - BY：必须署名 —— 已写入 source 字段（演讲者 + 原文链接）
 *   - NC：仅限非商业使用（本应用本地自用，符合）
 *   - ND：禁止演绎 —— 脚本只做格式清洗（去时间轴/掌声标记），**不改写、不翻译、不删段**
 *   若要公开分发该数据文件，请先自行确认授权范围。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(root, 'public/passages/ted.json');
const WORDLIST = join(root, 'public/wordlists/top-10000.txt');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/* ---------------- 输入解析 ---------------- */

/** 从 slug 或 URL 里取出 slug */
function toSlug(input) {
  const raw = input.trim();
  if (!raw || raw.startsWith('#')) return null;
  const m = raw.match(/ted\.com\/talks\/([^/?#]+)/);
  if (m) return m[1];
  if (/^[a-z0-9_]+$/i.test(raw)) return raw;
  return null;
}

function readInputs(argv) {
  const fileIdx = argv.indexOf('--file');
  if (fileIdx >= 0 && argv[fileIdx + 1]) {
    const file = argv[fileIdx + 1];
    if (!existsSync(file)) throw new Error(`找不到文件：${file}`);
    return readFileSync(file, 'utf8').split(/\r?\n/).map(toSlug).filter(Boolean);
  }
  const list = argv.map(toSlug).filter(Boolean);
  if (!list.length) {
    throw new Error('请给出至少一个 slug 或 TED 链接（或用 --file 指定清单文件）');
  }
  return list;
}

/* ---------------- 抓取与解析 ---------------- */

async function fetchTranscript(slug) {
  const url = `https://www.ted.com/talks/${slug}/transcript`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const html = await res.text();

  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i,
  );
  if (!m) throw new Error('页面结构变了：找不到 __NEXT_DATA__');
  const data = JSON.parse(m[1]);

  // 优先用现成的整段 transcript；没有再退回 paragraphs → cues 拼接
  const transcript = findString(data, 'transcript');
  let text = transcript;
  if (!text) {
    const paragraphs = findArray(data, 'paragraphs');
    text = (paragraphs ?? [])
      .flatMap((p) => (Array.isArray(p?.cues) ? p.cues.map((c) => c?.text ?? '') : []))
      .join(' ')
      .trim();
  }
  if (!text) throw new Error('页面里没有文稿内容（可能该演讲未提供 transcript）');

  const title = findString(data, 'title') ?? ogMeta(html, 'og:title') ?? slug;
  const speaker =
    findString(data, 'presenterDisplayName') ?? ogMeta(html, 'og:description') ?? 'TED';

  return { slug, url, title, speaker, text: clean(text) };
}

/** 深度优先找第一个字符串字段（TED 的 JSON 结构层级会变，不能写死路径） */
function findString(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findString(item, key);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node[key] === 'string' && node[key].trim()) return node[key].trim();
  for (const value of Object.values(node)) {
    const hit = findString(value, key);
    if (hit) return hit;
  }
  return null;
}

function findArray(node, key) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findArray(item, key);
      if (hit) return hit;
    }
    return null;
  }
  if (Array.isArray(node[key]) && node[key].length) return node[key];
  for (const value of Object.values(node)) {
    const hit = findArray(value, key);
    if (hit) return hit;
  }
  return null;
}

function ogMeta(html, property) {
  const m = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
  );
  return m ? m[1].trim() : null;
}

/** 只做格式清洗，不改写内容（CC BY–NC–ND 的 ND 约束） */
function clean(text) {
  return text
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\((?:Laughter|Applause|Music|Video|Audio|Cheers|Cheering|Beatboxing)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------------- 难度估算 ---------------- */

function loadRanks() {
  const map = new Map();
  if (!existsSync(WORDLIST)) return map;
  readFileSync(WORDLIST, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const [word, rankRaw] = line.split(/[\t,]/);
      const word2 = (word ?? '').trim().toLowerCase();
      if (!word2) return;
      const rank = Number(rankRaw);
      map.set(word2, Number.isFinite(rank) && rank > 0 ? rank : i + 1);
    });
  return map;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'’\- ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 难度估算：未知 = 不在前 3000 词族内
 * - unknownRate：按**词形去重**统计，与阅读页口径一致（读者会真实遇到这么多没见过的词形）
 * - tokenCoverage：按**出现次数**统计的 K1–K3 覆盖率（Nation 口径，更接近"读起来是否顺"）
 * 两者差异很大是正常的：TED 这类演讲的 type 生词率常在 30%+，但 token 覆盖率仍能有 90% 上下。
 */
function estimate(text, ranks) {
  const tokens = tokenize(text);
  if (!tokens.length) return { unknownRate: 0, tokenCoverage: 0, cefr: 'A2', tokenCount: 0 };
  const types = new Set(tokens);
  let unknownTypes = 0;
  for (const t of types) {
    const rank = ranks.get(t);
    if (!rank || rank > 3000) unknownTypes += 1;
  }
  const knownTokens = tokens.filter((t) => {
    const rank = ranks.get(t);
    return rank && rank <= 3000;
  }).length;
  const unknownRate = unknownTypes / types.size;
  return {
    unknownRate,
    tokenCoverage: knownTokens / tokens.length,
    cefr: cefrOf(unknownRate),
    tokenCount: tokens.length,
  };
}

/** 按可理解输入阈值（2%–5% 合适）反推 CEFR（这是基于词频表的估算，真实生词率按用户在运行时算） */
function cefrOf(rate) {
  if (rate <= 0.02) return 'A2';
  if (rate <= 0.05) return 'B1';
  if (rate <= 0.1) return 'B2';
  return 'C1';
}

/* ---------------- 主流程 ---------------- */

const slugs = readInputs(process.argv.slice(2));
const ranks = loadRanks();

const existing = existsSync(OUT_FILE)
  ? JSON.parse(readFileSync(OUT_FILE, 'utf8'))
  : [];
const byId = new Map(existing.map((p) => [p.id, p]));

let ok = 0;
let failed = 0;

for (const slug of slugs) {
  try {
    const raw = await fetchTranscript(slug);
    const { unknownRate, tokenCoverage, cefr, tokenCount } = estimate(raw.text, ranks);
    byId.set(`p.ted.${slug}`, {
      id: `p.ted.${slug}`,
      title: raw.title,
      speaker: raw.speaker,
      url: raw.url,
      cefr,
      topic: 'ted',
      text: raw.text,
      tokenCount,
      unknownRate: Number(unknownRate.toFixed(4)),
      tokenCoverage: Number(tokenCoverage.toFixed(4)),
      // CC BY：署名 + 原文链接必须保留（用 ASCII，避免任何环境下出现编码问题）
      source: `TED - ${raw.speaker} (CC BY-NC-ND) ${raw.url}`,
    });
    ok += 1;
    const warn =
      unknownRate > 0.1
        ? '  ⚠️ 远超 2%-5% 的可理解输入区间，只建议进阶阶段使用'
        : unknownRate > 0.05
          ? '  （略高于可理解输入区间）'
          : '';
    console.log(
      `✅ ${raw.title.slice(0, 44)} · ${tokenCount} 词 · 生词率(type) ${(unknownRate * 100).toFixed(1)}%` +
        ` · 覆盖(token) ${(tokenCoverage * 100).toFixed(1)}% · ${cefr}${warn}`,
    );
  } catch (err) {
    failed += 1;
    console.log(`❌ ${slug} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (!existsSync(join(root, 'public/passages'))) mkdirSync(join(root, 'public/passages'), { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify([...byId.values()], null, 2)}\n`, 'utf8');

console.log(`\n完成：成功 ${ok}，失败 ${failed}；共 ${byId.size} 篇 → public/passages/ted.json`);
if (!ranks.size) {
  console.log('⚠️  没有词频表（public/wordlists/top-10000.txt），难度未估算；可先跑 node scripts/fetch-wordlist.mjs 3000');
}
