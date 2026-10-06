/**
 * 下载公开词频表并转换为 S-001 的导入格式（每行：word<TAB>rank）。
 *
 * 用法：node scripts/fetch-wordlist.mjs [数量]
 * 输出：public/wordlists/top-10000.txt（已被 .gitignore 忽略）
 *
 * 说明：默认使用 Google Trillion Word Corpus 派生的公开词表，
 * 仅作频率排序参考；词形与释义建议自行核对替换。
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE =
  process.env.WORDLIST_URL ??
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt';

const limit = Number(process.argv[2] ?? 10000);
const outDir = path.join(process.cwd(), 'public', 'wordlists');
const outFile = path.join(outDir, 'top-10000.txt');

const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`下载失败：${res.status} ${res.statusText}\n源：${SOURCE}`);
  process.exit(1);
}

const raw = await res.text();
const seen = new Set();
const lines = [];

// 注意：不能按长度过滤掉单字母词——"a" 与 "i" 是最高频的两个词
const SINGLE_LETTER_KEEP = new Set(['a', 'i']);

for (const token of raw.split(/\s+/)) {
  const word = token.trim().toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(word)) continue;
  if (word.length < 2 && !SINGLE_LETTER_KEEP.has(word)) continue;
  if (seen.has(word)) continue;
  seen.add(word);
  lines.push(`${word}\t${lines.length + 1}`);
  if (lines.length >= limit) break;
}

if (!lines.length) {
  console.error('未解析到有效词条，请检查源格式');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`已写入 ${lines.length} 条 → ${path.relative(process.cwd(), outFile)}`);
