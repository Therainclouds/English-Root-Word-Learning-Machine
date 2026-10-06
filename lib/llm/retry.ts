'use client';

/** 带可重试标记的错误：网络失败与 5xx / 429 可重试，其余 4xx 不重试 */
export class LlmError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryable(err: unknown) {
  return err instanceof LlmError ? err.retryable : false;
}

function mergeSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const list = signals.filter(Boolean) as AbortSignal[];
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];

  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(list);

  const ctrl = new AbortController();
  for (const s of list) s.addEventListener('abort', () => ctrl.abort(), { once: true });
  return ctrl.signal;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onAttempt?: (attempt: number) => void;
}

/** 指数退避重试：attempts 为总尝试次数（含首次） */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    opts.onAttempt?.(attempt);
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const canRetry = attempt < attempts && isRetryable(err) && !opts.signal?.aborted;
      if (!canRetry) break;
      await sleep(base * 2 ** (attempt - 1), opts.signal);
    }
  }
  throw lastError;
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** 统一发起请求：区分超时 / 取消 / CORS 网络失败 / HTTP 错误，并标记是否可重试 */
export async function requestWithTimeout(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = mergeSignals([timeoutSignal, options.signal]);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (timeoutSignal.aborted) {
      throw new LlmError(`请求超时（${timeoutMs}ms）`, undefined, true);
    }
    if (options.signal?.aborted) {
      throw new LlmError('请求已取消', undefined, false);
    }
    const origin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return url;
      }
    })();
    throw new LlmError(
      `无法连接 ${origin}。浏览器直连第三方接口通常被 CORS 拦截（Failed to fetch），` +
        `请改用本地代理：npm run proxy。原始错误：${err instanceof Error ? err.message : String(err)}`,
      undefined,
      true,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const retryable = res.status >= 500 || res.status === 429;
    throw new LlmError(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 400)}`, res.status, retryable);
  }

  return res;
}
