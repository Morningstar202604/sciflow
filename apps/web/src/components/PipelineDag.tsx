import type { PipelineStep } from '../types';
import { Check, CircleDashed, Loader2, RotateCcw, XCircle, MinusCircle, Circle } from 'lucide-react';

/**
 * PipelineDag — 流水线 DAG 实时图（F-2.1）
 * 自绘轻量 SVG 纵向流程图：节点=步骤，状态着色，retry 徽标，回炉循环以"回边"可视化
 * （quality-gate → 起草 的重试回路是 Reflexion 语义的关键可视化）。
 * 零新依赖：纯 SVG + lucide，数据直接来自 PipelineStep[]（轮询刷新即实时）。
 */

const STATUS_STYLE: Record<string, { stroke: string; fill: string; text: string; label?: string }> = {
  pending: { stroke: '#cbd5e1', fill: '#f8fafc', text: 'text-slate-400' },
  running: { stroke: '#0d9488', fill: '#f0fdfa', text: 'text-teal-700' },
  awaiting_confirmation: { stroke: '#f59e0b', fill: '#fffbeb', text: 'text-amber-600' },
  done: { stroke: '#16a34a', fill: '#f0fdf4', text: 'text-green-700' },
  scored: { stroke: '#16a34a', fill: '#f0fdf4', text: 'text-green-700' },
  retry: { stroke: '#e11d48', fill: '#fff1f2', text: 'text-rose-600' },
  failed: { stroke: '#e11d48', fill: '#fff1f2', text: 'text-rose-600' },
  skipped: { stroke: '#94a3b8', fill: '#f1f5f9', text: 'text-slate-400' },
};

function StatusIcon({ status }: { status: string }) {
  const cls = 'h-3.5 w-3.5';
  switch (status) {
    case 'done':
    case 'scored':
      return <Check className={`${cls} text-green-600`} aria-hidden="true" />;
    case 'running':
      return <Loader2 className={`${cls} animate-spin text-teal-600`} aria-hidden="true" />;
    case 'retry':
      return <RotateCcw className={`${cls} text-rose-500`} aria-hidden="true" />;
    case 'failed':
      return <XCircle className={`${cls} text-rose-600`} aria-hidden="true" />;
    case 'awaiting_confirmation':
      return <CircleDashed className={`${cls} text-amber-500`} aria-hidden="true" />;
    case 'skipped':
      return <MinusCircle className={`${cls} text-slate-400`} aria-hidden="true" />;
    default:
      return <Circle className={`${cls} text-slate-300`} aria-hidden="true" />;
  }
}

export function PipelineDag({ steps, currentStep }: { steps: PipelineStep[]; currentStep?: string }) {
  if (!steps.length) return null;
  const ROW_H = 44;
  const height = steps.length * ROW_H + 10;

  // 回炉回路检测：retry 状态的 quality-gate 意味着存在回到起草段的循环
  const gateIdx = steps.findIndex((s) => s.key === 'quality-gate');
  const litIdx = steps.findIndex((s) => s.key === 'literature');
  const docIdx = steps.findIndex((s) => s.key === 'doc-create');
  const hasLoop = gateIdx >= 0 && (steps[gateIdx]?.retryCount ?? 0) > 0 && litIdx >= 0 && docIdx >= 0;

  return (
    <div className="relative" role="img" aria-label="流水线步骤实时图">
      <svg width="26" height={height} className="absolute left-6 top-1" aria-hidden="true">
        {steps.map((s, i) =>
          i < steps.length - 1 ? (
            <line
              key={s.key}
              x1={13}
              y1={ROW_H * i + 30}
              x2={13}
              y2={ROW_H * (i + 1) + 14}
              stroke={STATUS_STYLE[s.status]?.stroke || '#cbd5e1'}
              strokeWidth={2}
              strokeDasharray={s.status === 'pending' ? '3 3' : undefined}
            />
          ) : null,
        )}
        {/* 回炉回边：quality-gate(重试) 沿右侧画弧线回到 doc-create/起草段 */}
        {hasLoop && docIdx >= 0 && gateIdx >= 0 && (
          <path
            d={`M 13 ${ROW_H * gateIdx + 22} C 24 ${ROW_H * gateIdx + 10}, 24 ${ROW_H * docIdx + 20}, 13 ${ROW_H * docIdx + 22}`}
            fill="none"
            stroke="#e11d48"
            strokeWidth={1.6}
            strokeDasharray="4 3"
            markerEnd="url(#dagArrow)"
          />
        )}
        <defs>
          <marker id="dagArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#e11d48" />
          </marker>
        </defs>
      </svg>
      <ol className="space-y-2.5">
        {steps.map((s) => {
          const st = STATUS_STYLE[s.status] || STATUS_STYLE.pending;
          const isCurrent = s.key === currentStep || s.status === 'running';
          return (
            <li key={s.key} className="flex items-center gap-3 pl-6 relative">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-slate-900 ${isCurrent ? 'brand-breathe' : ''}`}
                style={{ borderColor: st.stroke }}
              >
                <StatusIcon status={s.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-medium truncate ${isCurrent ? 'text-teal-700 dark:text-teal-300' : 'text-slate-600 dark:text-slate-300'}`}>
                    {s.label}
                  </span>
                  {(s.retryCount ?? 0) > 0 && (
                    <span className="text-[10px] px-1 rounded bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300">
                      回炉 ×{s.retryCount}
                    </span>
                  )}
                  {s.status === 'skipped' && <span className="text-[10px] text-slate-400">已跳过</span>}
                </div>
                {s.output && <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{s.output}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
