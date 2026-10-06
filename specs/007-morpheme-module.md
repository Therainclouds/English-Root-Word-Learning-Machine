# S-007 词根词缀模块（阶段 3 选修）

状态：**done**　依赖：D1 D2 D4 D6 D8 D10 D11、S-001、S-005

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
   - 「词干比词根长」时多出的字符必须是**屈折尾或连接元音**（`s / es / ed / ing / en / er` 或 `aeiouy`），
     否则拒绝切分——否则 `morning → mor(死) + ing`、`package → pac(和平) + age`、`coming → co + min(小)`
     这类"整词硬拆"会通过 gap 校验并生成卡片
   - 词源无关但形态合规的词（`person / recent / often / apple / travel …`）进 `NON_SEGMENTABLE` 黑名单；
     名单受 AC-10 保护，任何新增误切样本都应先进名单再修规则
2b. **重新导入必须 merge，不能覆盖**：种子是基线而非权威。`importMorphemes` 写入前读取库中已有词素，
   种子里为空的 `explain` / `mnemonic` 沿用库中值——否则用户点过"批量补全词根讲解"后再导一次就全白烧了（AC-14）
3. **只写共享库**：morphemes / words / cards / pathNodes 全在 `elm-shared`（D2），不触碰任何 `elm-<userId>`
4. **LLM 只补内容**：走 `lib/llm` 现有 transport（自动获得 S-005 的超时 / 重试 / 缓存 / 用量统计），生成后写回共享库；第二次访问不再请求
5. **交错**：同一词素的派生词卡片分到**不同** `interleaveGroup`（root-data-schema §2.6），避免同族词扎堆
6. **路径节点**：复用 `PathNodeType` 已有的 `'morpheme_set'`，词根卡统一挂到 `s3-root` 节点
   （`targetFamilyIds` = 可切分词族，上限 `NODE_FAMILY_CAP`），不动任何 `s1-*` 节点
7. **词根卡独立预算**（D11）：`buildSession` 把新卡按来源分池——普通卡吃 `learning.dailyNewLimit`，
   词根卡吃 `MORPH_DAILY_NEW_LIMIT`（默认 5）；`use-app.ts` 也按 cardId 归属分开统计今日已学数。
   任一侧额度用尽都不影响另一侧（离线 AC-11 覆盖）
8. **判定不得误伤正确答案**：产出卡的 `back` 存**全量**派生词（展示时才截断），
   释义选择题的干扰项要做相似度过滤（互相包含的释义不能同时出现），否则学习者写了第 9 个派生词、
   或选了一个语义同样成立的选项，会被判错（AC-12）

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
- [x] `scripts/verify-morphemes.mjs`：**离线**数据自检（纯 node，无需浏览器，12 项）
- [x] `scripts/verify-s007.mjs`：CDP 运行时验收（16 项）

## 验收标准

### A. 离线数据自检（`scripts/verify-morphemes.mjs`，纯 node）

| 编号 | 标准 |
| --- | --- |
| AC-1 | 种子词素 ≥ 60 条；id 唯一、结构完整（`allomorphs` 必含 `form`、置信度 ∈ [0,1]） |
| AC-2 | 引用完整性：`decomposition[].morphemeId` 均可在 `morphemes` 中查到 |
| AC-3 | 切分可复原：`allomorph` 顺序拼接与 `lemma` 相差 ≤ 1 字符 |
| AC-4 | 每个 `morphStatus='segmented'` 的词 `literalGlue` 非空 |
| AC-5 | 易混词素 `confusingWith` 指向的 id 均存在 |
| AC-6 | 正例切出率 ≥ 90%（51 个形态学上明确的例词） |
| AC-7 | 噪声词零误切（44 个不可切分的本族词 / 借词） |
| AC-8 | LLM 补全触发条件幂等：规则版字面义需润色、已润色 / 未切分跳过；缺助记才请求 |
| AC-9 | 深度讲解格式：`etymology` 长度合理、派生词必须是 `词 → 释义` 形式 |
| AC-10 | **误切黑名单生效**：`NON_SEGMENTABLE` 中的词一律不得被切分（防回归，≥10 个受保护词） |
| AC-11 | **词根卡独立预算（D11）**：阶段 1 额度用尽仍会派词根新卡；词根额度用尽仍会派普通新卡 |
| AC-12 | **判定不误伤正确答案**：产出卡答案集完整（12/12 可判对）、相似释义不会进入干扰项 |

### B. 运行时验收（`scripts/verify-s007.mjs`，CDP 驱动真实浏览器）

| 编号 | 标准 |
| --- | --- |
| 前置 | 在真实界面完成一次作答（选择 / 输入 → 提交 → 判定 → 下一张），产生用户复习状态 |
| AC-6 | 导入后 `morphemes` ≥ 60；两类新卡片均已生成（`word_to_morpheme` / `morpheme_to_words`） |
| AC-7 | 重复导入**幂等**：词素数与卡片数不变，且逐条比对 `reviewStates.dueAt` 确认未改动任何 `elm-<userId>` |
| AC-8 | 阶段 1 节点 `s1-*` 的挂载签名导入前后完全一致；词根挂到 `s3-root` |
| AC-9 | 同一词素的派生词卡片被分到 ≥3 个不同 `interleaveGroup` |
| AC-10 | LLM 未启用时卡片仍可渲染；浏览器控制台零错误 |
| AC-13 | 3000 词的词根导入 < 3s |
| AC-14 | **重新导入保留 LLM 成果**：先注入 `explain`/`mnemonic` 再导一次，讲解与助记计数不得下降 |

另有 `tsc --noEmit` 与 `next build` 作为常规闸门。

## 已知限制 / 风险

- **英语形态切分本身有噪声**：同化变体（`in-` → `im-/ir-/il-`）、连接字母（`spectacle` 无连接元音而 `inspect` 有）、词干脱落都会造成漏切或错切。
  策略是"宁缺勿错"——切不出来就标 `unsegmented`，不生成卡，而不是给一个似是而非的拆解。
- **词根对 K1 高频口语词基本无效**（本族词不可切分），可切分词集中在 K3 及以上，这正好符合 D8（阶段 3 选修）。
- **假前缀误切是规则法的固有噪声**，目前用两道闸门压制，但**不能根治**：
  1. `gap` 收紧：词干比词根多出的字符必须是屈折尾或连接元音，拦掉 `morning → mor + ing`、
     `package → pac + age`、`coming → co + min` 这类"整词硬拆"；
  2. `NON_SEGMENTABLE` 黑名单：形态完全合规但词源无关的词（`person → per + son`、`recent → re + cent`、
     `often → of + ten`、`apple → ap + ple`、`travel → tra + vel`、`common → com + mon`、`recipe → re + cip`）
     以及拆解会误导的 `college` / `profile`，一律不切分、不生成卡片。
  代价：全量切出数由 278 降到 257（前 3000 词，-7.5%），换掉 13 个已知误切；正例 51/51 未受影响。
  **仍有名单外的误切可能进入**（新样本应先补进黑名单再谈改规则，AC-10 负责防回退）。
  根治需引入词源数据做主键校验（如开放词源数据集），属后续工作。
- **重新导入的语义是"种子打底 + 保留已有成果"**：种子里为空的 `explain` / `mnemonic` 不会被清空，
  但种子若更新了同一条讲解，会以种子为准（便于内容迭代）。
- 种子数据手写整理（338 个），覆盖有限；批量扩到 300–800 需要 ETL，须核对来源许可：
  Wiktionary 为 CC BY-SA（需署名与同协议）、Etymonline 需单独确认。默认只启用手写种子。
- 词根卡的 `familyId` 为空串，任何"按词族统计覆盖率"的逻辑需显式跳过，否则会稀释覆盖率分母。

## 验证记录（离线部分）

验收脚本：`scripts/verify-morphemes.mjs`（纯 node；把 TS 编译到**项目内**临时目录后 require，
因此对真实源码校验，不存在"测试里另写一份数据"的漂移）

结果：**12/12 通过**

| 验收标准 | 实测 |
| --- | --- |
| AC-1 种子数据完整性 | **338** 条（前缀 50 · 词根 252 · 后缀 36）；重复 id 0；结构异常 0 |
| AC-2 词素引用完整性 | 全部命中 |
| AC-3 切分可复原（差 ≤1 字符） | 全部可复原 |
| AC-4 已切分词的字面义非空 | 全部非空 |
| AC-5 易混词素指向存在 | 全部命中 |
| AC-6 正例切出率 ≥ 90% | **51/51** |
| AC-7 噪声词零误切 | 44 个噪声词全部 `unsegmented` |
| AC-8 LLM 补全触发条件（幂等） | 规则版字面义需润色、已润色与未切分跳过；缺 `story` 才生成助记 |
| AC-9 讲解格式（标杆） | 8 条讲解；长度异常 0；派生词格式异常 0 |
| AC-10 误切黑名单生效 | 14 个受保护词，仍被切分 **0** |
| AC-11 词根卡独立预算（D11） | 阶段 1 用尽仍派 **2** 张词根卡；词根用尽仍派 **2** 张普通卡 |
| AC-12 判定不误伤正确答案 | 派生词答案 **12/12**（第 9 个可判对）；相似释义未进选项 |

`tsc --noEmit` 与 `next build` 均通过。

词表观测：前 2629 词切出 257 个（**9.8%**），耗时 ~50ms。
切出率由 3.4% 升到 9.8% 是词素库扩到 338 条的结果；与"词根集中在 K3 及以上"的预期一致
（D8：阶段 1 高频口语词多为本族词，不可切分）。

### 运行时验收（`scripts/verify-s007.mjs`，CDP 驱动真实浏览器）

结果：**16/16 通过**

| 验收标准 | 实测 |
| --- | --- |
| 前置：评一张卡产生用户状态 | `GRADED`（按 D12 后的界面：选择 / 输入 → 提交 → 判定 → 下一张） |
| 前置：导入 3000 词表 | 词族 3002、耗时 1011ms |
| AC-6 词素数 / 两类卡片 | 338 条；`word_to_morpheme=258` · `morpheme_to_words=142` |
| AC-7 重复导入幂等 | 卡片 6404 → 6404、词素 338 → 338、第二次「新增卡片 0」 |
| AC-7 用户复习状态未被改动 | 13 条，`dueAt` 前后完全一致 |
| AC-8 阶段 1 路径节点未被改动 | `s1-*` 签名一致；`s3-root` 挂载 0 → 257 |
| AC-9 同词根派生卡交错分散 | `m.root.fer` → 组 0/1/2/3/4/5/6 |
| AC-10 学习页渲染 / 控制台 | 卡片正常渲染；零错误 |
| AC-13 导入耗时 | 694ms（< 3s） |
| AC-14 重新导入保留 LLM 讲解/助记 | 注入 `m.prefix.anti` 后：讲解 10 → 10，助记 2 → 2 |

切出率：3000 词 → 257 个可切分（8.6%），与离线观测一致。

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

### 第二轮代码审查修掉的问题（记录备查）

以下 6～11 项**既有的验收脚本全都查不出来**（它们绿着，但功能是错的），
靠全量抽样 + 逐层读代码发现；每一项都补了对应的 AC 再修。

6. **重新导入会抹掉 LLM 成果**：`importMorphemes` 直接拿种子 `put` 覆盖 `morphemes` 表，
   用户点过"批量补全词根讲解"后再导一次，讲解 / 助记被清空（白烧 token）。
   改为 merge：种子里为空的 `explain` / `mnemonic` 沿用库中值 → AC-14。
7. **产出卡答案被截断**：`back: words.slice(0, 8)` 使词素有 9 个以上派生词时，
   学习者写出第 9 个被判错——直接违反 D12"客观判定"的承诺。
   改为 `back` 存全量、仅展示时截断 → AC-12。
8. **误切会生成卡片**：`morning → mor(死) + ing`、`package → pac(和平) + age`、`person → per + son(声音)`
   词源全无关，gap 校验拦不住（`person` 的 gap 甚至是 0）。收紧 gap 规则并引入 `NON_SEGMENTABLE` 黑名单；
   切出数 278 → 257、正例仍 51/51 → AC-10。
9. **D11 只写在决策表里、代码从未落地**：`buildSession` 吃全量 `cards`，词根卡与阶段 1 共用
   `dailyNewLimit`——答 10 张词根卡会吃掉 5 个新词额度，正是 D11 要避免的挤兑。
   改为按来源分池 + `MORPH_DAILY_NEW_LIMIT = 5`，今日计量按 cardId 归属分离 → AC-11。
10. **客观判定下 ease 惩罚过陡**：答错按 SM-2 原始 q=0 是 −0.8，两次手滑就把 ease 打到下限 1.3，
    此后即使一路答对间隔也不再增长（ease 已无恢复空间）。改为答错映射 q=2（−0.32）；
    `stability` 的失误惩罚同步减半（0.12 → 0.06/次），使"错过一次"的词族从约 10 次降到约 6 次可达掌握线。
11. **干扰项可能出现第二个正确答案**：只排除"完全相等"的释义不够，库里同时存在
    「大约」与「关于；大约」时两个选项都成立。新增相似度过滤（归一化后互相包含即排除），
    并在过滤后候选不足 3 个时回退，保证出题能力。
12. **运行时验收的前置步骤早已失效**：脚本仍在找 `reveal-btn` / `grade-4`，
    而 D12 改造后界面已改为 `choice-0` / `answer-input` + `submit-answer` + `next-card`，
    前置一直返回 `NO_CARD`（说明这份验收此前从未真正跑通过）。
    已按当前真实界面重写前置——这是让前置重新可执行，**不是放宽标准**。
