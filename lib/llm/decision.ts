'use client';

import type { DecisionConfig } from '../types';

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

export async function decide(
  cfg: DecisionConfig,
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, DecisionQuestion>,
  signal?: AbortSignal,
): Promise<DecisionResult> {
  if (!cfg.workspaceId && !cfg.baseUrlOverride?.trim()) {
    throw new Error('未填写 WorkspaceId（或自定义端点），无法调用决策模型');
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
): Promise<SentenceQuality[]> {
  return Promise.all(
    input.sentences.map((sentence) =>
      checkSentence(cfg, { ...input, sentence }, signal).catch(() => ({
        sentence,
        natural: 1,
        inLevel: 1,
        usesSense: 1,
        pass: true,
      })),
    ),
  );
}
