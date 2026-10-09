import { useState } from 'react';
import { Plug, Server, Plus } from 'lucide-react';
import type { AppSettings } from '../../types';
import { Badge, Button, Card, Input, Modal, SectionTitle } from '../../components/ui';
import { useSettings } from './settings-context';

/** 国内厂商 / 本地模型一键填充预设（OpenAI 兼容协议，Ollama 无需 API Key） */
const QUICK_PROVIDERS = [
  { name: '豆包·火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'agnes-3.0-flash' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

interface ProviderForm {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function ProviderManager({ settings }: { settings: AppSettings | null }) {
  const { state, saveProvider, activateProvider, removeProvider } = useSettings();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<ProviderForm>({ name: '', baseUrl: '', apiKey: '', model: '' });

  const submit = async () => {
    if (!form.name || !form.baseUrl || !form.model) return;
    await saveProvider(form);
    setForm({ name: '', baseUrl: '', apiKey: '', model: '' });
    setShowAdd(false);
  };

  return (
    <>
      {settings && (
        <Card className="p-5 mb-4">
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Server size={16} className="text-teal-600" /> 模型路由（fast / strong 双档）
            </span>
          </SectionTitle>
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

      <Card className="p-5 mb-4">
        <SectionTitle
          extra={
            <Button variant="outline" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> 添加厂商
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Plug size={16} className="text-teal-600" /> 模型厂商管理（可插拔多模型）
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          配置任意 OpenAI 兼容厂商（国内 / 本地一键填充），激活后立即切换所有 AI 调用的模型
        </div>
        {state.providers.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">暂无自定义厂商，当前使用 apps/server/.env 的配置</div>
        ) : (
          <div className="space-y-1.5">
            {state.providers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="font-medium text-slate-700 dark:text-slate-200 w-20 sm:w-28 truncate">{p.name}</span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate w-full sm:w-auto">{p.model} · {p.baseUrl}</span>
                {p.isActive ? (
                  <Badge tone="green">激活中</Badge>
                ) : (
                  <Button variant="outline" className="text-xs px-2 py-1" onClick={() => activateProvider(p.id)}>
                    激活
                  </Button>
                )}
                <Button variant="ghost" className="text-xs px-2 py-1 text-rose-500" onClick={() => removeProvider(p.id)}>
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showAdd} title="添加模型厂商" onClose={() => setShowAdd(false)}>
        <div className="mb-3">
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">一键填充预设</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROVIDERS.map((q) => (
              <button
                key={q.name}
                type="button"
                className="text-xs rounded-full border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 px-2.5 py-1 hover:bg-teal-100 dark:hover:bg-teal-900/40"
                onClick={() => setForm(f => ({ ...f, name: q.name, baseUrl: q.baseUrl, model: q.model }))}
              >
                {q.name}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Input placeholder="厂商名（如 DeepSeek）" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input placeholder="Base URL（…/v1）" value={form.baseUrl} onChange={(e) => setForm(f => ({ ...f, baseUrl: e.target.value }))} />
          <Input placeholder="API Key" type="password" value={form.apiKey} onChange={(e) => setForm(f => ({ ...f, apiKey: e.target.value }))} />
          <Input placeholder="模型名（如 deepseek-chat）" value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowAdd(false)}>取消</Button>
          <Button disabled={!form.name || !form.baseUrl || !form.model} onClick={submit}>
            <Plug size={14} /> 添加厂商
          </Button>
        </div>
      </Modal>
    </>
  );
}
