/**
 * 数据模型定义，对应 docs/data-model.md
 */

export type FreqBand = 'K1' | 'K2' | 'K3' | 'K4-5' | 'K6-9' | 'off';
export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type Pos = 'n' | 'v' | 'adj' | 'adv' | 'prep' | 'conj' | 'pron' | 'det' | 'phrase';
export type Register = 'general' | 'academic' | 'formal' | 'informal';
export type Direction = 'receptive' | 'productive';
export type Stage = 1 | 2 | 3;

export interface WordFamily {
  id: string;
  headword: string;
  members: string[];
  freqRank: number;
  freqBand: FreqBand;
  cefr: Cefr;
  stage: Stage;
  pos: Pos[];
  ipa: string;
  learningBurden: number; // 1-5
  register: Register;
  sources: string[];
}

export type DefinitionStatus = 'ready' | 'pending';

/** 形态切分状态：unsegmented = 确定性规则无法切出，不生成词根卡（S-007 宁缺勿错） */
export type MorphStatus = 'segmented' | 'unsegmented' | 'pending';

export type MorphemeType = 'root' | 'prefix' | 'suffix' | 'combining_form';
export type MorphemeOrigin = 'latin' | 'greek' | 'old_english' | 'french' | 'other';

/** 词在词素序列中的一次引用 */
export interface MorphemeRef {
  morphemeId: string;
  /** 该词素在词中的位置 */
  position: MorphemeType;
  /** 实际出现的形位（异形之一） */
  allomorph: string;
}

/** 词素讲解（深入学习用）：回答"为什么是这个意思、怎么记住、和谁容易混" */
export interface MorphemeExplain {
  /** 词源与语义演变：原始义 → 现代义，讲清"为什么" */
  etymology: string;
  /** 异形说明：为什么会有这些形式（同化 / 音变 / 拉丁与法语双通道） */
  allomorphNote?: string;
  /** 派生词逐词讲解：字面义合成 → 现代义 */
  derivatives?: { word: string; gloss: string }[];
  /** 易混辨析：与相近词素怎么区分 */
  confusion?: string;
}

/** 词素：词根 / 前缀 / 后缀（S-007，对应 docs/root-data-schema.md §2.1） */
export interface Morpheme {
  /** `m.<type>.<form>`，稳定可推导（D6） */
  id: string;
  type: MorphemeType;
  /** 基本形式，如 spect */
  form: string;
  /** 异形，如 spect / spic / spek / scope；必含 form */
  allomorphs: string[];
  origin: MorphemeOrigin;
  /** 原始词形，如 specere */
  etymon: string;
  /** 英文核心义，如 to look, see */
  coreMeaning: string;
  /** 中文对应（D7：仅辅助，不作唯一考点） */
  l1Gloss: string;
  semanticField: string[];
  /** 常用词表中的派生词数量，用于排序 */
  productivity: number;
  /** 掌握后新增覆盖率（估算） */
  coverageGain: number;
  /** 1-5 学习负担 */
  difficulty: number;
  /** LLM 可选补齐（D10） */
  mnemonic?: { story?: string; cognate?: string };
  /** 深度讲解（D10）：手写标杆 + LLM 按同样格式批量补全 */
  explain?: MorphemeExplain;
  confusingWith: string[];
  /** 0-1 数据可信度，低于阈值不参与自动切分 */
  confidence: number;
  sources: string[];
}

export interface Word {
  id: string;
  lemma: string;
  familyId: string;
  pos: Pos[];
  ipa: string;
  definitionEn: string;
  definitionL1: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  cefr: Cefr;
  register: Register;
  sources: string[];
  /** 释义是否已生成（S-001 导入的词多为 pending，由 S-002 补全） */
  definitionStatus: DefinitionStatus;
  /** 形态切分结果（S-007），顺序与词形一致 */
  decomposition?: MorphemeRef[];
  /** 字面义合成，如 to look into */
  literalGlue?: string;
  /** 切分状态；未提供时视为 pending */
  morphStatus?: MorphStatus;
}

export interface Sense {
  id: string;
  wordId: string;
  senseOrder: number;
  definitionEn: string;
  definitionL1: string;
  senseFreqShare: number;
  register: Register;
  exampleSentenceIds: string[];
}

export interface Sentence {
  id: string;
  passageId?: string;
  text: string;
  translationL1?: string;
  targetWordIds: string[];
  unknownRate?: number;
}

export interface Passage {
  id: string;
  title: string;
  text: string;
  source: string;
  cefr: Cefr;
  topic: string;
  tokenCount: number;
}

export type CardTemplate =
  | 'word_to_meaning'
  | 'meaning_to_word'
  | 'cloze'
  | 'collocation'
  | 'confusion'
  /** S-007 识别方向：给出词，要求切分 + 字面义合成 */
  | 'word_to_morpheme'
  /** S-007 产出方向：给出词根与核心义，要求列出派生词 */
  | 'morpheme_to_words';

export interface Card {
  id: string;
  familyId: string;
  wordId: string;
  sentenceId?: string;
  /** 词根卡（morpheme_to_words）绑定词素；其余卡片为空 */
  morphemeId?: string;
  template: CardTemplate;
  direction: Direction;
  front: string;
  back: string;
  hint?: string;
  interleaveGroup: number;
}

export interface ReviewState {
  cardId: string;
  dueAt: number; // epoch ms
  intervalDays: number;
  ease: number;
  lapses: number;
  reps: number;
  direction: Direction;
  /** 0-1，掌握度，用于路径解锁与覆盖率判定 */
  stability: number;
  interleaveGroup: number;
  lastReviewedAt?: number;
}

export interface ReviewLog {
  seq?: number;
  cardId: string;
  reviewedAt: number;
  grade: number;
  direction: Direction;
}

export type PathNodeType =
  | 'vocab_band'
  | 'grammar'
  | 'chunk_set'
  | 'scene'
  | 'reading_set'
  | 'morpheme_set';

export type NodeStatus = 'locked' | 'available' | 'learning' | 'due' | 'mastered';

export interface PathNode {
  id: string;
  title: string;
  subtitle?: string;
  stage: Stage;
  type: PathNodeType;
  /** Canvas 布局坐标（逻辑像素） */
  x: number;
  y: number;
  prereqIds: string[];
  targetFamilyIds: string[];
  estimatedMinutes: number;
  masteryRule: { minStability: number; minReps: number };
}

export interface NodeRuntime {
  nodeId: string;
  status: NodeStatus;
  /** 已学过（复习过至少一次）的卡片数 */
  learned: number;
  /** 已达到掌握门槛（稳定度 + 次数）的卡片数 */
  mastered: number;
  total: number;
}

export interface UserProfile {
  knownFamilyIds: string[];
  coverageEstimate: number;
  vocabSizeEstimate: number;
  cefrEstimate: Cefr;
  dailyStreak: number;
  heatmap: Record<string, number>;
  reviewDebt: number;
  lastStudyDate?: string;
}

export type LlmProviderId = 'openai-compatible' | 'anthropic' | 'ollama';

/** LLM 调用记录（每人独立，S-005） */
export interface LlmUsageLog {
  seq?: number;
  at: number;
  provider: string;
  model: string;
  durationMs: number;
  ok: boolean;
  cached: boolean;
  /** 实际尝试次数（1 = 未重试） */
  attempts?: number;
  error?: string;
}

export interface LlmConfig {
  provider: LlmProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  enabled: boolean;
  /**
   * 鉴权头。Anthropic 官方用 x-api-key；
   * 国内多数 Anthropic 兼容端点（MiniMax 等）用 Authorization: Bearer。
   */
  authHeader?: 'x-api-key' | 'bearer';
}

/** 决策模型（千问 decision-model-preview）：只做结构化判断，不生成文本 */
export interface DecisionConfig {
  enabled: boolean;
  workspaceId: string;
  region: 'cn-beijing' | 'ap-southeast-1';
  apiKey: string;
  /** 例句自然度低于该值即判定不合格 */
  naturalThreshold: number;
  /**
   * 自定义端点，填本地代理地址即可绕开 CORS，例如 http://localhost:8787
   * 留空则直连百炼。
   */
  baseUrlOverride: string;
}

/** 每人独立的学习参数（学习节奏因人而异） */
export interface LearningConfig {
  dailyNewLimit: number;
  retentionTarget: number;
  showL1: boolean;
}

/** 全局共享配置：不随用户切换 */
export interface GlobalSettings {
  llm: LlmConfig;
  decision: DecisionConfig;
}

export interface Settings extends GlobalSettings {
  learning: LearningConfig;
}
