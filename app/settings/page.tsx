'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ListPlus, Scale, Server, Sparkles, Users } from 'lucide-react';
import { useAppContext } from '@/components/app-provider';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createProvider } from '@/lib/llm';
import { decisionEndpoint } from '@/lib/llm/decision';
import type { LlmProviderId, LlmUsageLog } from '@/lib/types';

interface Preset {
  id: string;
  label: string;
  provider: LlmProviderId;
  baseUrl: string;
  model: string;
  authHeader: 'x-api-key' | 'bearer';
  hint: string;
}

const PRESETS: Preset[] = [
  {
    id: 'openai',
    label: 'OpenAI / 兼容中转',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    authHeader: 'bearer',
    hint: '兼容 DeepSeek、通义、硅基流动等，改 base_url 与模型名即可',
  },
  {
    id: 'anthropic',
    label: 'Anthropic 官方',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    authHeader: 'x-api-key',
    hint: '官方端点支持浏览器直连所需的 anthropic-dangerous-direct-browser-access 头',
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax 国内（Anthropic 协议）',
    provider: 'anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    model: 'MiniMax-M2.7',
    authHeader: 'bearer',
    hint: '路径必须带 /anthropic；鉴权只能用 Authorization: Bearer（x-api-key 不在该站 CORS 允许头列表内，会被预检拦截）；模型名用 MiniMax 自有名称。若仍失败请改用本地代理',
  },
  {
    id: 'minimax-io',
    label: 'MiniMax 国际（Anthropic 协议）',
    provider: 'anthropic',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M2.7',
    authHeader: 'bearer',
    hint: '同上，域名为 api.minimax.io；同样只能用 Bearer 鉴权',
  },
  {
    id: 'proxy',
    label: '本地代理（第三方接入推荐）',
    provider: 'anthropic',
    baseUrl: 'http://localhost:8787',
    model: 'MiniMax-M2.7',
    authHeader: 'bearer',
    hint: 'npm run proxy 启动；密钥写在 proxy/.env，浏览器侧 API Key 可留空',
  },
  {
    id: 'ollama',
    label: 'Ollama（本地模型）',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b',
    authHeader: 'bearer',
    hint: '需以 OLLAMA_ORIGINS=* 启动，否则浏览器请求被拒',
  },
];

const PROTOCOL_LABEL: Record<LlmProviderId, string> = {
  'openai-compatible': 'OpenAI 兼容协议',
  anthropic: 'Anthropic Messages 协议',
  ollama: 'Ollama 协议',
};

export default function SettingsPage() {
  const { ready, settings, saveSettings, users, userId, resetCurrentUser, reload, families, words } =
    useAppContext();
  const [wordlistText, setWordlistText] = useState('');
  const [importState, setImportState] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [batchCount, setBatchCount] = useState(5);
  const [batchRunning, setBatchRunning] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testFailed, setTestFailed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [morphRunning, setMorphRunning] = useState(false);
  const [morphState, setMorphState] = useState<string | null>(null);
  const [morphLimit, setMorphLimit] = useState(5);
  const [morphBatchRunning, setMorphBatchRunning] = useState(false);

  if (!ready) {
    return <div className="py-24 text-center text-sm text-muted-foreground">载入中…</div>;
  }

  const llm = settings.llm;
  const decision = settings.decision;
  const update = (patch: Partial<typeof settings>) => saveSettings({ ...settings, ...patch });
  const updateLlm = (patch: Partial<typeof llm>) => update({ llm: { ...llm, ...patch } });
  const updateDecision = (patch: Partial<typeof decision>) =>
    update({ decision: { ...decision, ...patch } });
  const decisionEndpointPreview = decision.workspaceId
    ? decisionEndpoint(decision)
    : '（填写 WorkspaceId 后显示）';

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    updateLlm({
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
      authHeader: preset.authHeader,
    });
  };

  const activePreset = PRESETS.find(
    (p) => p.baseUrl === llm.baseUrl && p.provider === llm.provider,
  );

  const test = async () => {
    setTesting('请求中…');
    setTestFailed(false);
    try {
      const provider = createProvider(llm);
      const text = await provider.chat([
        { role: 'system', content: 'Reply with OK only.' },
        { role: 'user', content: 'ping' },
      ]);
      setTesting(text ? `连通：${text.slice(0, 60)}` : '连通，但返回内容为空');
    } catch (err) {
      setTestFailed(true);
      setTesting(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">大模型接入</h2>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3 text-sm">
          <Label htmlFor="llm-enabled" className="text-sm text-foreground">
            启用大模型辅助
          </Label>
          <Switch
            id="llm-enabled"
            data-testid="llm-enabled"
            checked={llm.enabled}
            onCheckedChange={(checked) => updateLlm({ enabled: checked })}
          />
        </div>

        <Field label="接入预设">
          <Select value={activePreset?.id ?? ''} onValueChange={applyPreset}>
            <SelectTrigger data-testid="llm-preset">
              <SelectValue placeholder="选择一个预设（或手动填写下方字段）" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            {activePreset?.hint ?? '选择预设后仍可手动修改任意字段'}
          </p>
        </Field>

        <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground">
          当前协议：<span className="text-foreground">{PROTOCOL_LABEL[llm.provider]}</span>
          <span className="mx-2">·</span>
          请求地址：<span className="text-foreground break-all">
            {llm.provider === 'anthropic'
              ? `${llm.baseUrl.replace(/\/+$/, '')}/v1/messages`
              : llm.provider === 'ollama'
                ? `${llm.baseUrl.replace(/\/+$/, '')}/api/chat`
                : `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`}
          </span>
        </div>

        <Field label="Base URL">
          <input
            value={llm.baseUrl}
            onChange={(e) => updateLlm({ baseUrl: e.target.value })}
            placeholder="https://api.minimaxi.com/anthropic"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Field>

        <Field label="模型">
          <input
            value={llm.model}
            onChange={(e) => updateLlm({ model: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Field>

        <Field label="鉴权方式">
          <Select
            value={llm.authHeader ?? 'bearer'}
            onValueChange={(value) => updateLlm({ authHeader: value as 'bearer' | 'x-api-key' })}
          >
            <SelectTrigger data-testid="llm-auth-header">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bearer">Authorization: Bearer（多数国内兼容端点）</SelectItem>
              <SelectItem value="x-api-key">x-api-key（Anthropic 官方）</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="API Key">
          <input
            type="password"
            value={llm.apiKey}
            onChange={(e) => updateLlm({ apiKey: e.target.value })}
            placeholder="走本地代理时此处可留空"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            浏览器直连模式下密钥明文存于本机 IndexedDB；使用本地代理时密钥只写在 proxy/.env。
          </p>
        </Field>

        <div className="flex items-center gap-3">
          <button
            data-testid="test-llm"
            onClick={() => void test()}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-sm"
          >
            测试连通
          </button>
        </div>

        {testing && (
          <pre
            data-testid="test-llm-result"
            className={`whitespace-pre-wrap rounded-lg border p-3 text-xs ${
              testFailed ? 'border-destructive/50 bg-destructive/5 text-destructive' : 'border-border bg-background/50 text-muted-foreground'
            }`}
          >
            {testing}
          </pre>
        )}
      </section>

      <LlmUsageSection userId={userId} />

      <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">为什么第三方端点会失败</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          实测 <code>api.minimaxi.com</code> 的 CORS <code>Access-Control-Allow-Headers</code> 是固定列表，
          只放行 <code>Authorization</code>、<code>Content-Type</code> 等，
          <b> 不含 <code>x-api-key</code> 与 <code>anthropic-version</code></b>
          ——带这两个头的请求会在预检阶段被浏览器直接拒绝（Failed to fetch）。
          因此：第三方端点必须用 <b>Bearer</b> 鉴权，且已在代码中自动省略 Anthropic 专有头。
          若仍失败（各家网关策略不同），最稳妥的做法是在本机跑转发代理：
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            复制 <code>proxy/.env.example</code> 为 <code>proxy/.env</code>，填入
            <code> UPSTREAM_BASE_URL=https://api.minimaxi.com</code>、
            <code> UPSTREAM_PATH_PREFIX=/anthropic</code>、<code> UPSTREAM_API_KEY</code>
          </li>
          <li>
            运行 <code>npm run proxy</code>（默认监听 8787）
          </li>
          <li>
            上方预设选「本地代理」，Base URL 即 <code>http://localhost:8787</code>，浏览器侧 API Key 留空
          </li>
        </ol>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-center gap-2">
          <ListPlus className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">词表导入（S-001）</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          每行一条：<code>word</code> 或 <code>word&lt;TAB&gt;rank</code> 或{' '}
          <code>word&lt;TAB&gt;rank&lt;TAB&gt;释义</code>。<code>#</code> 开头的行忽略。
          导入写入<b>共享词库</b>，不会影响任何人的复习进度；重复导入不会产生重复卡片。
          当前共享词库：<b>{families.length}</b> 个词族。
        </p>

        <textarea
          data-testid="wordlist-input"
          value={wordlistText}
          onChange={(e) => setWordlistText(e.target.value)}
          rows={5}
          placeholder={'the\nof 2\nand\t3\t和'}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".txt,.csv,.tsv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setWordlistText(await file.text());
            }}
            className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1 file:text-xs"
          />
          <button
            data-testid="import-btn"
            disabled={importing || !wordlistText.trim()}
            onClick={async () => {
              setImporting(true);
              setImportState('导入中…');
              try {
                const { importWordlist } = await import('@/lib/data/importer');
                const result = await importWordlist(wordlistText);
                setImportState(
                  `完成：解析 ${result.imported} 条（复用 ${result.reused}）、新增卡片 ${result.cardsAdded}、` +
                    `跳过 ${result.skipped} 行、词族总数 ${result.familiesTotal}、耗时 ${result.durationMs}ms`,
                );
                await reload();
              } catch (err) {
                setImportState(`失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setImporting(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {importing ? '导入中…' : '导入词表'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            type="number"
            min={1}
            max={50}
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
            className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          />
          <button
            data-testid="batch-def-btn"
            disabled={!settings.llm.enabled || batchRunning}
            onClick={async () => {
              setBatchRunning(true);
              setImportState('批量补全中…');
              try {
                const { ensureDefinitions, isPending } = await import('@/lib/definitions');
                const targets = words.filter(isPending).slice(0, batchCount).map((w) => w.id);
                if (!targets.length) {
                  setImportState('没有待生成释义的词');
                  return;
                }
                const result = await ensureDefinitions(settings.llm, targets, (done, total) =>
                  setImportState(`批量补全中… ${done}/${total}`),
                );
                setImportState(`批量补全完成：成功 ${result.ok}，失败 ${result.failed}`);
                await reload();
              } catch (err) {
                setImportState(`批量补全失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setBatchRunning(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {batchRunning ? '补全中…' : '批量补全释义'}
          </button>
          <button
            data-testid="repair-seed-btn"
            onClick={async () => {
              const { repairSeedDefinitions } = await import('@/lib/data/seed');
              const count = await repairSeedDefinitions();
              setImportState(`已修复 ${count} 个种子词的释义（仅补齐为空的英文释义，不影响其他数据）`);
              await reload();
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs"
          >
            修复种子词释义
          </button>
          <span className="text-xs text-muted-foreground">
            用于补齐被旧版导入逻辑误清空的种子词释义（非破坏性）
          </span>
        </div>

        {importState && (
          <pre
            data-testid="import-result"
            className="whitespace-pre-wrap rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground"
          >
            {importState}
          </pre>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-center gap-2">
          <ListPlus className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">词根库导入（S-007）</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          写入内置种子词素，再用<b>确定性规则</b>切分共享词库里的词（D10：切分离线完成，不调用大模型）。
          生成两类卡片：<b>词 → 词素切分</b>（识别方向）与<b>词根 → 派生词</b>（产出方向），
          挂在阶段 3 的「词根词缀系统」节点，不占用阶段 1 的每日新词额度（D11）。
          切不出来的一律标记 unsegmented，不硬拆。重复导入不会产生重复卡片，也不改动任何人的复习进度。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid="import-morph-btn"
            disabled={morphRunning}
            onClick={async () => {
              setMorphRunning(true);
              setMorphState('导入中…');
              try {
                const { importMorphemes } = await import('@/lib/data/morpheme-importer');
                const result = await importMorphemes();
                setMorphState(
                  `完成：词素 ${result.morphemes} 条、切出 ${result.segmented} 个词、` +
                    `未切出 ${result.unsegmented}、新增卡片 ${result.cardsAdded}、` +
                    `节点挂载 ${result.nodeFamilies} 个词族、耗时 ${result.durationMs}ms`,
                );
                await reload();
              } catch (err) {
                setMorphState(`失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setMorphRunning(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {morphRunning ? '导入中…' : '导入词根库并切分词库'}
          </button>
          <span className="text-xs text-muted-foreground">
            当前共享词库 {words.length} 个词，切出率通常只有几个百分点（K1–K2 多为本族词，不可切分）
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            type="number"
            min={1}
            max={30}
            value={morphLimit}
            onChange={(e) => setMorphLimit(Number(e.target.value))}
            className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          />
          <button
            data-testid="morph-mnemonic-btn"
            disabled={!settings.llm.enabled || morphBatchRunning}
            onClick={async () => {
              setMorphBatchRunning(true);
              setMorphState('补全助记中…');
              try {
                const { ensureMorphemeMnemonics } = await import('@/lib/llm/morpheme');
                const result = await ensureMorphemeMnemonics(settings.llm, morphLimit, (done, total) =>
                  setMorphState(`补全助记中… ${done}/${total}`),
                );
                setMorphState(`助记补全完成：成功 ${result.ok}，失败 ${result.failed}（已写回共享词库）`);
                await reload();
              } catch (err) {
                setMorphState(`失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setMorphBatchRunning(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {morphBatchRunning ? '补全中…' : '批量补全词根助记'}
          </button>
          <button
            data-testid="morph-glue-btn"
            disabled={!settings.llm.enabled || morphBatchRunning}
            onClick={async () => {
              setMorphBatchRunning(true);
              setMorphState('润色字面义中…');
              try {
                const { ensureLiteralGlues } = await import('@/lib/llm/morpheme');
                const result = await ensureLiteralGlues(settings.llm, morphLimit, (done, total) =>
                  setMorphState(`润色字面义中… ${done}/${total}`),
                );
                setMorphState(`字面义润色完成：成功 ${result.ok}，失败 ${result.failed}`);
                await reload();
              } catch (err) {
                setMorphState(`失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setMorphBatchRunning(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            润色字面义
          </button>
          <button
            data-testid="morph-explain-btn"
            disabled={!settings.llm.enabled || morphBatchRunning}
            onClick={async () => {
              setMorphBatchRunning(true);
              setMorphState('补全讲解中…');
              try {
                const { ensureMorphemeExplanations } = await import('@/lib/llm/morpheme');
                const result = await ensureMorphemeExplanations(settings.llm, morphLimit, (done, total) =>
                  setMorphState(`补全讲解中… ${done}/${total}`),
                );
                setMorphState(
                  `讲解补全完成：成功 ${result.ok}，失败 ${result.failed}` +
                    (result.failed ? '（失败的可在词库页逐个重试）' : ''),
                );
                await reload();
              } catch (err) {
                setMorphState(`失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setMorphBatchRunning(false);
              }
            }}
            className="rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            批量补全词根讲解
          </button>
          <span className="text-xs text-muted-foreground">
            LLM 只补<b>讲解与助记</b>（词源演变 / 异形 / 派生词 / 易混），
            <b>切分始终由确定性代码完成</b>（D10）。结果写回共享库，不会重复请求。
          </span>
        </div>

        {morphState && (
          <pre
            data-testid="morph-result"
            className="whitespace-pre-wrap rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground"
          >
            {morphState}
          </pre>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">决策模型（例句质量校验）</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          千问 <code>decision-model-preview</code>：<b>只做判断、不生成文本</b>（官方标注最大输出长度 0），
          一次请求返回分类 / 是非 / 评分的概率与置信度。本应用用它判断生成的例句是否地道、是否超纲、
          是否用对了义项，不合格的句子直接丢弃。释义与例句的生成仍由上面的大模型负责。
        </p>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3 text-sm">
          <Label htmlFor="decision-enabled" className="text-sm text-foreground">
            启用例句质量校验
          </Label>
          <Switch
            id="decision-enabled"
            data-testid="decision-enabled"
            checked={decision.enabled}
            onCheckedChange={(checked) => updateDecision({ enabled: checked })}
          />
        </div>

        <Field label="WorkspaceId（业务空间 ID）">
          <input
            value={decision.workspaceId}
            onChange={(e) => updateDecision({ workspaceId: e.target.value.trim() })}
            placeholder="在百炼控制台获取"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Field>

        <Field label="自定义端点（走本地代理时填）">
          <input
            value={decision.baseUrlOverride}
            onChange={(e) => updateDecision({ baseUrlOverride: e.target.value.trim() })}
            placeholder="留空直连百炼；填 http://localhost:8787 走代理"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            走代理时需在 <code>proxy/.env</code> 设
            <code> UPSTREAM_BASE_URL=https://{'{WorkspaceId}'}.{'{region}'}.maas.aliyuncs.com</code>、
            <code> UPSTREAM_PATH_PREFIX=/compatible-mode</code>、<code> UPSTREAM_AUTH_HEADER=bearer</code>
          </p>
        </Field>

        <Field label="地域">
          <Select
            value={decision.region}
            onValueChange={(value) =>
              updateDecision({ region: value as 'cn-beijing' | 'ap-southeast-1' })
            }
          >
            <SelectTrigger data-testid="decision-region">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cn-beijing">华北2（北京）</SelectItem>
              <SelectItem value="ap-southeast-1">新加坡</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="API Key">
          <input
            type="password"
            value={decision.apiKey}
            onChange={(e) => updateDecision({ apiKey: e.target.value })}
            placeholder="Bearer $DASHSCOPE_API_KEY"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </Field>

        <Field label={`自然度阈值：${decision.naturalThreshold.toFixed(2)}（低于此值的例句丢弃）`}>
          <Slider
            data-testid="natural-threshold"
            min={30}
            max={90}
            step={1}
            value={[Math.round(decision.naturalThreshold * 100)]}
            onValueChange={([value]) => updateDecision({ naturalThreshold: value / 100 })}
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          请求地址：<span className="break-all text-foreground">{decisionEndpointPreview}</span>
          {decision.enabled && !decision.workspaceId && (
            <span className="text-amber-400"> · 请先填写 WorkspaceId</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          浏览器直连百炼大概率触发 CORS；若测试失败，请用
          <code> npm run proxy</code>，并在 <code>proxy/.env</code> 中设置
          <code> UPSTREAM_BASE_URL=https://{'{WorkspaceId}'}.{'{region}'}.maas.aliyuncs.com</code>、
          <code> UPSTREAM_PATH_PREFIX=/compatible-mode</code>。
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-card/40 p-5">
        <h2 className="text-lg font-semibold">学习参数</h2>

        <p className="text-xs text-muted-foreground">
          以下参数<b>按用户独立保存</b>：学得快的人可以调高，不影响其他人。
          大模型与决策模型配置则是全局共享的。
        </p>

        <Field label={`每日新词上限：${settings.learning.dailyNewLimit}`}>
          <Slider
            data-testid="daily-new-limit"
            min={5}
            max={40}
            step={1}
            value={[settings.learning.dailyNewLimit]}
            onValueChange={([value]) =>
              update({ learning: { ...settings.learning, dailyNewLimit: value } })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            可持续速率约 10–20；超出会产生不可承受的复习债。
          </p>
        </Field>

        <Field label={`目标保持率：${Math.round(settings.learning.retentionTarget * 100)}%`}>
          <Slider
            data-testid="retention-target"
            min={80}
            max={95}
            step={1}
            value={[Math.round(settings.learning.retentionTarget * 100)]}
            onValueChange={([value]) =>
              update({ learning: { ...settings.learning, retentionTarget: value / 100 } })
            }
          />
        </Field>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3 text-sm">
          <Label htmlFor="show-l1" className="text-sm text-foreground">
            显示中文释义
          </Label>
          <Switch
            id="show-l1"
            data-testid="show-l1"
            checked={settings.learning.showL1}
            onCheckedChange={(checked) =>
              update({ learning: { ...settings.learning, showL1: checked } })
            }
          />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-5">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <h2 className="text-lg font-semibold">用户档案</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          每个用户拥有独立的学习数据（词库、复习记录、覆盖率）；大模型与决策模型配置为全局共享。
          用户列表与切换见顶部导航栏。
        </p>
        <div className="space-y-1 text-sm">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background/50 px-3 py-2"
            >
              <span>{user.name}</span>
              <span className="text-xs text-muted-foreground">
                {user.id === userId ? '当前' : new Date(user.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold text-destructive">危险操作</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          清空「{users.find((u) => u.id === userId)?.name ?? '当前用户'}」的词库与全部学习记录（不可恢复，不影响其他用户）。
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => {
              if (confirmReset) {
                void resetCurrentUser();
                setConfirmReset(false);
              } else {
                setConfirmReset(true);
              }
            }}
            className="rounded-lg border border-destructive/50 px-3 py-1.5 text-sm text-destructive"
          >
            {confirmReset ? '再次点击确认清空' : '清空当前用户并重新播种'}
          </button>
          {confirmReset && (
            <button
              onClick={() => setConfirmReset(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
            >
              取消
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** S-005：LLM 调用记录（每人独立，便于排查"只有我这儿不通"） */
function LlmUsageSection({ userId }: { userId: string | null }) {
  const [logs, setLogs] = useState<LlmUsageLog[]>([]);

  const refresh = async () => {
    if (!userId) return;
    const { llmRepo } = await import('@/lib/db');
    setLogs(await llmRepo.recent(userId, 10));
  };

  useEffect(() => {
    void refresh();
  }, [userId]);

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">最近调用（LLM）</h2>
        <button
          data-testid="refresh-llm-logs"
          onClick={() => void refresh()}
          className="rounded-lg border border-border bg-background/60 px-2 py-1 text-xs"
        >
          刷新
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无记录。测试连通或解析单词后会出现在这里。</p>
      ) : (
        <ul className="space-y-1 text-xs" data-testid="llm-logs">
          {logs.map((log) => (
            <li
              key={log.seq}
              className="flex flex-wrap items-center gap-2 rounded-md bg-background/50 px-2 py-1.5"
            >
              <span className={log.ok ? 'text-emerald-400' : 'text-destructive'}>
                {log.ok ? (log.cached ? '缓存命中' : '成功') : '失败'}
              </span>
              <span className="text-muted-foreground">
                {new Date(log.at).toLocaleTimeString('zh-CN')}
              </span>
              <span className="text-muted-foreground">{log.provider}</span>
              <span className="tabular-nums text-muted-foreground">{log.durationMs}ms</span>
              {log.error && <span className="w-full text-destructive/80">{log.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
