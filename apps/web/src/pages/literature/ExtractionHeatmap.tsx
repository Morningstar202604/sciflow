import { useMemo } from 'react';

/**
 * ExtractionHeatmap —— 文献编码覆盖度热力图（F-2.6）。
 *
 * 行=字段，列=文献；颜色深浅表示该单元格是否有值。
 * 用途：一眼看出「哪些字段大部分文献还没编」，点击空格直接跳到补录。
 *
 * 自绘 SVG：数据量是 字段数 × 文献数（通常 < 20×100），不需要重型图表库。
 */

export interface HeatmapField {
  id: string;
  label: string;
}

export interface HeatmapRow {
  referenceId: string;
  title: string;
  values: Record<string, string>;
}

export function ExtractionHeatmap({
  fields,
  rows,
  onPick,
}: {
  fields: HeatmapField[];
  rows: HeatmapRow[];
  /** 点击空白格：跳到该文献的该字段补录 */
  onPick?: (referenceId: string, fieldId: string) => void;
}) {
  const stats = useMemo(() => {
    if (fields.length === 0 || rows.length === 0) return null;
    let filled = 0;
    const perField = fields.map((f) => {
      const n = rows.filter((r) => (r.values[f.id] ?? '').trim().length > 0).length;
      filled += n;
      return { field: f, filled: n, ratio: n / rows.length };
    });
    const total = fields.length * rows.length;
    return { perField, filled, total, ratio: total > 0 ? filled / total : 0 };
  }, [fields, rows]);

  if (!stats) {
    return <div className="text-xs text-slate-400 dark:text-slate-500 py-3">尚无字段或文献，先定义抽取字段。</div>;
  }

  const CELL_W = 18;
  const CELL_H = 18;
  const LABEL_W = 96;
  const HEADER_H = 18;
  const W = LABEL_W + rows.length * CELL_W + 8;
  const H = HEADER_H + fields.length * CELL_H + 6;

  return (
    <div className="extraction-heatmap">
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">编码覆盖度</span>
        <span className="text-slate-500 dark:text-slate-400">
          已填 {stats.filled} / {stats.total} 格（{Math.round(stats.ratio * 100)}%）
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={Math.min(W, 720)}
          height={H}
          role="img"
          aria-label={`编码覆盖度热力图：${fields.length} 个字段、${rows.length} 篇文献，已填 ${stats.filled} 格`}
        >
          {/* 列标题（文献序号） */}
          {rows.map((r, ci) => (
            <text
              key={r.referenceId}
              x={LABEL_W + ci * CELL_W + CELL_W / 2}
              y={12}
              textAnchor="middle"
              fontSize={9}
              fill="var(--muted-foreground)"
            >
              {ci + 1}
            </text>
          ))}
          {fields.map((f, ri) => {
            const y = HEADER_H + ri * CELL_H;
            return (
              <g key={f.id}>
                <text x={0} y={y + 12.5} fontSize={10} fill="var(--foreground)">
                  {f.label.length > 8 ? f.label.slice(0, 8) + '…' : f.label}
                </text>
                {rows.map((r, ci) => {
                  const has = (r.values[f.id] ?? '').trim().length > 0;
                  const x = LABEL_W + ci * CELL_W;
                  return (
                    <rect
                      key={r.referenceId}
                      x={x + 1}
                      y={y + 1}
                      width={CELL_W - 2}
                      height={CELL_H - 2}
                      rx={2}
                      fill={has ? 'var(--viz-series-1)' : 'var(--muted)'}
                      fillOpacity={has ? 0.85 : 1}
                      style={{ cursor: onPick ? 'pointer' : 'default' }}
                      onClick={() => onPick?.(r.referenceId, f.id)}
                    >
                      <title>{`${r.title.slice(0, 30)} · ${f.label}：${has ? r.values[f.id] : '未填写'}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--viz-series-1)', opacity: 0.85 }} /> 已填写</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--muted)' }} /> 待补录</span>
        <span>列号对应文献顺序</span>
      </div>
    </div>
  );
}
