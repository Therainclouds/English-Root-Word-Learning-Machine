'use client';

import type { DecisionConfig, LlmConfig } from '../types';
import { createProvider, parseJsonLoose } from './index';

/**
 * 千问 decision-model-preview（百炼决策模型）
 *
 * 特点：不生成文本（官方标注最大输出长度 0），一次前向返回
 * choice / noul / score 的判定结果 + 概率分布 + 置信度。
 * 因此只能用于「判断」，不能用于生成释义或例句。
 *
 * 协议：POST /compatible-mode/v1/systemone（既非 OpenAI 也非 Anthropic）
 * 端点：https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/systemone
 */

export type QuestionType = 'choice' | 'noul' | 'score';

export interface DecisionQuestion {
  type: QuestionType;
  instructions?: string;
  criteria?: Record<string, string> | string[];
}

export interface DecisionAnswer {
  type: QuestionType;
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
}

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  requestId?: string;
  latencyMs?: number;
}

export function decisionEndpoint(cfg: DecisionConfig) {
  const override = cfg.baseUrlOverride?.trim();
  if (override) {
    const base = override.replace(/\/+$/, '');
    return base.endsWith('/systemone') ? base : `${base}/v1/systemone`;
  }
  return `https://${cfg.workspaceId}.${cfg.region}.maas.aliyuncs.com/compatible-mode/v1/systemone`;
}

/**
 * 全局兜底的大模型配置。
 *
 * 应用只需配**一个 LLM**：`use-app` 会把 `settings.llm` 注册到这里，
 * 于是决策模型的调用点（学习负担评分、例句质量校验）不必逐个透传参数。
 */
let fallbackLlm: LlmConfig | undefined;

export function setDecisionFallbackLlm(llm: LlmConfig | undefined) {
  fallbackLlm = llm;
}

/** 当前是否有可用的判断后端（专用决策端点，或已启用的大模型） */
export function hasDecisionBackend(cfg: DecisionConfig) {
  if (cfg.workspaceId || cfg.baseUrlOverride?.trim()) return true;
  return !!(fallbackLlm?.enabled && fallbackLlm.baseUrl?.trim());
}

const DECISION_SYSTEM = `You are a strict evaluator inside a vocabulary-learning app. You never write prose.
Rules:
- Output the JSON object directly. No markdown fences, no explanations, no <think> tags.
- Return exactly one entry per requested key, using the same keys.
- For a 是非 (noul) question: {"<key>": {"noul": <probability 0-1 that the answer is yes>, "confidence": <0-1>}}
- For a 评分 (score) question: {"<key>": {"score": <number 1-5, decimals allowed>, "confidence": <0-1>}}
- For a 分类 (choice) question: {"<key>": {"choice": "<one of the allowed values>", "confidence": <0-1>}}
- Be honest: when uncertain, lower "confidence" instead of guessing.`;

/**
 * 用**普通大模型**完成判断 —— 让用户只需要配一个 LLM，不必另开百炼决策模型凭据。
 *
 * 专用决策模型的形态是「一次前向只输出概率与置信度、不生成文本」；普通 LLM 没有这个协议，
 * 因此这里用 JSON 约束让模型输出等价结构（概率 + 置信度），上层沿用同一套阈值消费。
 * 代价是可靠性略低于专用模型 —— 所以解析失败或置信度低时一律回退（各调用点都有兜底）。
 */
async function decideViaLlm(
  llm: LlmConfig,
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, DecisionQuestion>,
  signal?: AbortSignal,
): Promise<DecisionResult> {
  const stateText = typeof state === 'string' ? state : JSON.stringify(state, null, 1);
  const questionText = Object.entries(questions)
    .map(([key, q]) => {
      if (q.type === 'noul') return `- "${key}": 是非判断 —— ${q.instructions ?? ''}`;
      if (q.type === 'score') {
        // criteria 可能是数组（按分值顺序）或「标签→说明」对象
        const criteria = Array.isArray(q.criteria)
          ? q.criteria.join(' / ')
          : q.criteria
            ? Object.entries(q.criteria)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' / ')
            : '';
        return (
          `- "${key}": 1-5 评分 —— ${q.instructions ?? ''}` +
          (criteria ? `\n  评分标准（依次为 1 到 5 分）：${criteria}` : '')
        );
      }
      return `- "${key}": 分类 —— ${q.instructions ?? ''}`;
    })
    .join('\n');

  const provider = createProvider(llm);
  const raw = await provider.chat(
    [
      { role: 'system', content: DECISION_SYSTEM },
      { role: 'user', content: `【待判断对象】\n${stateText}\n\n【要给出的判断】\n${questionText}` },
    ],
    signal,
  );

  const parsed = parseJsonLoose<
    Record<string, { noul?: number; score?: number; choice?: string; confidence?: number }>
  >(raw);

  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, q] of Object.entries(questions)) {
    const item = parsed[key];
    if (!item) continue;
    const confidence = typeof item.confidence === 'number' ? item.confidence : 0.5;
    if (q.type === 'noul') answers[key] = { type: 'noul', noul: item.noul ?? 0, confidence };
    else if (q.type === 'score') answers[key] = { type: 'score', score: item.score ?? 3, confidence };
    else answers[key] = { type: 'choice', choice: item.choice, confidence };
  }
  return { answers };
}

export async function decide(
  cfg: DecisionConfig,
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, DecisionQuestion>,
  signal?: AbortSignal,
  llm?: LlmConfig,
): Promise<DecisionResult> {
  // 一个 LLM 通用：没配百炼端点时，直接复用已配置好的大模型
  if (!cfg.workspaceId && !cfg.baseUrlOverride?.trim()) {
    const effective = llm ?? fallbackLlm;
    if (effective?.enabled && effective.baseUrl?.trim()) {
      return decideViaLlm(effective, state, questions, signal);
    }
    throw new Error('未填写 WorkspaceId（或自定义端点），且大模型未启用 —— 无法进行判断');
  }

  let res: Response;
  try {
    res = await fetch(decisionEndpoint(cfg), {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: 'decision-model-preview', state, questions }),
    });
  } catch (err) {
    throw new Error(
      `无法连接百炼决策端点（多为 CORS 拦截）。请改用本地代理：npm run proxy，` +
        `并在 proxy/.env 填 UPSTREAM_BASE_URL=https://${cfg.workspaceId}.${cfg.region}.maas.aliyuncs.com、` +
        `UPSTREAM_PATH_PREFIX=/compatible-mode。` +
        `原始错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 400)}`);
  }

  const json = await res.json();
  return {
    answers: json?.answers ?? {},
    requestId: json?.request_id,
    latencyMs: json?.latency_ms,
  };
}

export interface SentenceQuality {
  sentence: string;
  natural: number;
  inLevel: number;
  usesSense: number;
  pass: boolean;
  raw?: DecisionResult;
}

/**
 * 例句质量校验：决策模型的「结果校验」用法。
 * 低置信度的例句直接丢弃，避免把不通顺的句子喂给用户。
 */
export async function checkSentence(
  cfg: DecisionConfig,
  input: { lemma: string; level: string; sense: string; sentence: string },
  signal?: AbortSignal,
  llm?: LlmConfig,
): Promise<SentenceQuality> {
  const result = await decide(
    cfg,
    {
      word: input.lemma,
      target_level: input.level,
      target_sense: input.sense,
      sentence: input.sentence,
    },
    {
      natural: {
        type: 'noul',
        instructions: '这句话是否自然、地道，母语者会这样说？',
      },
      in_level: {
        type: 'noul',
        instructions: `这句话的难度是否控制在 ${input.level} 以内？`,
      },
      uses_sense: {
        type: 'noul',
        instructions: `是否使用了「${input.lemma}」的「${input.sense}」这个义项？`,
      },
    },
    signal,
    llm,
  );

  const natural = result.answers.natural?.noul ?? 0;
  const inLevel = result.answers.in_level?.noul ?? 0;
  const usesSense = result.answers.uses_sense?.noul ?? 0;

  return {
    sentence: input.sentence,
    natural,
    inLevel,
    usesSense,
    pass: natural >= cfg.naturalThreshold && usesSense >= 0.5,
    raw: result,
  };
}

export async function checkSentences(
  cfg: DecisionConfig,
  input: { lemma: string; level: string; sense: string; sentences: string[] },
  signal?: AbortSignal,
  llm?: LlmConfig,
): Promise<SentenceQuality[]> {
  return Promise.all(
    input.sentences.map((sentence) =>
      checkSentence(cfg, { ...input, sentence }, signal, llm).catch(() => ({
        sentence,
        natural: 1,
        inLevel: 1,
        usesSense: 1,
        pass: true,
      })),
    ),
  );
}
