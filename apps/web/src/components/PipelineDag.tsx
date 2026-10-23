import type { PipelineStep } from '../types';
import { Check, CircleDashed, Loader2, RotateCcw, XCircle, MinusCircle, Circle } from 'lucide-react';

/**
 * PipelineDag — 流水线 DAG 实时图（F-2.1）
 * 自绘轻量 SVG 纵向流程图：节点=步骤，状态着色，retry 徽标，回炉循环以"回边"可视化
 * （quality-gate → 起草 的重试回路是 Reflexion 语义的关键可视化）。
 * 零新依赖：纯 SVG + lucide，数据直接来自 PipelineStep[]（轮询刷新即实时）。
 */

/**
 * 步骤 output 的一行摘要。
 *
 * 背景：graph 会把「大纲 JSON」「评分 JSON」直接写进 step.output。旧实现用 truncate
 * 展示原始字符串——但父级 flex 链上缺 overflow 约束，长 JSON 会把整行撑爆（实拍
 * 截图里 DAG 行高被一条大纲 JSON 拉成多行），且 `truncate` 的省略号对 JSON 前缀
 * 毫无信息量（用户只看到 `{"title":"...","sections":[{"title":"引言","subsections":[`）。
 * 这里按步骤类型抽取可读摘要，未知类型退化为单行压缩 + 硬截断。
 */
export function summarizeStepOutput(key: string, output: string, maxLen = 72): string {
  const raw = (output || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const clip = (s: string) => (s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (key === 'outline' && typeof parsed.title === 'string') {
      const sections = Array.isArray(parsed.sections) ? parsed.sections.length : 0;
      return clip(`${parsed.title}（${sections} 章）`);
    }
    if (key === 'quality-gate') {
      const total = parsed.totalScore ?? parsed.score ?? parsed.total;
      if (typeof total === 'number') return clip(`总分 ${total}/100`);
    }
  } catch {
    /* 非 JSON：走纯文本摘要 */
  }
  return clip(raw);
}

const STATUS_STYLE: Record<string, { stroke: string; fill: string; label?: string }> = {
  pending: { stroke: 'var(--border)', fill: 'transparent' },
  running: { stroke: 'var(--blue)', fill: 'color-mix(in srgb, var(--blue) 8%, transparent)' },
  awaiting_confirmation: { stroke: 'var(--orange)', fill: 'color-mix(in srgb, var(--orange) 8%, transparent)' },
  done: { stroke: 'var(--green)', fill: 'color-mix(in srgb, var(--green) 8%, transparent)' },
  scored: { stroke: 'var(--green)', fill: 'color-mix(in srgb, var(--green) 8%, transparent)' },
  retry: { stroke: 'var(--red)', fill: 'color-mix(in srgb, var(--red) 8%, transparent)' },
  failed: { stroke: 'var(--red)', fill: 'color-mix(in srgb, var(--red) 8%, transparent)' },
  skipped: { stroke: 'var(--muted-foreground)', fill: 'transparent' },
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

  // 回炉回路：Reflexion 是 quality-gate 节点内部的循环（重新起草→再评审），
  // 不是「回到大纲」。旧实现找不存在的 doc-create 导致从不画线；
  // 修成指向前一个步骤又会误导成「回到大纲生成」。这里改为在节点右侧画自环。
  const gateIdx = steps.findIndex((s) => s.key === 'quality-gate');
  const retryCount = gateIdx >= 0 ? (steps[gateIdx]?.retryCount ?? 0) : 0;
  const hasLoop = gateIdx >= 0 && retryCount > 0;

  return (
    <div className="relative" role="img" aria-label="流水线步骤实时图">
      <svg width="26" height={height} className="absolute left-6 top-1" aria-hidden="true">
        {steps.map((s, i) =>
          i < steps.length - 1 ? (
            <line
              key={s.key}
              x1="13"
              y1={ROW_H * i + 30}
              x2="13"
              y2={ROW_H * (i + 1) + 14}
              stroke={STATUS_STYLE[s.status]?.stroke || 'var(--border)'}
              strokeWidth={2}
              strokeDasharray={s.status === 'pending' ? '3 3' : undefined}
            />
          ) : null,
        )}
        {/* 回炉自环：在 quality-gate 节点右侧画一个小环，表示该节点内部重跑 */}
        {hasLoop && (
          <path
            d={`M 13 ${ROW_H * gateIdx + 14} C 26 ${ROW_H * gateIdx + 6}, 26 ${ROW_H * gateIdx + 38}, 13 ${ROW_H * gateIdx + 30}`}
            fill="none"
            stroke="var(--red)"
            strokeWidth={1.6}
            strokeDasharray="4 3"
            markerEnd="url(#dagArrow)"
          />
        )}
        <defs>
          <marker id="dagArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--red)" />
          </marker>
        </defs>
      </svg>
      <ol className="space-y-2">
        {steps.map((s) => {
          const st = STATUS_STYLE[s.status] || STATUS_STYLE.pending;
          const isCurrent = s.key === currentStep || s.status === 'running';
          return (
            <li key={s.key} className="flex items-center gap-3 pl-6 relative">
              <span
                className={`dag-node ${isCurrent ? 'brand-breathe' : ''}`}
                style={{ borderColor: st.stroke, background: st.fill }}
              >
                <StatusIcon status={s.status} />
              </span>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-xs font-medium truncate ${isCurrent ? 'text-[var(--brand-700)]' : ''}`}>{s.label}</span>
                  {(s.retryCount ?? 0) > 0 && <span className="dag-retry-badge">回炉 ×{s.retryCount}</span>}
                  {s.status === 'skipped' && <span className="text-small text-muted">已跳过</span>}
                </div>
                {s.output && (
                  <div className="text-small text-muted truncate" title={s.output}>
                    {summarizeStepOutput(s.key, s.output)}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
