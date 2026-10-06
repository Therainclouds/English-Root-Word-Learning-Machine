# S-005 LLM 调用健壮性

状态：**done**（16/16 验收通过）　依赖：—

## 背景 / 问题

已实际踩到的坑（均已在代码中修过一部分，本 spec 把它们系统化并补齐）：

| 已发生的问题 | 现状 |
| --- | --- |
| 第三方端点 CORS 被拦 | 已：仅对 `anthropic.com` 发专有头；提供本地代理 |
| 鉴权头不一致（x-api-key vs Bearer） | 已：`authHeader` 可切换 |
| 推理模型只输出 thinking、正文为空 | 已：`max_tokens` 提到 4096 + 明确报错 |
| 返回带 markdown 围栏 / `<think>` 标签 | 已：剥离后再提取 JSON |
| 错误信息无信息量（"返回内容不是 JSON："） | 已：带原始响应片段 |

**仍未做**：超时、重试、并发去重、结果缓存、用量统计。

## 目标

1. 所有 LLM 调用有**超时**（默认 30s）与**可取消**（AbortSignal）
2. 失败**重试 2 次**，指数退避（500ms / 1500ms），仅对网络与 5xx 重试；4xx 不重试
3. 相同输入的结果**缓存**（内存 LRU，上限 200 条），避免重复烧钱
4. **用量统计**：记录每次调用的 provider / model / 耗时 / 成功失败，落用户库
5. 设置页显示"最近调用"列表与失败原因

## 实现要点

1. `lib/llm/retry.ts`：`withRetry(fn, {attempts, signal})`
2. `createProvider` 内部统一包一层 `withRetry`
3. 缓存 key：`${provider}:${model}:${JSON.stringify(messages)}`（哈希后存储）
4. 统计写入用户库新表 `llmLogs`（**每人独立**，便于排查"只有我这儿不通"）
5. 表结构变更需 `USER_DB` 版本号 +1（教训见 S-001 的 `learning` 表）

## 验收标准

1. 断网时 30s 内返回可读错误，且不卡住界面
2. 模拟 500 错误：请求 3 次后放弃（1 次原始 + 2 次重试）
3. 模拟 401：只请求 1 次，不重试
4. 同一词连续解析两次，只产生 1 次真实请求（命中缓存）
5. 设置页"最近调用"能看到记录，含失败原因
6. `tsc --noEmit` / `next build` 通过，控制台零错误

## 实现

| 文件 | 职责 |
| --- | --- |
| `lib/llm/retry.ts` | `LlmError`（带 `retryable`）、超时与信号合并、指数退避重试 |
| `lib/llm/cache.ts` | 200 条内存 LRU，key = provider + model + baseUrl + messages |
| `lib/llm/telemetry.ts` | 记录到当前用户的 `llmLogs`（未登录静默丢弃） |
| `lib/llm/index.ts` | Transport 抽象：三种协议只描述「URL/请求体/取文本」，重试与缓存统一处理 |

重试判定：网络失败、5xx、429 → 可重试；其余 4xx、空内容、超时（超时视为网络类，可重试）→ 见实现。
退避为 500ms / 1000ms（`base × 2^(n-1)`）。

## 验证记录

验收脚本：`scripts/verify-s005.mjs` + `scripts/mock-llm.mjs`（`/ok` `/fail` `/auth` `/empty` 四种模式）

结果：**16/16 通过**

| 验收标准 | 实测 |
| --- | --- |
| 成功调用 | 返回 `OK`，mock 收到 1 次 |
| AC-4 缓存命中 | 第二次调用内容一致，mock 仍只有 1 次请求；记录 `cached: true, durationMs: 0` |
| AC-2 5xx 重试 | 提示 `HTTP 500 …`；mock 收到 **3** 次；记录 `attempts: 3` |
| AC-3 4xx 不重试 | 提示 `HTTP 401 …`；mock 收到 **1** 次；记录 `attempts: 1` |
| 空内容 | 报错含原始响应；不重试（1 次） |
| AC-5 用量记录 | `llmLogs` 5 条，字段齐全（provider/model/durationMs/ok/cached/attempts/error） |
| 控制台 | 无意外错误 |

### 测试脚本自身的两次假失败（已修，记录备查）

1. 用"结果文本变化"判断第二次调用完成 —— 两次内容相同导致误判超时。
   缓存实际生效（已由 mock 请求数与日志双重证实）。
2. 断言 `llmLogs.length === 5`，但浏览器 profile 复用导致历史记录累积，
   前几条断言读到了上一轮的旧数据 → 已在测试开始时清空 `llmLogs`。
