# 词根学习机：数据模型设计

> 依据 `docs/learning-science.md` 的方法论约束设计。
> 目标：让数据结构天然支持「频率优先、深度加工、语境例句、双向提取、SRS 排程、交错呈现、覆盖率可测量」。

---

## 1. 实体总览

```
Morpheme (词素：词根 / 前缀 / 后缀)
   │  composition
   ▼
Word (词族主条目 lemma) ── derivatives ──▶ Word
   │  senses                      ▲
   ▼                              │
Sense (义项) ── collocations      │ derivation_tree (parent/child)
   │                              │
   ▼                              │
Sentence (例句，含难度与生词率) ───┘
   ▲
   │
Card (SRS 卡片模板实例) ── ReviewState (排程状态)
   │
   ▼
UserProfile (已知词族 / 覆盖率 / 统计)
```

---

## 2. 字段定义

### 2.1 `morpheme` — 词根 / 前缀 / 后缀

| 字段 | 类型 | 说明 | 方法论依据 |
| --- | --- | --- | --- |
| `id` | string | 稳定标识，如 `root.spec`（拉丁 specere = to look） | — |
| `type` | enum | `root` / `prefix` / `suffix` / `combining_form` | — |
| `form` | string | 基本形式，如 `spect` | — |
| `allomorphs` | string[] | 异形形式，如 `spect / spic / spek / scope` | 深度加工：显式呈现变体 |
| `origin` | enum | `latin` / `greek` / `old_english` / `french` / `other` | 词源故事 |
| `etymon` | string | 原始词形，如 `specere` | 精细化加工 |
| `core_meaning` | string | 核心义（英文，简短），如 `to look / see` | 形式—意义联结 |
| `l1_gloss` | string | 中文对应，如 `看` | 仅作辅助，不作为唯一考点 |
| `semantic_field` | string[] | 语义场标签，如 `vision`, `cognition` | 语义网络 |
| `productivity` | int | 该词素在常用词表中的派生词数量 | 派生力排序 |
| `coverage_gain` | float | 学会该词素后新增的文本覆盖率（估算） | 覆盖率指标 |
| `frequency_rank` | int | 含该词素的最高频词的排名 | 频率优先 |
| `difficulty` | int(1–5) | 学习负担：形音匹配、透明度、语义复杂度 | learning burden |
| `mnemonic` | object | `{ story, image_url, cognate }` | 双重编码 / 精细化 |
| `confusing_with` | id[] | 易混词素，如 `spect` vs `scope` vs `spec` | 交错 + 对比 |
| `confidence` | float | 词源与释义的数据可信度 | 数据质量 |
| `sources` | string[] | Wiktionary / 词典 / 语料库出处 | 可追溯 |

### 2.2 `word` — 词族主条目

| 字段 | 类型 | 说明 | 方法论依据 |
| --- | --- | --- | --- |
| `id` | string | 如 `inspect` | — |
| `lemma` | string | 词元 | — |
| `family_id` | string | 词族 ID（Nation 词族口径：含屈折与规则派生） | 覆盖率计算单位 |
| `pos` | enum[] | `n / v / adj / adv` | 语法行为 |
| `ipa` | string | 音标（美 / 英） | 形音匹配 |
| `audio_url` | string | 发音音频 | 语音通道 |
| `freq_rank` | int | COCA / BNC 词族频率排名 | **频率优先** |
| `freq_band` | enum | `K1 / K2 / K3 / K4–5 / K6–9 / off-list` | 分频教学 |
| `cefr` | enum | `A1–C2` | 难度分层 |
| `register` | enum | `general / academic / formal / informal` | 语域 |
| `decomposition` | `{ morpheme_id, position, allomorph }[]` | 形态切分，如 `in + spect` | 形态意识 |
| `literal_glue` | string | 「字面义合成」，如 `to look into` | 深度加工的关键字段 |
| `definition_en` | string | 分级英文释义（1500 词内） | 减少母语中介 |
| `definition_l1` | string | 中文释义 | 辅助 |
| `collocations` | string[] | 高频搭配 | 使用维度 |
| `synonyms` / `antonyms` | id[] | 同义 / 反义 | 语义网络 |
| `derivatives` | id[] | 派生词（inspection, inspector…） | 词族网络 |
| `parent_id` | string? | 派生树父节点 | derivation tree |
| `learning_burden` | int(1–5) | 记忆负担评分 | 排程与预期 |
| `image_url` | string? | 图像（具体词） | 双重编码 |
| `sources` | string[] | 出处 | 可追溯 |

### 2.3 `sense` — 义项（一词多义必须建模）

| 字段 | 说明 |
| --- | --- |
| `id`, `word_id` | 归属 |
| `sense_order` | 义项序号（按语料频率排序，而非词典历史顺序） |
| `definition_en` / `definition_l1` | 分级释义 |
| `sense_freq_share` | 该义项在语料中的占比（决定先教哪个义） |
| `register` | 语域 |
| `examples` | 指向 `sentence.id[]` |

> 一词多义是词汇习得的主要难点；按**语料频率**而非词典顺序教学。

### 2.4 `sentence` — 例句（语境载体）

| 字段 | 类型 | 说明 | 方法论依据 |
| --- | --- | --- | --- |
| `id`, `text` | — | 句子原文 | — |
| `source` | string | COCA / 教材 / 自建 | — |
| `target_word` | string | 目标词（高亮） | 注意触发 |
| `target_sense_id` | string | 对应义项 | — |
| `cefr` | enum | 句子难度 | i+1 |
| `unknown_rate` | float | **生词率**，须 ∈ [0.02, 0.05] | 可理解输入阈值 |
| `known_ratio` | float | 已知词族占比（按用户动态计算） | 个性化 i+1 |
| `translation_l1` | string | 中文对照 | 辅助 |
| `audio_url` | string | 音频 | 语音通道 |
| `morph_tags` | — | 句中词素标注 | 形态意识 |
| `collocation_hit` | string[] | 句中命中的搭配 | 使用维度 |

> 生词率是硬性准入条件：> 5% 的句子不进入初级批次。

### 2.5 `card` — SRS 卡片（双向提取）

| 卡片模板 | 正面 | 背面 | 方向 |
| --- | --- | --- | --- |
| `morpheme_to_words` | 词根 `spect` + 核心义 | 列出派生词 | **产出方向** |
| `word_to_morpheme` | `inspect` | 切分 + 字面义合成 | 识别 / 分析 |
| `word_to_meaning` | `inspect`（句中） | 义项（L2 优先） | 接受性 |
| `meaning_to_word` | L2 释义 + 例句挖空 | 填出 `inspect` | **产出性** |
| `cloze` | 例句挖空 | 原词 | 语境提取 |
| `collocation` | 搭配提示 | 完整搭配 | 使用维度 |
| `confusion` | 两个易混词根 | 区分 | 交错对比 |

关键约束：
- **必须同时存在识别方向与产出方向**（能认 ≠ 能说）。
- 每张卡片绑定 `word_id` / `morpheme_id` / `sentence_id`，保证语境可回溯。

### 2.6 `review_state` — 排程状态

| 字段 | 说明 |
| --- | --- |
| `card_id`, `user_id` | 主键 |
| `due_at`, `interval_days`, `ease`, `lapses`, `reps` | SRS 状态（推荐 FSRS，或 SM-2 起步） |
| `last_interval_ratio` | 用于调参 |
| `direction` | 记录方向，产出方向单独排程（通常更密） |
| `interleave_group` | 交错组 ID（同一词根的词 → 分配到**不同**组） |

初始参数建议：
- 新卡间隔：`1d → 3d → 7d → 16d → 35d …`（可按目标保持期 10%–20% 缩放）
- 目标保持率：**0.9**（过高会导致复习债爆炸；0.85–0.9 更经济）
- 每日新词上限：默认 **10–20**（超出会产生不可持续的复习债）

### 2.7 `user_profile` — 用户模型（覆盖率是核心指标）

| 字段 | 说明 |
| --- | --- |
| `known_family_ids` | 已掌握词族（按 SRS 稳定度判定） |
| `coverage_estimate` | **在标准语料上的文本覆盖率**（核心指标） |
| `vocab_size_estimate` | 词族量估计 |
| `cefr_estimate` | 水平估计 |
| `morpheme_mastery` | 词素掌握度（用于派生推理） |
| `daily_new_limit`, `retention_target` | 个人参数 |
| `weak_directions` | 薄弱方向（产出 vs 识别） |

> 用**覆盖率**而非"学了几个词根"作为北极星指标。

---

## 3. 示例 JSON（最小可用）

```json
{
  "morpheme": {
    "id": "root.spect",
    "type": "root",
    "form": "spect",
    "allomorphs": ["spect", "spic", "scope"],
    "origin": "latin",
    "etymon": "specere",
    "core_meaning": "to look, see",
    "l1_gloss": "看",
    "semantic_field": ["vision", "cognition"],
    "productivity": 42,
    "coverage_gain": 0.0031,
    "frequency_rank": 1450,
    "difficulty": 2,
    "mnemonic": {
      "story": "spectacle（ spectacle ）= 用来『看』的东西 → 眼镜、景象",
      "cognate": "spy（同源，日耳曼语支）"
    },
    "confusing_with": ["root.scop", "root.vid"],
    "confidence": 0.92,
    "sources": ["wiktionary", "etymonline"]
  },
  "word": {
    "id": "inspect",
    "lemma": "inspect",
    "family_id": "fam.inspect",
    "pos": ["v"],
    "ipa": "/ɪnˈspekt/",
    "freq_rank": 3120,
    "freq_band": "K3",
    "cefr": "B1",
    "register": "general",
    "decomposition": [
      { "morpheme_id": "pfx.in", "position": "prefix", "allomorph": "in" },
      { "morpheme_id": "root.spect", "position": "root", "allomorph": "spect" }
    ],
    "literal_glue": "to look into",
    "definition_en": "to look at something carefully in order to check it",
    "definition_l1": "检查；审视",
    "collocations": ["inspect the building", "carefully inspect", "inspect goods"],
    "derivatives": ["inspection", "inspector"],
    "learning_burden": 2,
    "sources": ["coca", "wiktionary"]
  },
  "sentence": {
    "id": "s.10231",
    "text": "The engineer carefully inspected the bridge before reopening it.",
    "source": "coca",
    "target_word": "inspect",
    "target_sense_id": "inspect.s1",
    "cefr": "B1",
    "unknown_rate": 0.03,
    "translation_l1": "工程师在重新开放桥梁前仔细检查了它。",
    "morph_tags": ["in-", "spect", "-ed"],
    "collocation_hit": ["carefully inspect"]
  }
}
```

---

## 4. 数据来源与合规

| 数据 | 候选来源 | 注意 |
| --- | --- | --- |
| 词频 / 词族表 | Nation 的 BNC/COCA 词族表、COCA 词表 | 确认授权范围 |
| 词源 / 形态 | Wiktionary（CC BY-SA）、Etymonline | CC BY-SA 需署名与同协议 |
| 释义 / 搭配 | 分级词典、Oxford 3000/5000、COCA 搭配检索 | 商业词典需授权 |
| 例句 | COCA（受限）、自建、开放语料（OPUS / Tatoeba） | Tatoeba 为 CC 系 |
| CEFR 分级 | CEFRwordlists（EPFL） | 核对许可 |
| 音频 | Forvo（API）、自建 TTS | 商业条款 |

**建议**：自研数据全部落库并保留 `sources` 与 `confidence` 字段；第三方派生数据在构建期做 ETL，运行期不依赖外部 API。

---

## 5. 落地顺序（建议）

1. 建 `morpheme` + `word` 骨架，只覆盖 **K1–K5 高频词**中的可切分词（约 300–800 词根）。
2. 接 SRS（先 SM-2，后期换 FSRS）+ 双向卡片模板。
3. 补 `sentence`（生词率自动校验）+ 覆盖率计算。
4. 再做派生树可视化、易混对比、产出性练习。
5. 全程按覆盖率指标迭代，而非按内容量。
