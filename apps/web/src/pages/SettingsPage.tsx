import { useEffect, useState } from 'react';
import { CheckCircle2, Coins, Database, FlaskConical, Gauge, Loader2, Plug, RefreshCw, Server, Wrench, XCircle } from 'lucide-react';
import { api } from '../api/client';
import type { AppSettings, McpServerInfo, McpToolInfo, ModelProvider, SelfCheck } from '../types';
import { Badge, Button, Card, ErrorBox, SectionTitle, Select, Spinner, Textarea } from '../components/ui';

interface UsageSummary {
  total: { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; avg_latency_ms: number; success_rate: number };
  byCaller: { caller: string; calls: number; total_tokens: number; success_rate: number }[];
  byDay: { day: string; calls: number; total_tokens: number }[];
}

export function SettingsPage() {
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

  const load = async () => {
    try {
      setSettings(await api.settings.get());
      setMcpInfo(await api.mcp.info());
      setMcpTools((await api.mcp.tools()).tools);
      setProviders(await api.settings.listProviders());
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
          <div className="grid sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">调用次数</div>
              <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">{usage.total.calls}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">总 Token</div>
              <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">{(usage.total.total_tokens / 1000).toFixed(1)}k</div>
              <div className="text-[10px] text-slate-400">入 {usage.total.prompt_tokens.toLocaleString()} · 出 {usage.total.completion_tokens.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">成功率</div>
              <div className="text-lg font-semibold text-emerald-600">{usage.total.success_rate}%</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">平均延迟</div>
              <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">{usage.total.avg_latency_ms}ms</div>
            </div>
          </div>
          {usage.byCaller.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">按任务类型分布（Token 占比）</div>
              <div className="space-y-1.5">
                {usage.byCaller.slice(0, 8).map((c) => {
                  const pct = usage.total.total_tokens ? Math.round((c.total_tokens / usage.total.total_tokens) * 100) : 0;
                  return (
                    <div key={c.caller} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 text-slate-600 dark:text-slate-300 truncate">{c.caller}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-slate-400 dark:text-slate-500">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {usage.byDay.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">近 14 天调用趋势</div>
              <div className="flex items-end gap-1 h-16">
                {[...usage.byDay].reverse().map((d) => {
                  const max = Math.max(...usage.byDay.map((x) => x.calls), 1);
                  const h = Math.max(4, Math.round((d.calls / max) * 56));
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.calls} 次 / ${d.total_tokens.toLocaleString()} tokens`}>
                      <div className="w-full rounded-t bg-teal-500/80" style={{ height: h }} />
                      <div className="text-[9px] text-slate-400">{d.day.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                  setSettings(await api.settings.get());
                } catch (e: any) {
                  setError(e.message);
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
          配置任意 OpenAI 兼容厂商（OpenAI / DeepSeek / 通义 / 豆包 / Agnes…），激活后立即切换所有 AI 调用的模型
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
                  setError(e.message);
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
    </div>
  );
}
