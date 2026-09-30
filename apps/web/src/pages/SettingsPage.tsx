import { useContext, useEffect, useState } from 'react';
import { ToastContext } from '../App';
import { CheckCircle2, ChevronDown, ChevronUp, Coins, Database, FlaskConical, Gauge, Loader2, Plug, Plus, Power, RefreshCw, Server, Trash2, Wand2, Workflow, Wrench, XCircle } from 'lucide-react';
import { api } from '../api/client';
import type { AppSettings, CustomIntent, CustomPromptTool, McpServerInfo, McpToolInfo, ModelProvider, PipelineStepConfig, QualityWeightItem, SelfCheck } from '../types';
import { Badge, Button, Card, CollapsibleCard, ErrorBox, Input, Modal, SectionTitle, Select, Spinner, Textarea, errMsg } from '../components/ui';
import { Donut, HBar, LineChart, MetricCard } from '../components/charts';

/** 数字缩写格式化：12345 -> "12.3k" */
const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
/** 千分位整数 */
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');

interface UsageSummary {
  total: { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; avg_latency_ms: number; success_rate: number };
  byCaller: { caller: string; calls: number; total_tokens: number; success_rate: number }[];
  byDay: { day: string; calls: number; total_tokens: number }[];
}

/** 国内厂商 / 本地模型一键填充预设（OpenAI 兼容协议，Ollama 无需 API Key） */
const QUICK_PROVIDERS = [
  { name: '豆包·火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'agnes-3.0-flash' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

export function SettingsPage() {
  const toast = useContext(ToastContext);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [check, setCheck] = useState<SelfCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; reply: string; model: string; latencyMs: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [mcpInfo, setMcpInfo] = useState<{ protocol: string; version: string; name: string; tools: number } | null>(null);
  const [mcpTools, setMcpTools] = useState<McpToolInfo[]>([]);
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const [toolResult, setToolResult] = useState<string>('');
  const [toolLoading, setToolLoading] = useState(false);
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [provForm, setProvForm] = useState({ name: '', baseUrl: '', apiKey: '', model: '' });
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [mcpServerForm, setMcpServerForm] = useState({ name: '', url: '' });
  const [externalTools, setExternalTools] = useState<{ name?: string; description?: string }[]>([]);
  const [externalResult, setExternalResult] = useState<string>('');
  const [activeServerId, setActiveServerId] = useState('');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [intents, setIntents] = useState<CustomIntent[]>([]);
  const [intentForm, setIntentForm] = useState({ key: '', label: '', route: '/literature', keywords: '' });
  const [intentEditing, setIntentEditing] = useState<string | null>(null);
  const [promptTools, setPromptTools] = useState<CustomPromptTool[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<CustomPromptTool | null>(null);
  const [promptText, setPromptText] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ intent: false, prompt: false });
  const [judgmentMode, setJudgmentMode] = useState('auto');
  const [modeLoaded, setModeLoaded] = useState(false);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepConfig[]>([]);
  const [qualityWeights, setQualityWeights] = useState<QualityWeightItem[]>([]);
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      setSettings(await api.settings.get());
      setMcpInfo(await api.mcp.info());
      setMcpTools((await api.mcp.tools()).tools);
      setProviders(await api.settings.listProviders());
      setIntents(await api.customization.listIntents());
      setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
      setMcpServers(await api.settings.listMcpServers());
      api.usage.summary().then(setUsage).catch(() => undefined);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setError('');
    try {
      setCheck(await api.settings.check());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const testModel = async () => {
    if (!model) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.settings.testModel(model));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };

  const ModelIcon = ({ ok }: { ok?: boolean }) =>
    ok === undefined ? null : ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-rose-500" />;

  return (
    <div className="max-w-4xl mx-auto">
      <ErrorBox message={error} />

      {/* AI 配置总览 */}
      <Card className="p-5 mb-4">
        <SectionTitle
          extra={
            <Button variant="outline" onClick={load}>
              <RefreshCw size={14} /> 刷新
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Plug size={16} className="text-teal-600" /> AI 服务配置
          </span>
        </SectionTitle>
        {!settings ? (
          <Spinner label="加载配置…" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">接口地址 (Base URL)</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200 break-all">{settings.ai.baseUrl}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">当前模型</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{settings.ai.model}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">API Key 状态</div>
              <div className="text-sm flex items-center gap-1.5">
                <ModelIcon ok={settings.ai.configured} />
                {settings.ai.configured ? '已配置（apps/server/.env）' : '未配置 → 编辑 apps/server/.env'}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">可用模型（实时拉取）</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{settings.ai.models.join(' · ')}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">运行环境</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">Node {settings.env.node} · 端口 {settings.env.port}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">文献数据源</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{settings.sources.literature.join(' + ')}</div>
            </div>
          </div>
        )}
      </Card>

      {/* LLM 调用成本统计（token 用量审计仪表盘） */}
      {usage && (
        <Card className="p-5 mb-4">
          <SectionTitle
            extra={
              <Button variant="outline" className="text-xs px-2 py-1" onClick={() => api.usage.summary().then(setUsage).catch(() => undefined)}>
                <RefreshCw size={12} /> 刷新
              </Button>
            }
          >
            <span className="flex items-center gap-2">
              <Coins size={16} className="text-teal-600" /> LLM 用量与成本
            </span>
          </SectionTitle>
          {(() => {
            const byDayAsc = [...usage.byDay].sort((a, b) => a.day.localeCompare(b.day));
            return (
              <>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <MetricCard
                    label="调用次数"
                    value={usage.total.calls.toLocaleString()}
                    hint="统计周期内 LLM 总调用"
                    tone="brand"
                    spark={byDayAsc.map((d) => d.calls)}
                  />
                  <MetricCard
                    label="总 Token"
                    value={fmtK(usage.total.total_tokens)}
                    hint={`入 ${usage.total.prompt_tokens.toLocaleString()} · 出 ${usage.total.completion_tokens.toLocaleString()}`}
                    tone="slate"
                    spark={byDayAsc.map((d) => d.total_tokens)}
                  />
                  <MetricCard
                    label="成功率"
                    value={`${usage.total.success_rate}%`}
                    hint="成功调用 / 总调用"
                    tone="green"
                  />
                  <MetricCard
                    label="平均延迟"
                    value={`${usage.total.avg_latency_ms}ms`}
                    hint="单次 LLM 往返耗时"
                    tone="amber"
                  />
                </div>

                {usage.byDay.length > 0 && (
                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">近 14 天调用次数趋势</div>
                      <LineChart
                        points={byDayAsc.map((d) => ({ label: d.day.slice(5), value: d.calls }))}
                        height={130}
                        formatY={fmtInt}
                      />
                    </div>
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">近 14 天 Token 消耗趋势</div>
                      <LineChart
                        points={byDayAsc.map((d) => ({ label: d.day.slice(5), value: d.total_tokens }))}
                        height={130}
                        formatY={fmtK}
                      />
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Token 入 / 出占比</div>
                    <Donut
                      size={120}
                      centerValue={fmtK(usage.total.total_tokens)}
                      centerLabel="总 Token"
                      segments={[
                        { label: '输入 Prompt', value: usage.total.prompt_tokens },
                        { label: '输出 Completion', value: usage.total.completion_tokens },
                      ]}
                    />
                  </div>
                  {usage.byCaller.length > 0 && (
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">按任务类型分布（Token 占用）</div>
                      <HBar
                        items={[...usage.byCaller]
                          .sort((a, b) => b.total_tokens - a.total_tokens)
                          .slice(0, 8)
                          .map((c) => ({
                            label: c.caller,
                            value: c.total_tokens,
                            formatValue: fmtK,
                            sub: `${c.success_rate}% 成功`,
                            hint: `${c.caller}：${c.calls} 次调用 · ${c.success_rate}% 成功`,
                          }))}
                      />
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </Card>
      )}

      {/* 模型路由（Phase 0b） */}
      {settings && (
        <Card className="p-5 mb-4">
          <SectionTitle>
            <span className="flex items-center gap-2">
              <FlaskConical size={16} className="text-teal-600" /> 模型路由（fast / strong 双档）
            </span>
          </SectionTitle>
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
            简单任务（问答/综述/润色/翻译）走 fast 档；高难任务（规划/长文起草/质量评审）自动路由到 strong 档，可在 apps/server/.env 配置 AI_MODEL_FAST / AI_MODEL_STRONG
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Fast 档（轻量快速）</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{settings.ai.fastModel}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">科研问答 · 综述 · 润色 · 翻译 · 提取 · 证据综合</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Strong 档（高难任务）</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{settings.ai.strongModel}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">研究规划 · 大纲 · 长文起草 · 质量评审</div>
            </div>
          </div>
        </Card>
      )}

      {/* 模型厂商管理（LiteLLM 式多厂商切换） */}
      <Card className="p-5 mb-4">
        <SectionTitle
          extra={
            <Button
              variant="outline"
              disabled={!provForm.name || !provForm.baseUrl || !provForm.model}
              onClick={async () => {
                try {
                  await api.settings.saveProvider(provForm);
                  setProvForm({ name: '', baseUrl: '', apiKey: '', model: '' });
                  setProviders(await api.settings.listProviders());
      setIntents(await api.customization.listIntents());
      setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
                  setSettings(await api.settings.get());
                } catch (e: any) {
                  setError(errMsg(e));
                }
              }}
            >
              <Plug size={14} /> 添加厂商
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Server size={16} className="text-teal-600" /> 模型厂商管理（可插拔多模型）
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          配置任意 OpenAI 兼容厂商（国内 / 本地一键填充），激活后立即切换所有 AI 调用的模型
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {QUICK_PROVIDERS.map((q) => (
            <button
              key={q.name}
              type="button"
              className="text-xs rounded-full border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 px-2.5 py-1 hover:bg-teal-100 dark:hover:bg-teal-900/40"
              onClick={() => setProvForm((f) => ({ ...f, name: q.name, baseUrl: q.baseUrl, model: q.model }))}
            >
              {q.name}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="厂商名（如 DeepSeek）" value={provForm.name} onChange={(e) => setProvForm({ ...provForm, name: e.target.value })} />
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="Base URL（…/v1）" value={provForm.baseUrl} onChange={(e) => setProvForm({ ...provForm, baseUrl: e.target.value })} />
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="API Key" type="password" value={provForm.apiKey} onChange={(e) => setProvForm({ ...provForm, apiKey: e.target.value })} />
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="模型名（如 deepseek-chat）" value={provForm.model} onChange={(e) => setProvForm({ ...provForm, model: e.target.value })} />
        </div>
        {providers.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">暂无自定义厂商，当前使用 apps/server/.env 的配置</div>
        ) : (
          <div className="space-y-1.5">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${p.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="font-medium text-slate-700 dark:text-slate-200 w-28 truncate">{p.name}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate">{p.model} · {p.baseUrl}</span>
                {p.isActive ? (
                  <Badge tone="green">激活中</Badge>
                ) : (
                  <Button
                    variant="outline"
                    className="text-xs px-2 py-1"
                    onClick={async () => {
                      try {
                        await api.settings.activateProvider(p.id);
                        setProviders(await api.settings.listProviders());
      setIntents(await api.customization.listIntents());
      setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
                        setSettings(await api.settings.get());
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    激活
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="text-xs px-2 py-1 text-rose-500"
                  onClick={async () => {
                    await api.settings.removeProvider(p.id);
                    setProviders(await api.settings.listProviders());
      setIntents(await api.customization.listIntents());
      setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
                  }}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 环境自检 */}
      <Card className="p-5 mb-4">
        <SectionTitle
          extra={
            <Button onClick={runCheck} disabled={checking}>
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Server size={14} />} 运行自检
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Database size={16} className="text-teal-600" /> 环境自检
          </span>
        </SectionTitle>
        {check && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm">
              <ModelIcon ok={check.database.ok} />
              <span className="text-slate-600 dark:text-slate-300">数据库</span>
              <span className="text-slate-400 dark:text-slate-500 text-xs truncate">{check.database.path}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm">
              <ModelIcon ok={check.ai.ok} />
              <span className="text-slate-600 dark:text-slate-300">AI 连通性（{check.ai.model}）</span>
              <span className={`text-xs ${check.ai.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
                {check.ai.ok ? `${check.ai.latencyMs}ms · ${check.ai.detail}` : check.ai.detail}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* 模型连接测试 */}
      <Card className="p-5">
        <SectionTitle
          extra={
            <Button onClick={testModel} disabled={testing || !model} variant="success">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} 测试模型
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <FlaskConical size={16} className="text-teal-600" /> 模型连接测试
          </span>
        </SectionTitle>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">选择模型实测连通性</div>
            <Select
              className="w-full"
              options={[
                { value: '', label: '选择模型…' },
                ...(settings?.ai.models || []).map((m) => ({ value: m, label: m })),
              ]}
              value={model}
              onChange={setModel}
            />
          </div>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            <div className="flex items-center gap-2 font-medium">
              <ModelIcon ok={testResult.ok} />
              {testResult.model} · {testResult.latencyMs}ms
            </div>
            <div className="mt-1 text-slate-600 dark:text-slate-300">{testResult.reply}</div>
          </div>
        )}
      </Card>

      {/* MCP 工具台（Phase 0a：工具协议化） */}
      <Card className="p-5 mt-4">
        <SectionTitle
          extra={
            <Badge tone="teal">
              {mcpInfo ? `${mcpInfo.protocol} v${mcpInfo.version} · ${mcpInfo.tools} 工具` : '…'}
            </Badge>
          }
        >
          <span className="flex items-center gap-2">
            <Wrench size={16} className="text-teal-600" /> MCP 工具台
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          SciFlow 的全部 AI 能力已协议化为标准 MCP 工具（Model Context Protocol 2026-07 规范），可被任意 MCP 兼容客户端动态发现与调用
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {mcpTools.map((t) => (
            <div key={t.name} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-semibold text-teal-700">{t.name}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2">{t.description}</div>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                  placeholder={Object.keys(t.inputSchema?.properties || {}).join(', ')}
                  value={toolArgs[t.name] || ''}
                  onChange={(e) => setToolArgs((s) => ({ ...s, [t.name]: e.target.value }))}
                />
                <Button
                  variant="outline"
                  className="px-2 py-1 text-xs"
                  disabled={toolLoading}
                  onClick={async () => {
                    setToolLoading(true);
                    setToolResult('');
                    try {
                      const args: Record<string, any> = {};
                      const keys = Object.keys(t.inputSchema?.properties || {});
                      keys.forEach((k, i) => {
                        const raw = (toolArgs[t.name] || '').split(/[,，]/)[i];
                        if (raw !== undefined && raw !== '') args[k] = raw;
                      });
                      const res = await api.mcp.call(t.name, args);
                      setToolResult(JSON.stringify(res.content?.[0]?.text ?? res, null, 2).slice(0, 1200));
                    } catch (e: any) {
                      setToolResult('调用失败: ' + e.message);
                    } finally {
                      setToolLoading(false);
                    }
                  }}
                >
                  <FlaskConical size={11} /> 调用
                </Button>
              </div>
            </div>
          ))}
        </div>
        {toolResult && (
          <Textarea className="mt-3 font-mono text-xs" rows={5} readOnly value={toolResult} />
        )}
      </Card>

      {/* 外部 MCP 服务器（工具生态互通） */}
      <Card className="p-5 mt-4">
        <SectionTitle
          extra={
            <Button
              variant="outline"
              disabled={!mcpServerForm.name || !mcpServerForm.url}
              onClick={async () => {
                try {
                  await api.settings.saveMcpServer(mcpServerForm);
                  setMcpServerForm({ name: '', url: '' });
                  setMcpServers(await api.settings.listMcpServers());
                } catch (e: any) {
                  setError(errMsg(e));
                }
              }}
            >
              <Plug size={14} /> 添加服务器
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Wrench size={16} className="text-teal-600" /> 外部 MCP 服务器
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          接入任意 MCP 兼容服务（本机 SciFlow / 其他 Agent 的 MCP 端点），协议互通：GET /tools 发现工具、POST /call 调用
        </div>
        <div className="grid sm:grid-cols-2 gap-2 mb-3">
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="名称（如 本地SciFlow）" value={mcpServerForm.name} onChange={(e) => setMcpServerForm({ ...mcpServerForm, name: e.target.value })} />
          <input className="rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-sm" placeholder="URL（如 http://localhost:3000/api/mcp）" value={mcpServerForm.url} onChange={(e) => setMcpServerForm({ ...mcpServerForm, url: e.target.value })} />
        </div>
        {mcpServers.map((ms) => (
          <div key={ms.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm mb-1.5">
            <span className={`w-2 h-2 rounded-full ${ms.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="font-medium text-slate-700 dark:text-slate-200 w-28 truncate">{ms.name}</span>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate">{ms.url}</span>
            <Button
              variant="outline"
              className="text-xs px-2 py-1"
              onClick={async () => {
                try {
                  const d = await api.mcpExternal.discover(ms.url);
                  setActiveServerId(ms.id);
                  setExternalTools(d.tools);
                  setExternalResult(`「${ms.name}」发现 ${d.tools.length} 个工具`);
                } catch (e: any) {
                  setExternalResult('探测失败: ' + e.message);
                }
              }}
            >
              探测工具
            </Button>
            <Button
              variant="ghost"
              className="text-xs px-2 py-1 text-rose-500"
              onClick={async () => {
                await api.settings.removeMcpServer(ms.id);
                setMcpServers(await api.settings.listMcpServers());
              }}
            >
              删除
            </Button>
          </div>
        ))}
        {externalTools.length > 0 && (
          <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1.5">{externalResult} —— 选择工具调用（参数用逗号分隔）</div>
            <div className="space-y-1.5">
              {externalTools.map((t) => (
                <div key={t.name} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-teal-700 w-40 truncate">{t.name}</span>
                  <input
                    className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs"
                    placeholder={(t.description || '').slice(0, 40)}
                  />
                  <Button
                    variant="outline"
                    className="text-xs px-2 py-1"
                    onClick={async () => {
                      try {
                        const res = await api.mcpExternal.call(activeServerId, t.name || '', {});
                        setExternalResult(JSON.stringify(res, null, 2).slice(0, 600));
                      } catch (e: any) {
                        setExternalResult('调用失败: ' + e.message);
                      }
                    }}
                  >
                    调用
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {externalResult && !externalTools.length && (
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded p-2">{externalResult}</div>
        )}
      </Card>

      {/* ===== 自定义中心（默认折叠 · 渐进披露） ===== */}

      {/* · 意图识别自定义（可折叠） */}
      <CollapsibleCard
        icon={<Wand2 size={16} className="text-teal-600" />}
        title="意图识别自定义"
        summary={intents.length > 0 ? `已自定义 ${intents.length} 个意图` : '使用系统内置 17 个意图'}
        right={
          <span className="text-[11px] text-slate-400">
            判断模式：{judgmentMode === 'auto' ? '规则优先 + LLM 兜底' : judgmentMode === 'rule_first' ? '规则优先' : judgmentMode === 'llm_first' ? 'LLM 优先' : '仅规则'}
          </span>
        }
        open={openSections.intent}
        onToggle={() => setOpenSections((o) => ({ ...o, intent: !o.intent }))}
      >
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 w-24 shrink-0">意图判断模式</span>
              <select
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
                value={judgmentMode}
                onChange={async (e) => {
                  const mode = e.target.value;
                  setJudgmentMode(mode);
                  await api.customization.setJudgmentMode(mode);
                  toast('success', `判断模式已切换：${mode === 'auto' ? '规则优先 + LLM 兜底' : mode === 'rule_first' ? '规则优先' : mode === 'llm_first' ? 'LLM 优先' : '仅规则'}`);
                }}
              >
                <option value="auto">自动（规则优先 + LLM 兜底，推荐）</option>
                <option value="rule_first">规则优先（未命中再调 LLM）</option>
                <option value="llm_first">LLM 优先（更灵活，耗 token）</option>
                <option value="rule_only">仅规则（零成本，未命中一律问答）</option>
              </select>
            </div>
            <div className="text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded px-3 py-2">
              自定义科研动作意图：新增意图后，科研问答识别时优先命中你的关键词（Jev 式规则秒判）。系统内置 17 个意图不可删除，但可用同 key 覆盖。
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <Input placeholder="意图标识（如 meta_analysis）" value={intentForm.key} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIntentForm({ ...intentForm, key: e.target.value })} />
              <Input placeholder="中文标签（如 Meta 分析）" value={intentForm.label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIntentForm({ ...intentForm, label: e.target.value })} />
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-2 text-xs bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
                value={intentForm.route}
                onChange={(e) => setIntentForm({ ...intentForm, route: e.target.value })}
              >
                <option value="/literature">文献调研</option>
                <option value="/writing">论文写作</option>
                <option value="/pipeline">全自动流水线</option>
                <option value="/quality">质量评分</option>
                <option value="/chat">科研问答</option>
              </select>
              <Input placeholder="触发词，逗号分隔（如 meta分析,荟萃分析）" value={intentForm.keywords} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIntentForm({ ...intentForm, keywords: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                className="text-xs"
                disabled={!intentForm.key || !intentForm.label}
                onClick={async () => {
                  try {
                    await api.customization.createIntent({
                      key: intentForm.key,
                      label: intentForm.label,
                      route: intentForm.route,
                      keywords: intentForm.keywords.split(/[,，\s]+/).filter(Boolean),
                    });
                    setIntentForm({ key: '', label: '', route: '/literature', keywords: '' });
                    setIntents(await api.customization.listIntents());
                    toast('success', '自定义意图已生效');
                  } catch (e: any) {
                    setError(errMsg(e));
                  }
                }}
              >
                <Plus size={13} /> 新增意图
              </Button>
              <span className="text-[11px] text-slate-400">{intents.length} 个自定义意图</span>
            </div>
            {intents.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">暂无自定义意图（系统内置 17 个科研意图默认生效）</div>
            ) : (
              <div className="space-y-1.5">
                {intents.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                    <Badge tone={it.enabled ? 'teal' : 'slate'}>{it.enabled ? '启用' : '停用'}</Badge>
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{it.label}</span>
                    <span className="text-[11px] text-slate-400">{it.key} · {it.route}</span>
                    <span className="text-[11px] text-slate-400 truncate flex-1">
                      {(() => { try { return JSON.parse(it.keywords).join('、'); } catch { return it.keywords; } })()}
                    </span>
                    <button
                      className="text-slate-300 hover:text-teal-600"
                      onClick={async () => {
                        try {
                          await api.customization.updateIntent(it.id, { enabled: it.enabled ? 0 : 1 });
                          setIntents(await api.customization.listIntents());
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      <Power size={13} />
                    </button>
                    <button className="text-slate-300 hover:text-rose-500" onClick={async () => {
                      try {
                        await api.customization.deleteIntent(it.id);
                        setIntents(await api.customization.listIntents());
                        toast('success', '自定义意图已删除');
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
      </CollapsibleCard>

      {/* · 科研工具提示词自定义（可折叠） */}
      <CollapsibleCard
        icon={<FlaskConical size={16} className="text-teal-600" />}
        title="科研工具提示词自定义"
        summary={(() => { const n = promptTools.filter((t) => t.customized).length; return n > 0 ? `${n}/${promptTools.length} 个已自定义` : '全部使用系统默认'; })()}
        open={openSections.prompt}
        onToggle={() => setOpenSections((o) => ({ ...o, prompt: !o.prompt }))}
      >
          <div className="mt-4">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
              每个 AI 科研工具（综述/精读/缺口/对比/评审…）默认提示词可被你的自定义覆盖：点击「编辑」写入你的专属提示词（含你的领域规范/输出格式/风格要求），未配置时自动使用系统默认。
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {promptTools.map((t) => (
                <div key={t.toolKey} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.toolLabel}</span>
                  <span className="text-[11px] text-slate-400 truncate flex-1">{t.toolKey}</span>
                  <Badge tone={t.customized ? (t.enabled ? 'green' : 'amber') : 'slate'}>{t.customized ? (t.enabled ? '已自定义' : '已停用') : '系统默认'}</Badge>
                  <button
                    className="text-xs text-teal-600 hover:underline"
                    onClick={() => {
                      setEditingPrompt(t);
                      setPromptText(t.prompt);
                    }}
                  >
                    编辑
                  </button>
                  {t.customized && (
                    <button
                      className="text-slate-300 hover:text-rose-500"
                      onClick={async () => {
                        await api.customization.deletePrompt(t.toolKey);
                        setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
                        toast('success', `${t.toolLabel} 已恢复系统默认`);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
      </CollapsibleCard>

      {/* · 流水线步骤自定义（可折叠） */}
      <CollapsibleCard
        icon={<Workflow size={16} className="text-teal-600" />}
        title="流水线步骤自定义"
        summary={(() => { const off = pipelineSteps.filter((s) => !s.enabled).length; return off > 0 ? `${pipelineSteps.length - off}/${pipelineSteps.length} 步启用（${off} 步已关）` : '8 步全启用（默认）'; })()}
        open={openSections.pipeline}
        onToggle={() => setOpenSections((o) => ({ ...o, pipeline: !o.pipeline }))}
      >
          <div className="mt-4">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
              全自动流水线的 8 个阶段可自定义启停：关闭的步骤直接跳过（步骤显示「已禁用」）。
              「主题验证 / 分章起草 / 完成」为骨架步骤不可关闭。改动对之后新建的流水线生效。
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {pipelineSteps.map((st) => (
                <div key={st.key} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                  <button
                    className={`relative w-7 h-4 rounded-full transition-colors ${st.enabled ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'} ${st.core ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={async () => {
                      if (st.core) return;
                      try {
                        await api.customization.updatePipelineStep(st.key, st.enabled ? 0 : 1);
                        setPipelineSteps(await api.customization.listPipelineSteps());
                        toast('success', `${st.label} ${st.enabled ? '已停用' : '已启用'}`);
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${st.enabled ? 'left-3.5' : 'left-0.5'}`} />
                  </button>
                  <span className="text-xs text-slate-700 dark:text-slate-200">{st.label}</span>
                  <span className="text-[11px] text-slate-400 flex-1">{st.key}</span>
                  {st.core ? (
                    <span className="text-[10px] text-slate-400">骨架</span>
                  ) : st.enabled ? (
                    <Badge tone="teal">启用</Badge>
                  ) : (
                    <Badge tone="slate">已禁用</Badge>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button
                variant="outline"
                className="text-xs"
                onClick={async () => {
                  await api.customization.resetPipelineSteps();
                  setPipelineSteps(await api.customization.listPipelineSteps());
                  toast('success', '已恢复 8 步全启用');
                }}
              >
                恢复默认（8 步全启用）
              </Button>
            </div>
          </div>
      </CollapsibleCard>

      {/* · 质量评分权重自定义（可折叠） */}
      <CollapsibleCard
        icon={<Gauge size={16} className="text-teal-600" />}
        title="质量评分权重自定义"
        summary={qualityWeights.every((x) => x.weight === 1) ? '7 维等权（默认）' : '已自定义加权'}
        open={openSections.weights}
        onToggle={() => setOpenSections((o) => ({ ...o, weights: !o.weights }))}
      >
          <div className="mt-4">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
              论文质量总分 = 各维度得分 × 权重 的加权平均。默认 7 维等权（各 1），可按你的评审偏好加大某维度影响力（如更看重「新颖」）。
            </div>
            <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {qualityWeights.map((d) => (
                <div key={d.key} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                  <span className="text-xs text-slate-700 dark:text-slate-200 w-12">{d.label}</span>
                  <Input
                    className="w-20"
                    value={weightInputs[d.key] ?? String(d.weight)}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWeightInputs((o) => ({ ...o, [d.key]: e.target.value }))}
                  />
                  <span className="text-[11px] text-slate-400">×</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">权重分布预览（按当前输入实时归一）</div>
              <HBar
                items={qualityWeights.map((d) => ({
                  label: d.label,
                  value: Number(weightInputs[d.key] ?? d.weight) || 0,
                  hint: `${d.label}：权重 ×${weightInputs[d.key] ?? d.weight}`,
                }))}
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                className="text-xs"
                onClick={async () => {
                  try {
                    const weights: Record<string, number> = {};
                    for (const d of qualityWeights) {
                      const v = Number(weightInputs[d.key]);
                      if (!Number.isFinite(v) || v <= 0 || v > 5) {
                        setError(`${d.label} 权重需在 (0,5] 之间`);
                        return;
                      }
                      weights[d.key] = v;
                    }
                    await api.customization.setQualityWeights(weights);
                    setQualityWeights(await api.customization.listQualityWeights());
                    toast('success', '评分权重已保存（影响之后的质量评分）');
                  } catch (e: any) {
                    setError(errMsg(e));
                  }
                }}
              >
                保存权重
              </Button>
              <Button
                variant="outline"
                className="text-xs"
                onClick={async () => {
                  const w = qualityWeights.map((x) => ({ ...x, weight: 1 }));
                  await api.customization.setQualityWeights(Object.fromEntries(w.map((x) => [x.key, 1])));
                  setQualityWeights(await api.customization.listQualityWeights());
                  setWeightInputs(Object.fromEntries(w.map((x) => [x.key, '1'])));
                  toast('success', '已恢复 7 维等权');
                }}
              >
                恢复等权
              </Button>
            </div>
          </div>
      </CollapsibleCard>

      {/* 提示词编辑弹窗 */}
      {editingPrompt && (
        <Modal open onClose={() => setEditingPrompt(null)} title={`编辑提示词 · ${editingPrompt.toolLabel}`}>
          <Textarea
            rows={8}
            className="mb-3"
            placeholder="在这里编写自定义提示词…（建议包含：角色、任务、输入格式、输出 JSON 结构要求）"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="text-xs" onClick={() => setEditingPrompt(null)}>
              取消
            </Button>
            <Button
              className="text-xs"
              disabled={!promptText.trim()}
              onClick={async () => {
                try {
                  await api.customization.upsertPrompt(editingPrompt.toolKey, promptText);
                  setPromptTools(await api.customization.listPrompts());
      setPipelineSteps(await api.customization.listPipelineSteps());
      const w = await api.customization.listQualityWeights();
      setQualityWeights(w);
      setWeightInputs(Object.fromEntries(w.map((x) => [x.key, String(x.weight)])));
      const mode = await api.customization.getJudgmentMode();
      setJudgmentMode(mode.mode);
      setModeLoaded(true);
                  setEditingPrompt(null);
                  toast('success', `${editingPrompt.toolLabel} 提示词已保存`);
                } catch (e: any) {
                  setError(errMsg(e));
                }
              }}
            >
              保存
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}