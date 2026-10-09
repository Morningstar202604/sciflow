import { useEffect, useState } from 'react';
import { Coins, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { Card, SectionTitle, Button } from '../../components/ui';
import { Donut, HBar, LineChart, MetricCard } from '../../components/charts';
import type { UsageSummary } from './settings-context';

const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

export function UsageStats() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const load = () => api.usage.summary().then(setUsage).catch(() => undefined);

  useEffect(() => { load(); }, []);

  if (!usage) return null;

  const byDayAsc = [...usage.byDay].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <Card className="p-5 mb-4">
      <SectionTitle
        extra={
          <Button variant="outline" className="text-xs px-2 py-1" onClick={load}>
            <RefreshCw size={12} /> 刷新
          </Button>
        }
      >
        <span className="flex items-center gap-2">
          <Coins size={16} className="text-teal-600" /> LLM 用量与成本
        </span>
      </SectionTitle>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <MetricCard label="调用次数" value={usage.total.calls.toLocaleString()} accent="brand" />
        <MetricCard label="总 Token" value={fmtK(usage.total.total_tokens)} accent="sky" />
        <MetricCard label="成功率" value={`${usage.total.success_rate}%`} accent="emerald" />
        <MetricCard label="平均延迟" value={`${usage.total.avg_latency_ms}ms`} accent="amber" />
      </div>

      {usage.byDay.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">近 14 天调用次数趋势</div>
            <LineChart
              data={byDayAsc.map((d) => ({ label: d.day.slice(5), value: d.calls }))}
              series={[{ dataKey: 'value', name: '调用次数', color: 'var(--brand-400)' }]}
              height={130}
            />
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">近 14 天 Token 消耗趋势</div>
            <LineChart
              data={byDayAsc.map((d) => ({ label: d.day.slice(5), tokens: d.total_tokens }))}
              series={[{ dataKey: 'tokens', name: 'Token', color: 'var(--brand-500)' }]}
              height={130}
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
            data={[
              { name: '输入 Prompt', value: usage.total.prompt_tokens },
              { name: '输出 Completion', value: usage.total.completion_tokens },
            ]}
          />
        </div>
        {usage.byCaller.length > 0 && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">按任务类型分布</div>
            <HBar
              data={[...usage.byCaller]
                .sort((a, b) => b.total_tokens - a.total_tokens)
                .slice(0, 8)
                .map((c) => ({
                  name: c.caller,
                  value: c.total_tokens,
                }))}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
