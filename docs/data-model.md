# 数据模型（整体）

> 配套：`docs/product-plan.md`（产品）· `docs/learning-science.md`（方法论）
> 阶段 3 的词根模块结构见 `docs/root-data-schema.md`。

---

## 1. 实体总览

```
WordFamily (词族，学习/统计的基本单位)
   └─ Word (lemma) ── Sense (义项，按语料频率排序)
                    ── Chunk (语块 / formulaic sequence)

Passage (分级读物) ── Sentence (句子，带生词率)

Card (SRS 卡片，双向) ── ReviewState (排程)

PathNode (路径节点) ── PathEdge (前置依赖)

Morpheme (词根/词缀，阶段 3)  ← 详见 root-data-schema.md

UserProfile / Settings / ReviewLog
```

---

## 2. 字段定义

### 2.1 `WordFamily` — 词族（覆盖率与学习的基本单位）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 如 `fam.inspect` |
| `headword` | string | 代表词 |
| `members` | string[] | 词族成员（屈折 + 规则派生） |
| `freq_rank` | int | COCA/BNC 词族频率排名 |
| `freq_band` | enum | `K1 / K2 / K3 / K4-5 / K6-9 / off` |
| `cefr` | enum | `A1–C2` |
| `stage` | int | 所属阶段（1/2/3） |
| `pos` | enum[] | 词性 |
| `ipa` | string | 音标 |
| `audio_url` | string? | 发音 |
| `learning_burden` | int(1–5) | 记忆负担 |
| `register` | enum | `general / academic / formal / informal` |
| `sources` | string[] | 出处 |

### 2.2 `Word` — 词条

| 字段 | 说明 |
| --- | --- |
| `id`, `lemma`, `family_id` | 归属词族 |
| `pos`, `ipa`, `audio_url` | 形式 |
| `definition_en` | **分级英文释义**（限制在 1500 词内） |
| `definition_l1` | 中文释义（辅助，不作唯一考点） |
| `collocations` | 高频搭配 |
| `synonyms` / `antonyms` | 语义网络 |
| `morpheme_ids` | 形态切分（阶段 3 启用） |
| `image_url` | 双重编码（具体词） |
| `cefr`, `register`, `sources` | 难度与溯源 |

### 2.3 `Sense` — 义项

| 字段 | 说明 |
| --- | --- |
| `id`, `word_id`, `sense_order` | 按**语料频率**排序，非词典历史顺序 |
| `definition_en` / `definition_l1` | 分级释义 |
| `sense_freq_share` | 该义项占比，决定教学优先级 |
| `register` | 语域 |
| `example_sentence_ids` | 例句 |

> 一词多义是主要难点；必须先教高频义项。

### 2.4 `Chunk` — 语块（formulaic sequence，交流流利度的关键）

| 字段 | 说明 |
| --- | --- |
| `id`, `text` | 如 `make sense`, `kind of`, `I was wondering if…` |
| `type` | `phrasal_verb / collocation / sentence_frame / discourse_marker` |
| `freq_rank`, `cefr`, `register` | 优先级 |
| `function` | 语用功能（requesting / hedging / agreeing…） |
| `scene_ids` | 关联场景节点 |
| `examples` | 例句 |

> 阶段 2 的核心。**语块整存整取**是实时交流可行的前提。

### 2.5 `Passage` / `Sentence` — 分级读物

**Passage**

| 字段 | 说明 |
| --- | --- |
| `id`, `title`, `text`, `source` | 内容 |
| `cefr`, `topic` | 难度与主题（窄读用） |
| `token_count` | 词元数 |
| `audio_url` | 音频 |
| `comprehension_questions` | 理解题 |

**Sentence**

| 字段 | 说明 |
| --- | --- |
| `id`, `passage_id`, `text` | 句子 |
| `unknown_rate` | **生词率**，准入区间 `[0.02, 0.05]` |
| `target_word_ids` | 目标词（高亮/可加学） |
| `translation_l1` | 对照 |
| `audio_url` | 音频 |

### 2.6 `Card` / `ReviewState` — SRS

**Card 模板**

| 模板 | 正面 | 背面 | 方向 |
| --- | --- | --- | --- |
| `word_to_meaning` | 词（句中） | 分级英文释义 | 识别 |
| `meaning_to_word` | 英文释义 + 挖空句 | 填出原词 | **产出** |
| `cloze` | 例句挖空 | 原词 | 语境提取 |
| `collocation` | 搭配提示 | 完整搭配 | 使用 |
| `chunk_recall` | 语用功能提示 | 语块 | 产出（阶段 2） |
| `confusion` | 两个易混词 | 区分 | 交错对比 |

**约束**
- 每张词卡必须同时生成**识别 + 产出**两个方向，各自独立排程（产出方向间隔通常更密）。
- 卡片绑定 `sentence_id`，保证语境可回溯。

**ReviewState**

| 字段 | 说明 |
| --- | --- |
| `card_id` | 主键 |
| `due_at`, `interval_days`, `ease`, `lapses`, `reps` | SM-2 状态 |
| `direction` | `receptive` / `productive` |
| `interleave_group` | 交错组：同词族/同语义场的卡分到**不同**组 |
| `stability` | 掌握度（供路径解锁判定） |

**默认参数**：新卡间隔 `1d → 3d → 7d → 16d → 35d…`；目标保持率 `0.9`；每日新词上限 `10–20`。

### 2.7 `PathNode` / `PathEdge` — 可视化路径

**PathNode**

| 字段 | 说明 |
| --- | --- |
| `id`, `title`, `stage` | 单元（如 "K1 核心 500 词"、"餐厅点餐"） |
| `type` | `vocab_band / grammar / chunk_set / scene / reading_set / morpheme_set` |
| `x`, `y` | **Canvas 布局坐标** |
| `prereq_ids` | 前置节点 |
| `target_ids` | 包含的词族/语块/读物 |
| `mastery_rule` | 解锁规则，如 `{ min_retention: 0.9, min_reps: 3 }` |
| `estimated_minutes` | 预计耗时 |

**PathEdge**：`{ from, to, kind: 'prereq' | 'recommended' }`

**节点状态机**（由 SRS 稳定度驱动）：

```
locked ──(前置达成)──▶ available ──(开始学)──▶ learning
learning ──(到期卡>0)──▶ due ──(复习)──▶ learning
learning ──(mastery_rule 达成)──▶ mastered ──(解锁后继)──▶ ...
```

### 2.8 `Morpheme` — 词根/词缀（阶段 3）

字段见 `docs/root-data-schema.md`：`form / allomorphs / etymon / core_meaning / productivity / coverage_gain / confusing_with / mnemonic …`

### 2.9 `UserProfile` / `Settings`

**UserProfile**

| 字段 | 说明 |
| --- | --- |
| `known_family_ids` | 已掌握词族（由 stability 判定） |
| `coverage_estimate` | **北极星指标**：标准语料上的文本覆盖率 |
| `vocab_size_estimate` | 词族量估计 |
| `cefr_estimate` | 水平估计 |
| `daily_streak`, `heatmap` | 学习热力图 |
| `review_debt` | 待复习数量 |

**Settings**

| 字段 | 说明 |
| --- | --- |
| `llm` | `{ provider, base_url, api_key, model, temperature }` |
| `daily_new_limit` | 每日新词上限 |
| `retention_target` | 目标保持率 |
| `definition_lang` | 释义语言偏好 |
| `show_l1` | 是否显示中文 |

---

## 3. IndexedDB 表结构（`lib/db.ts`）

| store | keyPath | 索引 |
| --- | --- | --- |
| `wordFamilies` | `id` | `freq_rank`, `freq_band`, `stage` |
| `words` | `id` | `family_id`, `cefr` |
| `senses` | `id` | `word_id` |
| `chunks` | `id` | `freq_rank`, `type` |
| `passages` | `id` | `cefr`, `topic` |
| `sentences` | `id` | `passage_id` |
| `cards` | `id` | `family_id`, `direction` |
| `reviewStates` | `card_id` | `due_at`, `interleave_group` |
| `pathNodes` | `id` | `stage` |
| `reviewLogs` | `++seq` | `reviewed_at` |
| `settings` | `key` | — |
| `profile` | `key` | — |
| `morphemes` | `id` | `type`, `productivity` |

---

## 4. 覆盖率计算（`lib/coverage.ts`）

```
coverage = Σ(已知词族在标准语料中的出现频次) / 语料总词元数
```

- 以**词族**为统计单位（Nation 口径）
- 判定"已知"：`ReviewState.stability ≥ threshold` 且产出方向至少完成 N 次
- 输出：覆盖率、词汇量估计、分频段掌握分布（K1/K2/K3…各掌握多少）
