'use client';

import type { LlmConfig } from '../types';
import { LlmError, requestWithTimeout, withRetry, DEFAULT_TIMEOUT_MS } from './retry';
import { cacheGet, cacheKey, cacheSet } from './cache';
import { recordLlmCall } from './telemetry';

/**
 * 可插拔大模型适配器（S-005：超时 / 重试 / 缓存 / 用量埋点）
 *
 * 浏览器直连说明：
 * - 只有 api.anthropic.com 认 anthropic-dangerous-direct-browser-access 头
 * - 第三方 Anthropic 兼容端点（MiniMax 等）几乎都会因 CORS 被浏览器拦截
 *   → 请改用本地代理：npm run proxy
 * - 鉴权头：官方 Anthropic 用 x-api-key，多数国内兼容端点用 Authorization: Bearer
 * - 推理模型会先输出 thinking，响应结构不同（见 extractProviderText）
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  chat(messages: LlmMessage[], signal?: AbortSignal): Promise<string>;
}

const MAX_TOKENS = 4096;
const ATTEMPTS = 3;
/**
 * 单次调用的**总**时间预算。
 * 之前 30s 超时 × 3 次尝试 + 退避 ≈ 93s，端点不通时界面像卡死；
 * 现在整次调用最多 25s，且剩余预算不足以再试一次就直接报错，让用户能马上排查。
 */
const TOTAL_BUDGET_MS = 25_000;
/** 剩余预算低于此值就不再重试，直接把错误交给用户 */
const MIN_ATTEMPT_MS = 8_000;

function extractSystem(messages: LlmMessage[]) {
  return messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
}

function toRest(messages: LlmMessage[]) {
  return messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
}

/**
 * 跨厂商提取文本。兼容：
 * - Anthropic 官方 / MiniMax 兼容：content 为块数组（text / thinking）
 * - OpenAI 兼容：choices[0].message.content（字符串或块数组），推理模型有 reasoning_content
 * - Ollama：message.content
 */
function extractProviderText(json: unknown, stopReason?: string): string {
  const j = json as Record<string, unknown> | null;
  if (!j) return '';

  if (Array.isArray(j.content)) {
    const blocks = j.content as Array<Record<string, unknown>>;
    const text = blocks
      .filter((b) => b?.type === 'text' || typeof b?.text === 'string')
      .map((b) => String(b.text ?? ''))
      .join('')
      .trim();
    if (text) return text;

    const thinking = blocks.map((b) => String(b.thinking ?? '')).join('').trim();
    if (thinking) {
      throw new LlmError(
        `模型只输出了思考内容、没有正文（stop_reason=${stopReason ?? '未知'}）。` +
          `推理模型（如 MiniMax-M2）可能耗尽了输出预算，请换用高速版模型或增大 max_tokens。`,
        undefined,
        false,
      );
    }
    return '';
  }

  if (Array.isArray(j.choices) && j.choices.length > 0) {
    const msg = (j.choices[0] as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
    if (!msg) return '';
    if (typeof msg.content === 'string' && msg.content.trim()) return msg.content;
    if (Array.isArray(msg.content)) {
      const text = (msg.content as Array<Record<string, unknown>>)
        .map((b) => String(b?.text ?? ''))
        .join('')
        .trim();
      if (text) return text;
    }
    const reasoning = msg.reasoning_content ?? msg.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      throw new LlmError(
        '模型只返回了思考内容（reasoning_content）、没有正文。请换用非推理模型或增大 max_tokens。',
        undefined,
        false,
      );
    }
    return '';
  }

  if (typeof j.content === 'string') return j.content;
  return '';
}

interface Transport {
  url: string;
  init: RequestInit;
  extract: (json: unknown) => string;
}

function buildAnthropic(cfg: LlmConfig, messages: LlmMessage[]): Transport {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const useBearer = (cfg.authHeader ?? 'bearer') === 'bearer';
  // Anthropic 专有头只有官方放行；第三方兼容端点的 CORS 允许头列表里没有它们
  const isOfficial = (() => {
    try {
      return /anthropic\.com$/i.test(new URL(base).host);
    } catch {
      return false;
    }
  })();

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (isOfficial) {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  if (useBearer) headers.authorization = `Bearer ${cfg.apiKey}`;
  else headers['x-api-key'] = cfg.apiKey;

  return {
    url: `${base}/v1/messages`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: MAX_TOKENS,
        temperature: cfg.temperature,
        system: extractSystem(messages) || undefined,
        messages: toRest(messages),
      }),
    },
    extract: (json) => {
      const text = extractProviderText(json, (json as { stop_reason?: string })?.stop_reason);
      return requireText(text, '端点', json);
    },
  };
}

function buildOpenAICompatible(cfg: LlmConfig, messages: LlmMessage[]): Transport {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
    },
    extract: (json) => {
      const text = extractProviderText(json);
      return requireText(text, 'OpenAI 兼容接口', json);
    },
  };
}

function buildOllama(cfg: LlmConfig, messages: LlmMessage[]): Transport {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    url: `${base}/api/chat`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { temperature: cfg.temperature },
      }),
    },
    extract: (json) => {
      const j = json as { message?: { content?: unknown } } | null;
      const text = typeof j?.message?.content === 'string' ? j.message.content : '';
      return requireText(text, 'Ollama', json);
    },
  };
}

/** 空内容一律视为失败（不重试），并带上原始响应便于定位 */
function requireText(text: string, vendor: string, raw: unknown) {
  if (!text.trim()) {
    throw new LlmError(
      `${vendor} 返回了空内容。可能是推理模型耗尽了输出预算，或模型名不正确。` +
        `原始响应：${JSON.stringify(raw).slice(0, 300)}`,
      undefined,
      false,
    );
  }
  return text;
}

export function createProvider(cfg: LlmConfig, timeoutMs = DEFAULT_TIMEOUT_MS): LlmProvider {
  const build =
    cfg.provider === 'anthropic'
      ? buildAnthropic
      : cfg.provider === 'ollama'
        ? buildOllama
        : buildOpenAICompatible;

  return {
    async chat(messages, signal) {
      const key = cacheKey(cfg.provider, cfg.model, cfg.baseUrl, JSON.stringify(messages));
      const cached = cacheGet(key);
      if (cached !== undefined) {
        recordLlmCall({
          provider: cfg.provider,
          model: cfg.model,
          durationMs: 0,
          ok: true,
          cached: true,
        });
        return cached;
      }

      const startedAt = Date.now();
      let attempts = 0;
      try {
        const text = await withRetry(
          async (attempt) => {
            const left = TOTAL_BUDGET_MS - (Date.now() - startedAt);
            if (attempt > 1 && left < MIN_ATTEMPT_MS) {
              throw new LlmError(
                `大模型响应太慢：已用满 ${Math.round(TOTAL_BUDGET_MS / 1000)}s 预算仍无结果。` +
                  `请到设置页点「测试连通」检查端点与密钥，或换用更快的模型 / 本地代理。`,
                undefined,
                false,
              );
            }
            const transport = build(cfg, messages);
            const res = await requestWithTimeout(transport.url, transport.init, {
              timeoutMs: Math.max(1_000, Math.min(timeoutMs, left)),
              signal,
            });
            const json = await res.json();
            return transport.extract(json);
          },
          { attempts: ATTEMPTS, signal, onAttempt: (n) => { attempts = n; } },
        );

        cacheSet(key, text);
        recordLlmCall({
          provider: cfg.provider,
          model: cfg.model,
          durationMs: Date.now() - startedAt,
          ok: true,
          cached: false,
          attempts,
        });
        return text;
      } catch (err) {
        recordLlmCall({
          provider: cfg.provider,
          model: cfg.model,
          durationMs: Date.now() - startedAt,
          ok: false,
          cached: false,
          attempts,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        throw err;
      }
    },
  };
}

export interface WordExplanation {
  definitionEn: string;
  definitionL1: string;
  senses: { order: number; definitionEn: string; definitionL1: string; example: string }[];
  collocations: string[];
  confusions: string[];
  mnemonic?: string;
}

const EXPLAIN_SYSTEM = `You are an English vocabulary coach for a Chinese-speaking learner.
Rules:
- Explain using only the most common 1500 English words.
- Output the JSON object directly. No prose, no markdown fences, no <think> tags.
- JSON shape:
{"definitionEn":string,"definitionL1":string,"senses":[{"order":number,"definitionEn":string,"definitionL1":string,"example":string}],"collocations":[string],"confusions":[string],"mnemonic":string}`;

/** 从 LLM 输出中稳健提取 JSON：剥离思考标签 / 代码围栏 / 前后杂文 */
export function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`返回内容不是 JSON：${cleaned.slice(0, 200) || '（空）'}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

export async function explainWord(
  cfg: LlmConfig,
  lemma: string,
  context?: string,
  signal?: AbortSignal,
): Promise<WordExplanation> {
  const provider = createProvider(cfg);
  const user = context
    ? `Word: "${lemma}"\nContext sentence: "${context}"\nExplain this word as used in the context.`
    : `Word: "${lemma}"\nExplain this word for daily English use.`;
  const raw = await provider.chat(
    [
      { role: 'system', content: EXPLAIN_SYSTEM },
      { role: 'user', content: user },
    ],
    signal,
  );
  return parseJsonLoose<WordExplanation>(raw);
}

export async function generateExamples(
  cfg: LlmConfig,
  lemma: string,
  count = 3,
  signal?: AbortSignal,
): Promise<string[]> {
  const provider = createProvider(cfg);
  const raw = await provider.chat(
    [
      {
        role: 'system',
        content:
          'You write short, natural English example sentences (A2-B1) for vocabulary learning. Output the JSON object directly, no fences: {"sentences":[string]}',
      },
      {
        role: 'user',
        content: `Word: "${lemma}". Write ${count} different short sentences using it in clearly different everyday situations.`,
      },
    ],
    signal,
  );
  const parsed = parseJsonLoose<{ sentences: string[] }>(raw);
  return parsed.sentences ?? [];
}
