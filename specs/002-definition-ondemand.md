# S-002 释义按需生成与缓存

状态：**done**（13/13 验收通过）　依赖：S-001（`definitionStatus` 字段）、S-005

## 背景 / 问题

S-001 导入的 3000 词族大多没有释义。不可能一次性生成（成本与耗时都不可控），
也不可能要求用户等。**做法：第一次遇到时生成，写回共享库，之后所有人复用。**

## 目标

1. 学习/词库页遇到 `definitionStatus = 'pending'` 的词，提供"生成释义"入口
2. 生成结果写入 `elm-shared.words` + 匹配的 `cards.back`，**所有用户共享**
3. 生成失败不阻塞学习：降级为占位文案 + 可重试

## 关键约束

- 写回**共享库**，不是用户库 —— 一个人生成，所有人受益
- 写回只允许改 `definitionEn / definitionL1 / collocations / definitionStatus`，
  **不得**改动 `id / familyId / freqRank`
- 必须带上 stub 锁：同一词并发请求只发一次 LLM（用 `Map<wordId, Promise>` 去重）

## 实现要点

1. `lib/definitions.ts`
   - `ensureDefinition(wordId): Promise<Word>` —— 命中则直接返回，未命中则调用 LLM、校验、写回
   - 校验：`definitionEn` 非空且长度 ≤ 200；否则视为失败
   - 失败时把 `definitionStatus` 保持 `pending`，并返回原对象
2. 写回卡片：`cards` 中 `wordId` 匹配的卡，更新其 `back`（识别方向用新释义）
3. 学习页：`pending` 时 `card.back` 显示占位 + 一个「生成释义」按钮
4. 词库页：同样入口

## 验收标准

1. 对 `pending` 词点生成后，`elm-shared.words` 中该词 `definitionStatus = 'ready'`
2. 刷新页面（或切换用户）后释义仍在（缓存生效）
3. 同一词连点两次只产生 1 次请求（stub 去重）
4. LLM 未启用 / 调用失败时，界面显示占位文案与可重试提示，学习流程不中断
5. `tsc --noEmit` / `next build` 通过，控制台零错误

## 风险

- 生成质量参差 → 由 S-004（决策模型校验）兜底
- 成本：按需生成意味着不可预算；记录 `usage` 供后续统计（已由 S-005 落地）

## 验证记录

验收脚本：`scripts/verify-s002.mjs`（真实浏览器 + 本地 mock 端点，`scripts/mock-llm.mjs` 的 `/word/*` 模式）

结果：**13/13 通过**

| 验收标准 | 实测 |
| --- | --- |
| AC-1 pending 词显示生成入口 | 选中 `ability`（K2）→ 出现生成按钮 |
| AC-1 写回共享库 | `status: pending → ready`，`definitionEn` 已写入 |
| AC-1 卡片背面同步 | `cards["w.ability:rec"].back` 与释义一致 |
| AC-1 只请求 1 次 | mock 收到 1 次请求 |
| AC-2 缓存生效 | 刷新后释义仍在；pending 数 2998 → 2997 |
| 幂等 | 已 ready 的词不再显示生成入口 |
| AC-4 未启用降级 | 显示"需先在设置页启用大模型"，无按钮，不报错 |
| 用量记录 | `llmLogs` 写入 1 条 |

### 实现中发现并修复的缺陷

1. **成功提示不可见**：生成成功后 pending 面板整体卸载，连带成功文案一起消失，
   用户得不到任何确认。已把提示移到条件块之外（`app/library/page.tsx`）。
2. **旧数据释义被清空（S-001 遗留，已修）**：v3 之前的词没有 `definitionStatus` 字段，
   导入器判定"未就绪"→ 覆盖 `definitionEn` 为空。共 90 个种子词释义被清空。
   - 修复：`lib/db.ts` 的 `normalizeWord` 在两处迁移中归一化；`lib/data/importer.ts`
     对"无字段但有英文释义"的词视为已就绪
   - 回归测试：`scripts/verify-legacy-word.mjs`（6/6 通过）
   - 数据修复：设置页「修复种子词释义」按钮（非破坏性），实测 ready 7 → 97

### 补充

- 设置页新增「批量补全释义」（计数输入 + 串行执行 + 进度回显），复用 `ensureDefinitions`
