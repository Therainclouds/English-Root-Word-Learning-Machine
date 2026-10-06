import type { Card, Word } from './types';

/**
 * 客观题目生成（作答必须落在页面上，判定必须是非黑即白的）
 *
 * 原则：
 * - 每张卡都变成**可判定的题**：要么四选一（识别方向 / 切分），要么输入答案（产出方向）
 * - 判定是确定性字符串比较（D4），不接受"我觉得我记住了"这种自评
 * - 无法客观出图的卡（比如释义还没生成）返回 null，由界面过滤并引导去生成
 */

export type QuizKind = 'choice' | 'input';

export interface Quiz {
  kind: QuizKind;
  /** 作答指令：告诉学习者这一题要产出什么 */
  instruction: string;
  /** 选择题选项（含正确项，已打乱） */
  choices?: string[];
  /** 可接受的答案集合（归一化后比较） */
  answers: string[];
  /** 正确答案的可读展示 */
  display: string;
}

const INSTRUCTION: Record<string, string> = {
  word_to_meaning: '选出这个词的中文意思',
  meaning_to_word: '拼出对应的英文单词',
  cloze: '填入句中缺少的单词',
  collocation: '写出这个搭配',
  confusion: '选出正确的区分',
  word_to_morpheme: '选出正确的词素切分',
  morpheme_to_words: '写出一个含这个词根的单词',
};

/** FNV-1a：给同一张卡生成稳定的选项顺序，避免每次渲染乱跳 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** 稳定采样：同一 seed 永远得到同一组干扰项 */
function sample<T>(pool: T[], n: number, seed: number): T[] {
  if (pool.length <= n) return [...pool];
  const picked: T[] = [];
  const used = new Set<number>();
  let cursor = seed;
  while (picked.length < n && used.size < pool.length) {
    cursor = (Math.imul(cursor, 1103515245) + 12345) >>> 0;
    const idx = cursor % pool.length;
    if (used.has(idx)) continue;
    used.add(idx);
    picked.push(pool[idx]);
  }
  return picked;
}

function shuffle<T>(list: T[], seed: number): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = (seed >>> (i % 16)) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clean(text: string | undefined) {
  return (text ?? '').trim();
}

function isPlaceholder(text: string) {
  return !text || text.includes('待生成') || text.includes('SPEC');
}

/**
 * 两个释义是否高度相似（归一化后互相包含）。
 * 只排除"完全相等"是不够的：库里同时存在「大约」和「关于；大约」时，
 * 两个选项在语义上都成立，学习者选了另一个同样正确的项却被判错。
 */
function tooSimilar(a: string, b: string) {
  const norm = (s: string) => s.replace(/[\s；;、,，.。·\-—~()（）]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/** 挑干扰项：优先用"与正确答案不相似"的候选；若过滤后不足 3 个，回退到全部候选以保证出题能力 */
function pickDistractors(pool: string[], correct: string, cardId: string) {
  const safe = pool.filter((t) => !tooSimilar(t, correct));
  return sample(safe.length >= 3 ? safe : pool, 3, hash(cardId));
}

/** 词 → 中文意思：四选一。干扰项取自词库里其他词的释义 */
function choiceFromMeanings(card: Card, correct: string, words: Word[]): Quiz | null {
  if (isPlaceholder(correct)) return null;
  const pool = Array.from(
    new Set(
      words
        .map((w) => clean(w.definitionL1))
        .filter((t) => t && t !== correct && !isPlaceholder(t)),
    ),
  );
  const distractors = pickDistractors(pool, correct, card.id);
  if (distractors.length === 0) return null;
  return {
    kind: 'choice',
    instruction: INSTRUCTION[card.template] ?? '选择正确答案',
    choices: shuffle([correct, ...distractors], hash(card.id)),
    answers: [correct],
    display: correct,
  };
}

/** 词 → 词素切分：四选一。干扰项取自其他已切分词的切分形态 */
function choiceFromDecompositions(card: Card, correct: string, words: Word[]): Quiz | null {
  if (isPlaceholder(correct)) return null;
  const pool = Array.from(
    new Set(
      words
        .map((w) => (w.decomposition ?? []).map((r) => r.allomorph).join(' + '))
        .filter((t) => t && t !== correct),
    ),
  );
  const distractors = sample(pool, 3, hash(card.id));
  if (distractors.length === 0) return null;
  return {
    kind: 'choice',
    instruction: INSTRUCTION[card.template] ?? '选择正确答案',
    choices: shuffle([correct, ...distractors], hash(card.id)),
    answers: [correct],
    display: correct,
  };
}

/**
 * 生成一题；返回 null 表示这张卡当前无法客观作答（例如释义还没生成）。
 */
export function buildQuiz(card: Card, word: Word | undefined, words: Word[]): Quiz | null {
  const back = clean(card.back);

  // 识别方向：给词，选中文意思 → 四选一
  if (card.template === 'word_to_meaning') {
    const correct = clean(word?.definitionL1) || clean(word?.definitionEn) || back;
    return choiceFromMeanings(card, correct, words);
  }

  // 词 → 词素切分 → 四选一
  if (card.template === 'word_to_morpheme') {
    const correct = (word?.decomposition ?? []).map((r) => r.allomorph).join(' + ');
    return choiceFromDecompositions(card, correct, words);
  }

  // 产出方向：写词（任一可接受答案命中即正确）
  if (isPlaceholder(back)) return null;
  if (card.template === 'morpheme_to_words') {
    const answers = back
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!answers.length) return null;
    return {
      kind: 'input',
      instruction: INSTRUCTION[card.template] ?? '写出答案',
      // 全量答案参与判定；展示时只列前 8 个，避免长答案撑满屏幕
      answers,
      display:
        answers.length > 8
          ? `${answers.slice(0, 8).join(' / ')} 等 ${answers.length} 个`
          : answers.join(' / '),
    };
  }

  return {
    kind: 'input',
    instruction: INSTRUCTION[card.template] ?? '写出答案',
    answers: [back],
    display: back,
  };
}
