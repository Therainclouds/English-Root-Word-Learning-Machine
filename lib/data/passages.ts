import type { Cefr, Passage, Sentence } from '../types';

/**
 * S-003 内置分级读物（原创短文，避免版权问题）。
 * 用词刻意控制在 K1–K2 为主，便于生词率落在可理解区间。
 * 窄读：同一 topic 下有多篇，便于连续输入。
 */
export interface PassageSeed {
  id: string;
  title: string;
  cefr: Cefr;
  topic: string;
  text: string;
}

export const PASSAGE_SEEDS: PassageSeed[] = [
  {
    id: 'p.daily.kitchen',
    title: 'A Morning in the Kitchen',
    cefr: 'A1',
    topic: 'daily',
    text: `I get up at seven and go to the kitchen. The water is hot, so I make tea and eat some bread. My sister wants an egg, but we have no eggs left. She is not happy about that. I tell her we can buy eggs on the way home. She smiles and drinks her milk. Then we leave the house together.`,
  },
  {
    id: 'p.daily.bus',
    title: 'The Bus to Work',
    cefr: 'A1',
    topic: 'daily',
    text: `The bus comes at eight every morning. Many people wait near the door. I stand between a woman with a bag and a man who reads a book. The bus is full, but the driver is kind and waits for us. I get off near the bank and walk for ten minutes. Work starts at nine. I am never late.`,
  },
  {
    id: 'p.daily.rain',
    title: 'A Walk in the Rain',
    cefr: 'A2',
    topic: 'daily',
    text: `It started to rain while I was walking home. I had no umbrella, so I stood under a small tree and waited. A woman opened her door and called me inside. We talked about the weather, the price of food, and her garden. When the rain stopped, I thanked her and walked on. I was wet, but I felt good.`,
  },
  {
    id: 'p.learning.forget',
    title: 'Why We Forget New Words',
    cefr: 'B1',
    topic: 'learning',
    text: `Most people forget a new word within a few days. This is normal, not a sign that you are bad at languages. Forgetting happens fastest right after you learn something. If you meet the word again before it disappears, your memory becomes stronger. That is why small, regular review works better than one long study night. The same idea explains why reading helps: it brings old words back in new contexts.`,
  },
  {
    id: 'p.learning.habit',
    title: 'The Power of a Small Habit',
    cefr: 'B1',
    topic: 'learning',
    text: `A habit is easier to keep when it is small. Ten minutes a day is enough to make progress, because you can repeat it without much effort. Many learners fail not because they are lazy, but because they plan too much. They choose an hour a day, miss a week, and then stop. A short session that you keep is worth more than a perfect plan that you drop.`,
  },
];

function countWords(text: string) {
  return (text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length;
}

/** 拆句：按 . ! ? 切分，保留标点 */
function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildPassageEntities(): { passages: Passage[]; sentences: Sentence[] } {
  const passages: Passage[] = [];
  const sentences: Sentence[] = [];

  for (const seed of PASSAGE_SEEDS) {
    const parts = splitSentences(seed.text);
    passages.push({
      id: seed.id,
      title: seed.title,
      text: seed.text,
      source: 'builtin',
      cefr: seed.cefr,
      topic: seed.topic,
      tokenCount: countWords(seed.text),
    });
    parts.forEach((text, index) => {
      sentences.push({
        id: `${seed.id}.s${index}`,
        passageId: seed.id,
        text,
        targetWordIds: [],
      });
    });
  }

  return { passages, sentences };
}
