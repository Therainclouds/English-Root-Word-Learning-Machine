# S-007 词根词缀模块（阶段 3 选修）

状态：**planned**　依赖：D1 D2 D4 D6 D8 D10 D11、S-001、S-005

数据模型依据：`docs/root-data-schema.md`　方法论依据：`docs/learning-science.md`

## 背景 / 问题

阶段 1（S-001~S-003）已经把"高频词族 + 分级阅读 + SRS"跑通，但词库里每个词都是**孤立条目**：
`inspect / respect / spectacle / suspect` 之间没有联系，学习者只能靠重复记忆，无法做派生推理。

`docs/root-data-schema.md` 已经定义了 `morpheme` 实体与 7 种卡片模板，但代码里**一个字段都还没落地**
（`lib/types.ts` 无 `Morpheme`，`lib/db.ts` 无对应表，`CardTemplate` 只有 5 种且都绑定 word）。

参照系：开源项目 `hyusap/deconstructor` 的做法是"每次查询实时调 LLM 拆词"。
本 spec **明确不采用该做法**——理由见 D10。

## 目标

1. 共享词库落地 `morphemes` 表 + 种子词根库（K1–K5 可切分词，首期 60 个高频词素）
2. 词与词素建立**离线**关联：`word.decomposition` + `literalGlue`（字面义合成）
3. 新增两类卡片模板：`word_to_morpheme`（识别/分析方向）、`morpheme_to_words`（产出方向）
4. 词根内容挂在**阶段 3 独立路径节点**，不与阶段 1 主路径争额度（D8 / D11）

## 非目标

- 不做分层 DAG / 派生树**可视化**（后续 spec；布局可参考 deconstructor 的三类节点，但数据层先行）
- 不在运行期调用外部 API 拉取词源（root-data-schema §4：运行期不依赖外部 API）
- 不生成长篇词源故事、不引入音频/图像（双重编码留到后续）
- 不改动阶段 1 的路径节点、覆盖率算法与每日新词逻辑

## 两条已落定的决策（本 spec 新增）

| 编号 | 决策 | 理由 / 边界 |
| --- | --- | --- |
| D10 | 形态切分**离线落库**（种子常量 + 构建期 ETL），运行期不调 LLM 做拆解；LLM 只补 `mnemonic` / `literalGlue`，结果写回共享库复用 | 同一词素在不同词里必须一致（`spect` 在 inspect / respect / spectacle 中不能给出两种解释）；且运行期每词一调用在成本与延迟上不可接受 |
| D11 | 词根卡片走**阶段 3 独立路径节点 + 独立每日预算**，不占用阶段 1 的 `dailyNewLimit` | 避免词根卡挤兑高频词复习，防止复习债爆炸（D9） |

## 实现要点

1. **id 必须稳定可推导**（D6）：
   - 词素 `m.<type>.<form>`，如 `m.root.spect`、`m.pfx.in`、`m.sfx.tion`
   - 识别卡 `w.<lemma>:morph`、产出卡 `m.<type>.<form>:prod`
   - 已存在的卡片按 id 幂等覆盖，不重建
2. **切分走确定性规则**（D4）：`lib/data/morph-segment.ts` 用词素 `allomorphs`（含异形 `spect/spic/scope`、`im-/ir-/il-` 等同化变体）做**贪心最长匹配**，前缀 → 词根 → 后缀顺序切分
   - 拼接结果 ≠ lemma → 标记 `morphStatus = 'unsegmented'`，**不生成**词根卡（宁缺勿错）
   - `confidence` 低于阈值（默认 0.7）的词素不参与自动切分
3. **只写共享库**：morphemes / words / cards / pathNodes 全在 `elm-shared`（D2），不触碰任何 `elm-<userId>`
4. **LLM 只补内容**：走 `lib/llm` 现有 transport（自动获得 S-005 的超时 / 重试 / 缓存 / 用量统计），生成后写回共享库；第二次访问不再请求
5. **交错**：同一词素的派生词卡片分到**不同** `interleaveGroup`（root-data-schema §2.6），避免同族词扎堆
6. **路径节点**：`PathNodeType` 已有 `'morpheme_set'`，新增 `s3-morph-core`（高频词根）/ `s3-morph-expand`（次高频），按 `productivity` 降序挂载词素 id

## 数据模型变更

### 新增实体 `Morpheme`（共享库表 `morphemes`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | `m.<type>.<form>` |
| `type` | `'root' \| 'prefix' \| 'suffix' \| 'combining_form'` | — |
| `form` | string | 基本形式，如 `spect` |
| `allomorphs` | string[] | 异形，如 `spect / spic / spek / scope` |
| `origin` | `'latin' \| 'greek' \| 'old_english' \| 'french' \| 'other'` | — |
| `etymon` | string | 原始词形，如 `specere` |
| `coreMeaning` | string | 英文核心义，如 `to look, see` |
| `l1Gloss` | string | 中文对应，如 `看`（D7：不作唯一考点） |
| `semanticField` | string[] | 语义场标签 |
| `productivity` | number | 常用词表中的派生词数量（排序依据） |
| `coverageGain` | number | 掌握后新增覆盖率（估算） |
| `difficulty` | number(1–5) | 学习负担 |
| `mnemonic` | `{ story?, cognate? }?` | LLM 可选补齐 |
| `confusingWith` | string[] | 易混词素 id |
| `confidence` | number(0–1) | 数据可信度，< 0.7 不参与自动切分 |
| `sources` | string[] | 出处，可追溯 |

### `Word` 新增字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `decomposition` | `{ morphemeId, position, allomorph }[]` | 形态切分，如 `in + spect` |
| `literalGlue` | string | 字面义合成，如 `to look into` |
| `morphStatus` | `'segmented' \| 'unsegmented' \| 'pending'` | 未切分的词不生成词根卡 |

### `Card` 变更

- `CardTemplate` 增加 `'word_to_morpheme'`（识别）与 `'morpheme_to_words'`（产出）
- `Card` 增加可选 `morphemeId?: string`（词根卡的 `wordId` 为空串，`familyId` 沿用派生词族或填空串）

### 存储层变更

- `lib/db.ts`：`DB_VERSION` **3 → 4**（不升版本号已有库不会执行 upgrade，会缺表报 NotFoundError——S-001 已有此教训）
- `SHARED_STORES` 增加 `'morphemes'`；`buildStores` 的 `defs` 增加：
  `morphemes: { keyPath: 'id', auto: false, indexes: ['type', 'origin', 'productivity'] }`
- 新增 `morphemesRepo`（bulkPut / all / get / count）

## 任务清单

- [x] `lib/types.ts`：`Morpheme` 接口、`Word` 三字段、`Card.morphemeId`、`CardTemplate` 两项
- [x] `lib/db.ts`：版本号 3→4、`morphemes` 表与索引、`morphemesRepo`
- [x] `lib/data/morphemes.ts`：63 个高频词素种子常量（手写整理，避免版权问题）
- [x] `lib/data/morph-segment.ts`：基于 `allomorphs` 的确定性切分 + 拼接校验
- [x] `lib/data/morpheme-importer.ts`：幂等写入 → 切分 3000 词 → 生成两类卡 → 挂阶段 3 路径节点
- [x] `lib/llm/morpheme.ts`：`mnemonic` / `literalGlue` 按需生成并写回共享库（复用 S-005 的超时/重试/缓存/埋点）
- [x] 设置页：「词根库导入」区（按钮 + 结果回显）
- [x] 学习页：两种新卡模板的正反面渲染；`mnemonic` 缺失时显示占位而非空白
- [x] 词库页：词根浏览器（新增「词根」标签页；按 `productivity` 排序，点词素看派生词，点派生词跳回词族详情）
- [ ] `scripts/verify-morphemes.mjs`：**离线**数据自检（纯 node，无需浏览器）
- [ ] `scripts/verify-s007.mjs`：CDP 运行时验收

## 验收标准

离线数据自检（`scripts/verify-morphemes.mjs`）：

1. 种子词素 ≥ 60 条，`morphemes` 全表 id 唯一、`form` 非空、`allomorphs` 必含 `form`
2. 引用完整性：所有 `word.decomposition[].morphemeId` 都能在 `morphemes` 中查到
3. 切分正确性：`decomposition` 的 `allomorph` 按顺序拼接 **等于** `lemma`（容差：仅允许 ≤1 个连接/脱落字符，且须记录）
4. 每个 `morphStatus='segmented'` 的词 `literalGlue` 非空
5. 易混词素 `confusingWith` 指向的 id 均存在

运行时验收（`scripts/verify-s007.mjs`，CDP 驱动真实浏览器）：

6. 导入后共享库 `morphemes` 计数 ≥ 60；两类新卡片数 = 可切分词数 + 词素数
7. 重复导入**幂等**：词素数与卡片数不变，且不改动任何 `elm-<userId>` 的 `reviewStates`（前后逐条比对 `dueAt`）
8. 阶段 1 路径节点 `s1-*` 的 `targetFamilyIds` 导入前后完全一致（词根卡不混入）
9. 同一词素的派生词卡片被分到 ≥3 个不同 `interleaveGroup`
10. LLM 未启用时词根卡**仍可正常学习**（正反面由离线字段构成），无报错、无空白
11. LLM 启用后生成 `mnemonic` 写回共享库；再次访问同一词素不再发起新请求（查 `llmLogs` 与 S-005 缓存）
12. `tsc --noEmit` 与 `next build` 通过，浏览器控制台零错误
13. 3000 词的切分扫描 < 2s；词根导入 < 3s

## 已知限制 / 风险

- **英语形态切分本身有噪声**：同化变体（`in-` → `im-/ir-/il-`）、连接字母（`spectacle` 无连接元音而 `inspect` 有）、词干脱落都会造成漏切或错切。
  策略是"宁缺勿错"——切不出来就标 `unsegmented`，不生成卡，而不是给一个似是而非的拆解。
- **词根对 K1 高频口语词基本无效**（本族词不可切分），可切分词集中在 K3 及以上，这正好符合 D8（阶段 3 选修）。
- **假前缀会产生少量误切**（规则法固有噪声，无法靠形态规则排除）：
  `person` 会被切成 `per + son`、`reason` 切成 `re + son` —— 词源上这两个词与 son（声音）无关，
  但形态上完全符合"前缀 + 词根"。要根治需引入词源数据做主键校验，属后续工作。
  缓解：这类切分不会污染词素表，只影响该词的"词素拆解"展示与是否生成词根卡。
- 种子数据手写整理（338 个），覆盖有限；批量扩到 300–800 需要 ETL，须核对来源许可：
  Wiktionary 为 CC BY-SA（需署名与同协议）、Etymonline 需单独确认。默认只启用手写种子。
- 词根卡的 `familyId` 为空串，任何"按词族统计覆盖率"的逻辑需显式跳过，否则会稀释覆盖率分母。

## 验证记录（离线部分）

验收脚本：`scripts/verify-morphemes.mjs`（纯 node；把 TS 编译到临时目录后 require，
因此对真实源码校验，不存在"测试里另写一份数据"的漂移）

结果：**8/8 通过**（数据层与 LLM 补全判定已完工；AC-6~AC-13 的运行时部分待 CDP 验收）

| 验收标准 | 实测 |
| --- | --- |
| AC-1 种子数据完整性 | **63** 条；重复 id 0；结构异常 0（id 与 type/form 一致、allomorphs 含 form、confidence ∈ [0,1]） |
| AC-2 词素引用完整性 | 全部命中 |
| AC-3 切分可复原（差 ≤1 字符） | 全部可复原 |
| AC-4 已切分词的字面义非空 | 全部非空 |
| AC-5 易混词素指向存在 | 全部命中 |
| AC-6 正例切出率 ≥ 90% | **51/51** |
| AC-7 噪声词零误切 | 52 个噪声词全部 `unsegmented` |
| AC-8 LLM 补全触发条件（幂等） | 规则版字面义需润色、已润色与未切分跳过；缺 `story` 才生成助记 |

`tsc --noEmit` 与 `next build` 均通过（数据层 / 导入链路 / 设置页 / 学习页 / 词库页全部接入后）。

词表观测：前 2629 词切出 90 个（**3.4%**），耗时 24ms —— 与"词根集中在 K3 及以上"的预期一致
（D8：阶段 1 高频口语词多为本族词，不可切分）。

### 运行时验收（`scripts/verify-s007.mjs`，CDP 驱动真实浏览器）

结果：**15/15 通过**

| 验收标准 | 实测 |
| --- | --- |
| 前置：导入 3000 词表 | 词族 3002、新增卡片 5818、耗时 1389ms |
| AC-6 词素数 / 两类卡片 | 63 条；`word_to_morpheme=90` · `morpheme_to_words=43` |
| AC-7 重复导入幂等 | 卡片 6137 → 6137、词素 63 → 63、第二次「新增卡片 0」 |
| AC-7 用户复习状态未被改动 | 2 条，`dueAt` 前后完全一致 |
| AC-8 阶段 1 路径节点未被改动 | `s1-*` 签名一致；`s3-root` 挂载 0 → 90 |
| AC-9 同词根派生卡交错分散 | `m.root.port` → 组 0/1/2/3/4/6 |
| AC-10 学习页渲染 / 控制台 | 「见词根 → 派生词 · con — with; together」；零错误 |
| AC-13 导入耗时 | 455ms（< 3s） |

切出率：3000 词 → 90 个可切分（3.0%），与离线观测的 3.4% 一致。

### 过程中修掉的问题（记录备查）

1. 初版把 `MIN_AFFIX_LENGTH = 3` 同时套在前缀上，导致 `in-` / `re-` / `ex-` / `de-` 被整体过滤，
   正例切出率只有 31/51。改为前缀 ≥2、后缀与词根 ≥3：
   前缀的误切风险由"必须有词根匹配"兜底（`uncle` → `cle` 无词根 → 不切），
   而后缀 `-er` / `-ly` / `-al` 若放行会产生大量噪声，故仍要求 ≥3。
2. `m.root.spect.confusingWith` 曾指向未收录的 `m.root.scop`，被 AC-5 抓出。
3. **importer 读了库里的旧字段**（运行时验收抓出）：派生词索引与卡片内容取自 `word.decomposition` / `word.literalGlue`，
   首次导入时二者为空 → 产出卡 0 张、识别卡背面为空，且第二次导入才补生成，直接破坏幂等
   （实测：第一次新增 1 张、第二次又新增 2 张）。
   改为一律使用**本次切分结果**（`refsByLemma` / `glueByLemma`），库里的值只用于判断是否需要回写。
4. **样本量不足**（运行时验收抓出）：共享库只有 90 个种子词时只切出 1 个词，AC-9（交错分散）无从验证。
   验收脚本前置导入 3000 词表（复用 S-001 流程），切出 90 个词后才做断言。
5. `needsGlue` / `needsMnemonic` 初版写在 `lib/llm/morpheme.ts`，但它俩是**纯判定**（D4），
   放在依赖 `idb` 的文件里会导致离线自检脚本 require 不到 `idb`。
   已下沉到 `lib/data/morph-segment.ts`，LLM 模块 re-export，判定逻辑因此可被离线校验。
