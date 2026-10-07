# S-004 学习负担评分（决策模型）

状态：planned　依赖：D5、决策模型配置

## 背景 / 问题

`lib/data/seed.ts` 里用 `lemma.length > 8 ? 3 : 2` 估算学习负担 —— 极其粗糙。
学习负担直接进入"这个词要多久才该复习"的判断链，用长度代替它是明显的失真。

科学依据：`learning burden`（Nation）取决于形音匹配、拼写透明度、形态规则性、
语义复杂度、搭配、与母语距离 —— 这些**都是可判断的输入**，正好是决策模型 `score` 的用途。

## 目标

1. 用决策模型给出 `learningBurden`（1–5，有序量表），替代长度启发式
2. 结果写回共享库，**所有人复用**
3. 决策模型不可用时**回退**到现有启发式（不得阻塞）

## 输入的 `questions`

```jsonc
{
  "burden": {
    "type": "score",
    "instructions": "对一个以中文为母语的学习者，记住这个英文词有多难？",
    "criteria": [
      "很容易：形音一致、拼写透明、中文有直接对应",
      "较容易：稍有拼写或发音不规则",
      "中等：多义或搭配受限",
      "较难：拼写与发音严重不对应，或抽象义为主",
      "很难：形近词多、语域受限、母语无对应概念"
    ]
  },
  "confusable": { "type": "noul", "instructions": "这个词是否有常见形近词容易混淆？" }
}
```

`state` 传：`word / pos / ipa / 频段 / 中文提示（若有）`。

## 实现要点

1. `lib/definitions.ts` 同级新增 `lib/burden.ts`：`scoreBurden(wordId)`
2. 批量接口：一次请求带多个词（`questions` ≤ 16，官方建议），降低延迟
3. `score` 返回的是概率加权期望（可落在两级之间，如 `2.35`）→ `Math.round` 后 clamp 到 [1,5]
4. `confidence < 0.5` 时忽略结果，保留启发式值
5. 写回 `elm-shared.wordFamilies.learningBurden`

## 与排程的关系（重要）

本 spec **只产出评分，不改排程**。负担评分如何进入间隔计算属于 D4 范围，需要单独论证：
初步设想是影响**首次间隔与 ease 初值**，但必须先有数据支撑，不在本 spec 内实现。

## 验收标准

1. 对 10 个词评分后，`wordFamilies.learningBurden` 落在 [1,5] 且非全部同值
2. 决策模型关闭或失败时，值回退为启发式结果，学习流程不中断
3. 评分结果写回共享库，切换用户后仍存在
4. 一次请求覆盖 ≤16 个词，记录 `latency_ms` 与 `input_tokens`
5. `tsc --noEmit` / `next build` 通过，控制台零错误
