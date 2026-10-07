/**
 * 构建期：从 ECDICT 生成内置释义数据（零 LLM 依赖）。
 *
 * 为什么需要它：应用里 3000 词的释义原本只能靠大模型逐词生成，用户没配 key 时
 * 学习页 90% 以上的卡都无法客观作答（实测实际保持率只有 6%~7%）。
 * ECDICT 是 76 万词条的免费英汉词典数据库，含中文释义、音标、BNC 词频与考纲标签，
 * 构建期筛出我们词表里的词即可**开箱即有释义**。
 *
 * 用法：node scripts/build-definitions.mjs
 * 前置：ECSICT 数据缓存（脚本会提示下载命令）
 *
 * ⚠️ 许可说明：ECDICT 仓库为 MIT，但其数据是多方来源汇编（自建词表 + 开源字典 cdict +
 * BNC 语料库 + WordNet + 网友贡献）。用于个人本地学习无碍；若要商业分发，
 * 请自行复核来源授权。生成的数据会记录 source 字段以便追溯。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(tmpdir(), 'ecdict-cache.csv');
const OUT = join(root, 'public/wordlists/definitions-zh.json');

if (!existsSync(CACHE)) {
  console.error(`未找到词典缓存：${CACHE}`);
  console.error('请先下载（约 63MB）：');
  console.error('  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv" -OutFile "$env:TEMP\\ecdict-cache.csv" -TimeoutSec 900');
  process.exit(1);
}

/* 1. 目标词表 */
const wordlistPath = join(root, 'public/wordlists/top-10000.txt');
const words = readFileSync(wordlistPath, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.split(/[\t,]/)[0].trim().toLowerCase())
  .filter((w) => /^[a-z][a-z'-]*$/.test(w));
const want = new Set(words);
console.log(`目标词表：${words.length} 词`);

/* 2. 释义清洗
 * 注意：ECDICT 的多个释义之间用的是**字面 `\n`**（两个字符），不是真正的换行，
 * 因此必须先把它还原成换行再按行截取，否则卡片上会显示成 "…关于\nadv. 大约…"。 */
function splitLines(text) {
  return String(text ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function tidyZh(text, limit) {
  const lines = splitLines(text);
  if (!lines.length) return '';
  let out = lines[0];
  if (out.length < 12 && lines[1]) out += `；${lines[1]}`;
  return out.replace(/\s+/g, ' ').slice(0, limit);
}

/** WordNet 的词性缩写 → 通行写法（`s.` 是 adjective satellite，`r.` 是副词） */
const POS_FIX = [
  [/^s\.\s+/, 'adj. '],
  [/^a\.\s+/, 'adj. '],
  [/^j\.\s+/, 'adj. '],
  [/^r\.\s+/, 'adv. '],
];

/** WordNet 的交叉引用条目（如 "v. i. See Thee."）对学习毫无价值，整条丢弃 */
const CROSS_REF = /(?:^|\s)see\s+[a-z]/i;

/**
 * 英文释义清洗：丢弃交叉引用 → 规范化词性缩写 → 取首条。
 * 若首条被丢弃则自动落到下一条，避免出现 `the` 显示成 "v. i. See Thee." 这类噪声。
 */
function tidyEn(text, limit) {
  const lines = splitLines(text).filter((s) => !CROSS_REF.test(s));
  if (!lines.length) return '';
  let out = lines[0];
  for (const [re, rep] of POS_FIX) {
    if (re.test(out)) {
      out = out.replace(re, rep);
      break;
    }
  }
  if (out.length < 12 && lines[1]) out += `；${lines[1]}`;
  return out.replace(/\s+/g, ' ').slice(0, limit);
}

/* 3. 流式解析 CSV：字段内可能含换行与逗号，必须走引号状态机 */
const text = readFileSync(CACHE, 'utf8');
const entries = {};
let field = '';
let row = [];
let inQuotes = false;
let idx = null;
let scanned = 0;

const finishRow = () => {
  row.push(field);
  field = '';
  if (!idx) {
    // 表头 → 建立列名到下标的映射
    idx = {};
    row.forEach((name, i) => {
      idx[name.trim()] = i;
    });
    row = [];
    return;
  }
  const w = (row[idx.word] ?? '').toLowerCase();
  if (want.has(w) && !entries[w]) {
    const zh = tidyZh(row[idx.translation], 90);
    const en = tidyEn(row[idx.definition], 90);
    if (zh || en) {
      entries[w] = {
        zh,
        en,
        ph: (row[idx.phonetic] ?? '').trim(),
        bnc: Number(row[idx.bnc]) || 0,
        frq: Number(row[idx.frq]) || 0,
        tag: (row[idx.tag] ?? '').trim(),
        collins: Number(row[idx.collins]) || 0,
        oxford: Number(row[idx.oxford]) || 0,
      };
    }
  }
  row = [];
};

for (let i = 0; i < text.length; i += 1) {
  const ch = text[i];
  if (inQuotes) {
    if (ch === '"') {
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = false;
      }
    } else {
      field += ch;
    }
    continue;
  }
  if (ch === '"') inQuotes = true;
  else if (ch === ',') {
    row.push(field);
    field = '';
  } else if (ch === '\n') {
    finishRow();
    scanned += 1;
  } else if (ch !== '\r') {
    field += ch;
  }
}
if (field || row.length) finishRow();

/* 4. 输出 */
const hit = Object.keys(entries).length;
const payload = {
  source: 'ECDICT',
  sourceUrl: 'https://github.com/skywind3000/ECDICT',
  license: 'MIT（仓库许可）；数据为多来源汇编，商业分发前请自行复核',
  generatedAt: new Date().toISOString().slice(0, 10),
  wordlist: 'top-10000.txt',
  total: hit,
  entries,
};
writeFileSync(OUT, JSON.stringify(payload), 'utf8');

const withZh = Object.values(entries).filter((e) => e.zh).length;
const withTag = Object.values(entries).filter((e) => e.tag).length;
const missed = words.filter((w) => !entries[w]);
console.log(`扫描 ${scanned} 行 → 命中 ${hit}/${words.length}（${((hit / words.length) * 100).toFixed(1)}%）`);
console.log(`含中文释义 ${withZh} · 含考纲标签 ${withTag}`);
if (missed.length) console.log(`未命中（${missed.length}）：${missed.join(', ')}`);
console.log(`输出 ${OUT}（${(JSON.stringify(payload).length / 1024 / 1024).toFixed(2)} MB）`);
