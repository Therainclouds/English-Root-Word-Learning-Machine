# 英语学习机（本地 / 纯前端）

高频词族 + 分级阅读 + SRS 间隔复习 + 可插拔大模型辅助的**本地英语学习应用**。

## 快速开始

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # 静态导出到 out/（纯静态，可直接托管或本地打开）
```

全部数据存在浏览器 IndexedDB，**无服务端、无账号、无上传**。

## 设计依据

- `specs/README.md` — **已落定决策 + Spec 清单（开工从这里看）**
- `docs/learning-science.md` — 语言学习的科学方法框架（理论 / 原则 / 策略 / 证据强度）
- `docs/data-model.md` — 数据模型与 IndexedDB 表结构
- `docs/product-plan.md` — 产品方案、三阶段路径、LLM 职责边界、已知风险
- `docs/root-data-schema.md` — 阶段 3 的词根 / 词缀模块结构

## 词表导入（S-001）

内置种子只有 90 余个词族，阶段 1 需要 3000。两种方式：

**A. 应用内导入（设置页 → 词表导入）**

每行一条，`#` 开头忽略：

```
word
word<TAB>rank
word<TAB>rank<TAB>释义
```

**B. 用脚本拉公开词频表再导入**

```bash
node scripts/fetch-wordlist.mjs 3000    # → public/wordlists/top-10000.txt
```

导入写入**共享词库**，不影响任何人的复习进度；重复导入不会产生重复卡片
（id 由 lemma 稳定推导）。导入的词释义为占位，等待按需生成。

## 开发期脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` / `build` / `clean` | 开发 / 静态导出 / 清理缓存 |
| `npm run proxy` | 本地转发代理（绕开第三方大模型的 CORS） |
| `node scripts/fetch-wordlist.mjs [n]` | 下载公开词频表 |

| `node scripts/mock-llm.mjs` | 本地 mock 大模型端点（`/ok` `/fail` `/auth` `/empty` `/word`） |
| `node scripts/check-page.mjs [url]` | 打开页面收集控制台错误与渲染文本 |
| `node scripts/verify-s001.mjs` | 词表导入验收（11 项） |
| `node scripts/verify-s003.mjs` | 分级阅读验收（12 项） |
| `node scripts/verify-s002.mjs` | 释义按需生成验收（13 项） |
| `node scripts/verify-s005.mjs` | LLM 重试/缓存/用量验收（16 项） |
| `node scripts/verify-legacy-word.mjs` | 旧数据不被覆盖回归（6 项） |
| `node scripts/verify-morphemes.mjs` | 词根数据离线自检（7 项，纯 node 无需浏览器） |
| `node scripts/verify-s007.mjs` | 词根模块运行时验收（8 项） |

验收脚本前置：`npm run dev` 已启动，且 Edge/Chrome 以 `--remote-debugging-port=9222` 启动。

## 释义按需生成（S-002）

导入的词默认 `definitionStatus = 'pending'`。三种补齐方式：

1. **词库页 / 学习页**：选中该词 → 「生成释义」，写回**共享词库**（所有人复用）
2. **设置页 → 批量补全释义**：填数量，串行执行并回显进度
3. **设置页 → 修复种子词释义**：非破坏性补齐被旧版导入逻辑误清空的种子词释义

LLM 未启用时给出提示且不报错；生成失败保持 `pending`，可重试。

## 目录

```
app/          页面：路径 / 学习 / 词库 / 设置
components/   Canvas 路径可视化、导航、主题 Provider
components/ui/      shadcn + Radix 控件（slider / switch / select / label）
lib/quiz.ts   客观出题器（四选一干扰项 + 输入题答案集）
lib/
  srs.ts      SM-2 排程（可替换 FSRS）
  coverage.ts 覆盖率估算（Nation 分频段经验值）
  path.ts     节点状态机
  llm/        可插拔适配器：OpenAI 兼容 / Anthropic / Ollama（morpheme.ts 为词根助记）
  data/       种子词表与路径定义
  data/morphemes.ts       63 个种子词素（S-007）
  data/morph-segment.ts   确定性形态切分 + 补全判定（纯函数）
  data/morpheme-importer.ts 词根库导入与卡片生成
  use-app.ts  全局状态（IndexedDB → React）
```

## 常见问题

**报 `Cannot find module './xxx.js'`（webpack-runtime）**
`.next` 缓存损坏（例如 dev 运行时目录被部分删除、或 build 与 dev 抢同一目录）。

```bash
# 先停止 npm run dev，再执行
npm run clean     # 删除 .next / .next-build / out
npm run dev
```

> 建议：跑 `npm run build` 前先停掉 dev。
> 配置里已让 build 使用独立中间目录 `.next-build`，但 dev 的 `.next` 一旦被外部部分删除仍会损坏。

## 多用户档案

纯前端单机场景，账号只用于**隔离学习数据**，不做鉴权。数据分两层：

| 层 | 数据库 | 内容 |
| --- | --- | --- |
| **共享只读词库** | `elm-shared`（全局一份） | 词族 / 词 / 义项 / 例句 / 读物 / 卡片 / 路径节点 |
| **每人学习状态** | `elm-<userId>` | 复习状态 / 复习流水 / 画像 / **学习参数** |

- 一个人学完所有卡片**不会**影响其他人；切换用户后从自己的进度继续
- 学习参数（每日新词上限、目标保持率、是否显示中文）**每人独立**——学得快的人可以调高
- **大模型 / 决策模型配置是全局共享的**，存 `localStorage`（`elm.globalSettings`）
- 换词表只影响共享层，不会打乱任何人的进度；也不会为每个用户复制一份词库
- 导航栏可切换 / 新建 / 重命名 / 删除用户；删除只清除该用户的学习状态
- 旧版数据（单库、或每人一份词库）会在首次启动时自动迁移

## 决策模型（千问 decision-model-preview）

只做**判断**，不生成文本（官方标注最大输出长度 0），当前用于**例句质量校验**：

```jsonc
// POST https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/systemone
{
  "model": "decision-model-preview",
  "state": { "word": "inspect", "target_level": "B1", "target_sense": "检查", "sentence": "..." },
  "questions": {
    "natural":    { "type": "noul", "instructions": "是否自然地道？" },
    "in_level":   { "type": "noul", "instructions": "难度是否在 B1 以内？" },
    "uses_sense": { "type": "noul", "instructions": "是否用了目标义项？" }
  }
}
```

自然度低于阈值（默认 0.6）或义项命中低于 0.5 的例句会被丢弃。
生成释义与例句仍然由通用大模型负责——决策模型不产出文本。

> 浏览器直连百炼大概率触发 CORS，建议走 `npm run proxy`：
> `UPSTREAM_BASE_URL=https://{WorkspaceId}.{region}.maas.aliyuncs.com`、
> `UPSTREAM_PATH_PREFIX=/compatible-mode`。

## 分级阅读（S-003）

`/reading` 提供按主题分组的窄读：

- **生词率实时计算**，以词族为单位，未知词按词形去重
- 判定区间 **2%–5%** 为「难度合适」；> 5% 提示「生词率过高」，< 2% 提示「偏简单」
- 未知词高亮，点击查看释义（pending 可现场生成）或**加入今日学习**
- 只写当前用户的学习状态，不影响其他用户

内置 5 篇原创短文（`daily` × 3、`learning` × 2），避免版权问题。
词形按轻量后缀还原近似匹配（`s/es/ed/ing/ly/er/est`），
因此 `comes`、`waiting` 不会被误判为生词。

> 外部素材（如 TED 演讲文稿）曾做过一版抓取脚本并已移除：实测生词率 34%–44%，
> 远超可理解输入区间（2%–5%），对 K1–K3 阶段属于无效输入。
> 阅读素材应优先选**用词受控**的分级读物（VOA Learning English、Breaking News English 等），
> 真要引入外部文章，先算生词率、只保留落在 2%–5% 的那批。

## 主题与组件（D13）

- **主题**：浅色 / 深色 / 跟随系统，导航栏右侧图标点击轮换，选择存 `localStorage`（`elm.theme`）。
  首帧前由 `app/layout.tsx` 的内联脚本挂 `.dark` class，刷新不闪屏。
  CSS 变量两套写在 `app/globals.css`（`:root` 浅色、`.dark` 深色），改配色只改这两处。
- **控件**：交互组件统一用 **shadcn + Radix**（`components/ui/`：`slider` / `switch` / `select` / `label`），
  不再手写原生 `input[type=range]`、`select`。滑块支持键盘方向键与触屏拖动。

## 学习页：客观作答（D12）

**每张卡都必须在页面上给出答案，由系统客观判定，没有自评环节。**

| 卡片方向 | 题型 | 判定 |
| --- | --- | --- |
| 识别（给词说意思 / 给词说切分） | 四选一（干扰项取自词库中其他词的释义或切分） | 是否命中答案集 |
| 产出（给释义拼词 / 给词根写派生词） | 输入框 | 必须**完全一致**；"拼写接近"也判错（只提示差在哪） |

判定后自动记分：答错 → `0`（lapse，明天重来）；答对 → `4`（良好，按 SM-2 推进）。
快捷键：选择题 `1-4`，输入题 `Enter` 提交，判定后 `空格` 下一张。

无法客观出题的卡（**释义或切分还没生成**）不会进入队列，页面顶部会提示数量并给出
「去设置页批量生成释义」入口 —— 生成后自动回到队列。

## 词根词缀模块（S-007）

阶段 3 选修（D8：词根对 K1 高频口语词基本无效）。**切分由确定性代码完成**（D10），
LLM 只补助记与字面义润色，结果写回共享词库。

1. **设置页 → 词根库导入 → 「导入词根库并切分词库」**
   写入 **338 个种子词素**（50 前缀 + 252 词根 + 36 后缀），按规则切分共享词库。
   实测 3000 词切出 278 个（约 11%），
   生成两类卡片：**词 → 词素切分**（识别方向）与 **词根 → 派生词**（产出方向），
   并挂到阶段 3 的「词根词缀系统」节点。重复导入不产生重复卡片，不改动任何人的复习进度。
2. **词库页 → 「词根」标签页**：按派生力（`productivity`）排序，
   点词素看异形、派生词与助记，点派生词可跳回词族详情。
3. **可选（需启用大模型）**：「批量补全词根助记」生成中文助记与同源词；
   「润色字面义」把 `[in] into, in + [spect] to look, see` 改成 `to look into`。

切分策略是**宁缺勿错**：拼不回原词就标 `unsegmented`，不给似是而非的拆解。

数据模型见 `docs/root-data-schema.md`，验收记录见 `specs/007-morpheme-module.md`
（离线 8/8、运行时 15/15）。

## 三阶段路径

1. **词汇与阅读基建**：2000–3000 高频词族 + 分级阅读（本 MVP 范围）
2. **句型与语块**：限时句型、4/3/2 复述、场景对话
3. **扩展与进阶**：学术词汇、词根词缀系统、听说输出

## 大模型配置

设置页内置接入预设：OpenAI 兼容 / Anthropic 官方 / MiniMax（国内·国际）/ **本地代理** / Ollama。

### 接入 MiniMax（Anthropic 协议）

MiniMax 的 Anthropic 兼容入口是 **`https://api.minimaxi.com/anthropic`**（国际站 `https://api.minimax.io/anthropic`，路径必须带 `/anthropic`），
模型名要用 MiniMax 自有名称（如 `MiniMax-M2.7`）。

实测该端点的 CORS `Access-Control-Allow-Headers` 为固定列表，只放行 `Authorization`、`Content-Type` 等，
**不含 `x-api-key` 与 `anthropic-version`** → 带这两个头的浏览器请求会在预检阶段被拒。
因此代码中：仅当目标主机是 `anthropic.com` 时才发送 Anthropic 专有头，第三方端点一律使用
`Authorization: Bearer`。

> ⚠️ 浏览器直连第三方端点几乎必然被 CORS 拦截（`anthropic-dangerous-direct-browser-access` 只对官方 `api.anthropic.com` 生效）。
> 因此第三方接入请使用**本地代理**：

```bash
cp proxy/.env.example proxy/.env   # 填写 UPSTREAM_BASE_URL / UPSTREAM_PATH_PREFIX / UPSTREAM_API_KEY
npm run proxy                      # 监听 http://localhost:8787
```

然后在设置页选「本地代理」预设，Base URL 填 `http://localhost:8787`，浏览器侧 API Key 留空
（密钥只写在 `proxy/.env`，不会暴露给浏览器）。

## 当前种子数据

`lib/data/seed-words.ts` 内置约 90 个最高频词族（演示用）。
正式使用请替换为 Nation 的 BNC/COCA 词族表（K1–K9），保持字段结构即可。
