'use client';

import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import type {
  Card,
  GlobalSettings,
  LearningConfig,
  LlmUsageLog,
  Morpheme,
  Passage,
  PathNode,
  ReviewLog,
  ReviewState,
  Sentence,
  Sense,
  UserProfile,
  Word,
  WordFamily,
} from './types';

/**
 * 数据分两层：
 * - 共享只读词库（elm-shared，全局一份）：词族 / 词 / 义项 / 例句 / 读物 / 卡片 / 路径节点
 * - 每人学习状态（elm-<userId>）：复习状态 / 复习流水 / 画像 / 学习参数
 *
 * 这样换词表不会打乱任何人的进度，也不会为每个用户复制一份词库。
 */

const SHARED_DB = 'elm-shared';
const DB_PREFIX = 'elm';
const LEGACY_DB = 'english-learning-machine';
/**
 * v2：用户库新增 learning 表（每人独立学习参数）
 * v3：用户库新增 llmLogs 表（LLM 调用记录，S-005）
 * v4：共享库新增 morphemes 表（词根词缀，S-007）
 * 必须升版本号，否则已存在的用户库不会执行 upgrade，缺表会导致读取抛 NotFoundError。
 */
const DB_VERSION = 4;
const SETTINGS_KEY = 'elm.globalSettings';
const MIGRATED_KEY = 'elm.legacyMigrated';

/** 共享内容库的表 */
export const SHARED_STORES = [
  'wordFamilies',
  'words',
  'senses',
  'sentences',
  'passages',
  'cards',
  'pathNodes',
  'morphemes',
] as const;

/** 每人独立的表 */
export const USER_STORES = ['reviewStates', 'reviewLogs', 'profile', 'learning', 'llmLogs'] as const;

export const DEFAULT_LEARNING: LearningConfig = {
  dailyNewLimit: 15,
  retentionTarget: 0.9,
  showL1: true,
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.4,
    enabled: false,
    authHeader: 'bearer',
  },
  decision: {
    enabled: false,
    workspaceId: '',
    region: 'cn-beijing',
    apiKey: '',
    naturalThreshold: 0.6,
    baseUrlOverride: '',
  },
};

export const DEFAULT_PROFILE: UserProfile = {
  knownFamilyIds: [],
  coverageEstimate: 0,
  vocabSizeEstimate: 0,
  cefrEstimate: 'A1',
  dailyStreak: 0,
  heatmap: {},
  reviewDebt: 0,
};

function dbNameFor(userId: string) {
  return `${DB_PREFIX}-${userId}`;
}

function buildStores(db: IDBPDatabase, stores: readonly string[]) {
  const defs: Record<string, { keyPath: string; auto: boolean; indexes: string[] }> = {
    wordFamilies: { keyPath: 'id', auto: false, indexes: ['freqRank', 'freqBand', 'stage'] },
    words: { keyPath: 'id', auto: false, indexes: ['familyId', 'cefr'] },
    senses: { keyPath: 'id', auto: false, indexes: ['wordId'] },
    sentences: { keyPath: 'id', auto: false, indexes: ['passageId'] },
    passages: { keyPath: 'id', auto: false, indexes: ['cefr', 'topic'] },
    cards: { keyPath: 'id', auto: false, indexes: ['familyId', 'direction'] },
    pathNodes: { keyPath: 'id', auto: false, indexes: ['stage'] },
    morphemes: { keyPath: 'id', auto: false, indexes: ['type', 'origin', 'productivity'] },
    reviewStates: { keyPath: 'cardId', auto: false, indexes: ['dueAt', 'interleaveGroup'] },
    reviewLogs: { keyPath: 'seq', auto: true, indexes: ['reviewedAt'] },
    profile: { keyPath: 'key', auto: false, indexes: [] },
    learning: { keyPath: 'key', auto: false, indexes: [] },
    llmLogs: { keyPath: 'seq', auto: true, indexes: ['at'] },
  };

  for (const name of stores) {
    if (db.objectStoreNames.contains(name)) continue;
    const def = defs[name];
    if (!def) continue;
    const store = db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: def.auto });
    for (const idx of def.indexes) store.createIndex(idx, idx);
  }
}

let sharedDbPromise: Promise<IDBPDatabase> | null = null;

export function getSharedDb() {
  if (!sharedDbPromise) {
    sharedDbPromise = openDB(SHARED_DB, DB_VERSION, {
      upgrade(db) {
        buildStores(db, SHARED_STORES);
      },
    });
  }
  return sharedDbPromise;
}

const dbCache = new Map<string, Promise<IDBPDatabase>>();

export function getDb(userId: string) {
  let promise = dbCache.get(userId);
  if (!promise) {
    promise = openDB(dbNameFor(userId), DB_VERSION, {
      upgrade(db) {
        buildStores(db, USER_STORES);
      },
    });
    dbCache.set(userId, promise);
  }
  return promise;
}

/** 只删除某人的学习状态，不影响共享词库 */
export async function deleteUserDb(userId: string) {
  const cached = dbCache.get(userId);
  if (cached) {
    try {
      (await cached).close();
    } catch {
      /* 已关闭 */
    }
    dbCache.delete(userId);
  }
  await deleteDB(dbNameFor(userId));
}

/** 旧版单库 → 拆分结构（内容进共享库，状态归该用户） */
export async function migrateLegacyData(userId: string) {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const databases = await (
      indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
    ).databases?.();
    if (!databases?.some((d) => d.name === LEGACY_DB)) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }

    const legacy = await openDB(LEGACY_DB, 1, { upgrade: () => undefined });
    const shared = await getSharedDb();
    const userDb = await getDb(userId);

    for (const name of SHARED_STORES) {
      if (!legacy.objectStoreNames.contains(name)) continue;
      const rows = (await legacy.getAll(name)) as unknown[];
      if (!rows.length) continue;
      const tx = shared.transaction(name, 'readwrite');
      const payload = name === 'words' ? rows.map(normalizeWord) : rows;
      await Promise.all([...payload.map((row) => tx.objectStore(name).put(row)), tx.done]);
    }
    for (const name of USER_STORES) {
      if (name === 'learning') continue;
      if (!legacy.objectStoreNames.contains(name)) continue;
      const rows = (await legacy.getAll(name)) as unknown[];
      if (!rows.length) continue;
      const tx = userDb.transaction(name, 'readwrite');
      await Promise.all([...rows.map((row) => tx.objectStore(name).put(row)), tx.done]);
    }
    legacy.close();
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    localStorage.setItem(MIGRATED_KEY, '1');
  }
}

/** 老版本「每人一份词库」→ 共享词库（内容只搬一次） */
export async function migrateUserContentToShared(userId: string) {
  try {
    const shared = await getSharedDb();
    if ((await shared.count('wordFamilies')) > 0) return;

    const userDb = await getDb(userId);
    if (!userDb.objectStoreNames.contains('wordFamilies')) return;
    const rows = (await userDb.getAll('wordFamilies')) as unknown[];
    if (!rows.length) return;

    for (const name of SHARED_STORES) {
      if (!userDb.objectStoreNames.contains(name)) continue;
      const content = (await userDb.getAll(name)) as unknown[];
      if (!content.length) continue;
      const tx = shared.transaction(name, 'readwrite');
      const payload = name === 'words' ? content.map(normalizeWord) : content;
      await Promise.all([...payload.map((row) => tx.objectStore(name).put(row)), tx.done]);
    }
  } catch {
    /* 迁移失败则走播种逻辑 */
  }
}

/**
 * 旧数据没有 definitionStatus 字段（v3 之前导入/迁移的词）。
 * 必须归一化，否则会被当成"未就绪"从而丢失已有释义。
 */
function normalizeWord(row: unknown): unknown {
  const word = row as { definitionStatus?: string; definitionEn?: string };
  if (word && typeof word === 'object' && !word.definitionStatus) {
    return { ...word, definitionStatus: word.definitionEn?.trim() ? 'ready' : 'pending' };
  }
  return row;
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略 */
  }
}

/** 全局配置（大模型 / 决策模型），所有用户共用 */
export const settingsRepo = {
  load: () => readLS(SETTINGS_KEY, DEFAULT_GLOBAL_SETTINGS),
  save: (value: GlobalSettings) => writeLS(SETTINGS_KEY, value),
};

/** 每人独立的学习参数 */
export const learningRepo = {
  get: async (userId: string): Promise<LearningConfig> => {
    const row = (await getDb(userId)).get('learning', 'learning') as Promise<
      { key: string; value: LearningConfig } | undefined
    >;
    return (await row)?.value ?? DEFAULT_LEARNING;
  },
  save: async (userId: string, value: LearningConfig) => {
    await (await getDb(userId)).put('learning', { key: 'learning', value });
  },
};

export const profileRepo = {
  get: async (userId: string): Promise<UserProfile> => {
    const row = (await getDb(userId)).get('profile', 'profile') as Promise<
      { key: string; value: UserProfile } | undefined
    >;
    return (await row)?.value ?? DEFAULT_PROFILE;
  },
  save: async (userId: string, profile: UserProfile) => {
    await (await getDb(userId)).put('profile', { key: 'profile', value: profile });
  },
};

/* ---------------- 共享词库（只读内容） ---------------- */

export const wordsRepo = {
  async bulkPut(families: WordFamily[], words: Word[], senses: Sense[], sentences: Sentence[]) {
    const db = await getSharedDb();
    const tx = db.transaction(['wordFamilies', 'words', 'senses', 'sentences'], 'readwrite');
    await Promise.all([
      ...families.map((f) => tx.objectStore('wordFamilies').put(f)),
      ...words.map((w) => tx.objectStore('words').put(w)),
      ...senses.map((s) => tx.objectStore('senses').put(s)),
      ...sentences.map((s) => tx.objectStore('sentences').put(s)),
      tx.done,
    ]);
  },
  allFamilies: async () => (await getSharedDb()).getAll('wordFamilies') as Promise<WordFamily[]>,
  allWords: async () => (await getSharedDb()).getAll('words') as Promise<Word[]>,
  allSenses: async () => (await getSharedDb()).getAll('senses') as Promise<Sense[]>,
  allSentences: async () => (await getSharedDb()).getAll('sentences') as Promise<Sentence[]>,
  getWord: async (id: string) => (await getSharedDb()).get('words', id) as Promise<Word | undefined>,
  getSentence: async (id: string) =>
    (await getSharedDb()).get('sentences', id) as Promise<Sentence | undefined>,
  countFamilies: async () => (await getSharedDb()).count('wordFamilies'),
};

export const passagesRepo = {
  bulkPut: async (rows: Passage[]) => {
    const db = await getSharedDb();
    const tx = db.transaction('passages', 'readwrite');
    await Promise.all([...rows.map((r) => tx.objectStore('passages').put(r)), tx.done]);
  },
  all: async () => (await getSharedDb()).getAll('passages') as Promise<Passage[]>,
};

export const sentencesRepo = {
  bulkPut: async (rows: Sentence[]) => {
    const db = await getSharedDb();
    const tx = db.transaction('sentences', 'readwrite');
    await Promise.all([...rows.map((r) => tx.objectStore('sentences').put(r)), tx.done]);
  },
  all: async () => (await getSharedDb()).getAll('sentences') as Promise<Sentence[]>,
};

export const cardsRepo = {
  bulkPut: async (rows: Card[]) => {
    const db = await getSharedDb();
    const tx = db.transaction('cards', 'readwrite');
    await Promise.all([...rows.map((r) => tx.objectStore('cards').put(r)), tx.done]);
  },
  all: async () => (await getSharedDb()).getAll('cards') as Promise<Card[]>,
  get: async (id: string) => (await getSharedDb()).get('cards', id) as Promise<Card | undefined>,
};

export const pathRepo = {
  bulkPut: async (rows: PathNode[]) => {
    const db = await getSharedDb();
    const tx = db.transaction('pathNodes', 'readwrite');
    await Promise.all([...rows.map((r) => tx.objectStore('pathNodes').put(r)), tx.done]);
  },
  all: async () => (await getSharedDb()).getAll('pathNodes') as Promise<PathNode[]>,
};

/** 词素（S-007）：共享只读，换词库不影响任何人的进度 */
export const morphemesRepo = {
  bulkPut: async (rows: Morpheme[]) => {
    const db = await getSharedDb();
    const tx = db.transaction('morphemes', 'readwrite');
    for (const row of rows) tx.store.put(row);
    await tx.done;
  },
  all: async () => (await getSharedDb()).getAll('morphemes') as Promise<Morpheme[]>,
  get: async (id: string) => (await getSharedDb()).get('morphemes', id) as Promise<Morpheme | undefined>,
  count: async () => (await getSharedDb()).count('morphemes'),
};

/* ---------------- 每人学习状态 ---------------- */

export const llmRepo = {
  log: async (userId: string, entry: Omit<LlmUsageLog, 'seq'>) => {
    await (await getDb(userId)).add('llmLogs', entry as LlmUsageLog);
  },
  recent: async (userId: string, limit = 12): Promise<LlmUsageLog[]> => {
    const all = (await (await getDb(userId)).getAll('llmLogs')) as LlmUsageLog[];
    return all.slice(-limit).reverse();
  },
  count: async (userId: string) => (await getDb(userId)).count('llmLogs'),
};

export const reviewRepo = {
  all: async (userId: string) =>
    (await getDb(userId)).getAll('reviewStates') as Promise<ReviewState[]>,
  get: async (userId: string, cardId: string) =>
    (await getDb(userId)).get('reviewStates', cardId) as Promise<ReviewState | undefined>,
  put: async (userId: string, state: ReviewState) => {
    await (await getDb(userId)).put('reviewStates', state);
  },
  bulkPut: async (userId: string, rows: ReviewState[]) => {
    const db = await getDb(userId);
    const tx = db.transaction('reviewStates', 'readwrite');
    await Promise.all([...rows.map((r) => tx.objectStore('reviewStates').put(r)), tx.done]);
  },
  log: async (userId: string, entry: Omit<ReviewLog, 'seq'>) => {
    await (await getDb(userId)).add('reviewLogs', entry as ReviewLog);
  },
  logs: async (userId: string) => (await getDb(userId)).getAll('reviewLogs') as Promise<ReviewLog[]>,
};
