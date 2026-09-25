import { useEffect, useState } from 'react';
import { CheckCircle2, Database, FlaskConical, Loader2, Plug, RefreshCw, Server, XCircle } from 'lucide-react';
import { api } from '../api/client';
import type { AppSettings, SelfCheck } from '../types';
import { Button, Card, ErrorBox, SectionTitle, Select, Spinner } from '../components/ui';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [check, setCheck] = useState<SelfCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; reply: string; model: string; latencyMs: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setSettings(await api.settings.get());
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
            <Plug size={16} className="text-indigo-600" /> AI 服务配置
          </span>
        </SectionTitle>
        {!settings ? (
          <Spinner label="加载配置…" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">接口地址 (Base URL)</div>
              <div className="text-sm font-mono text-slate-700 break-all">{settings.ai.baseUrl}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">当前模型</div>
              <div className="text-sm font-mono text-slate-700">{settings.ai.model}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">API Key 状态</div>
              <div className="text-sm flex items-center gap-1.5">
                <ModelIcon ok={settings.ai.configured} />
                {settings.ai.configured ? '已配置（apps/server/.env）' : '未配置 → 编辑 apps/server/.env'}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">可用模型（实时拉取）</div>
              <div className="text-sm text-slate-700">{settings.ai.models.join(' · ')}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">运行环境</div>
              <div className="text-sm text-slate-700">Node {settings.env.node} · 端口 {settings.env.port}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="text-xs text-slate-400 mb-1">文献数据源</div>
              <div className="text-sm text-slate-700">{settings.sources.literature.join(' + ')}</div>
            </div>
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
            <Database size={16} className="text-indigo-600" /> 环境自检
          </span>
        </SectionTitle>
        {check && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <ModelIcon ok={check.database.ok} />
              <span className="text-slate-600">数据库</span>
              <span className="text-slate-400 text-xs truncate">{check.database.path}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <ModelIcon ok={check.ai.ok} />
              <span className="text-slate-600">AI 连通性（{check.ai.model}）</span>
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
            <FlaskConical size={16} className="text-indigo-600" /> 模型连接测试
          </span>
        </SectionTitle>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-xs text-slate-400 mb-1">选择模型实测连通性</div>
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
            <div className="mt-1 text-slate-600">{testResult.reply}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
