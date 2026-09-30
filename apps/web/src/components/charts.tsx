import { useId } from 'react';
import type { ReactNode } from 'react';

/* =====================================================================
 * 轻量自绘可视化原语库（零依赖 · 品牌 token · 亮/暗双主题自适应）
 * ---------------------------------------------------------------------
 * 设计基线（Tufte 数据墨水比）：
 *  - 去边框、弱网格（仅横向参考线 1px、10-20% 不透明度）、直接标注胜过图例
 *  - 主系列走品牌渐变（--brand-grad：teal→cyan→sky），辅助系列用 slate 灰阶
 *  - 语义色：成功 emerald / 等待 amber / 失败 rose（与全站一致）
 *  - 每个图形元素带 <title> 无障碍提示；交互用 onPointClick / hover 高亮
 * 组件清单：MetricCard / HBar / Donut / SegBar / Sparkline / LineChart /
 *          ProgressRing / ChartEmpty
 * 使用约定：只传数据 + 布局 className；禁止在页面内重复实现图表样式。
 * ===================================================================== */

const BRAND = 'var(--brand-500)';
const BRAND_LIGHT = 'var(--brand-400)';

/** 默认分类色板：品牌三色 + 语义色，暗色下由 token 自动提亮 */
const PALETTE = ['var(--brand-500)', 'var(--brand-400)', '#0ea5e9', '#f59e0b', '#64748b', '#94a3b8', '#8b5cf6', '#f87171'];

/* ---------------- MetricCard：大数字指标卡（可带迷你趋势） ---------------- */
export function MetricCard({
  label,
  value,
  icon,
  hint,
  spark,
  tone = 'brand',
  className = '',
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
  spark?: number[];
  tone?: 'brand' | 'slate' | 'green' | 'amber' | 'red';
  className?: string;
}) {
  const toneCls: Record<string, string> = {
    brand: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    red: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  };
  return (
    <div
      className={`rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-1.5 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{label}</span>
        {icon && <span className={`rounded-lg p-1.5 ${toneCls[tone]}`}>{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-none">{value}</div>
        {spark && spark.length > 1 && <Sparkline data={spark} width={84} height={26} />}
      </div>
      {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

/* ---------------- HBar：横向条形对比（离散类别排序对比的主力图） ---------------- */
export function HBar({
  items,
  max,
  showValue = true,
  barHeight = 8,
  className = '',
}: {
  items: { label: string; value: number; max?: number; color?: string; sub?: string; hint?: string; formatValue?: (v: number) => string }[];
  max?: number;
  showValue?: boolean;
  barHeight?: number;
  className?: string;
}) {
  const m = max ?? Math.max(1, ...items.map((i) => i.max ?? i.value));
  return (
    <div className={`space-y-2.5 ${className}`}>
      {items.map((it, idx) => {
        const w = Math.max(0, Math.min(100, ((it.value / m) * 100)));
        return (
          <div key={idx}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate">{it.label}</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                {it.sub && <span className="mr-1.5">{it.sub}</span>}
                {showValue && <span className="font-semibold text-slate-700 dark:text-slate-200">{it.formatValue ? it.formatValue(it.value) : it.value}</span>}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" title={it.hint}>
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${w}%`,
                  background: it.color ?? 'linear-gradient(90deg, var(--brand-600), var(--brand-500) 60%, var(--brand-400))',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Donut：环形占比（2-5 类互斥分类） ---------------- */
export function Donut({
  segments,
  size = 92,
  thickness = 13,
  centerLabel,
  centerValue,
  className = '',
}: {
  segments: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="占比环形图">
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--chart-track, #e2e8f0)" strokeWidth={thickness} className="dark:stroke-slate-800" />
          {segments.map((s, i) => {
            const frac = s.value / total;
            const dash = Math.max(0, frac * C - 1.5);
            const offset = -acc * C;
            acc += frac;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={R}
                fill="none"
                stroke={s.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>{`${s.label}：${s.value}（${Math.round(frac * 100)}%）`}</title>
              </circle>
            );
          })}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {centerValue && <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 leading-none">{centerValue}</div>}
            {centerLabel && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{centerLabel}</div>}
          </div>
        )}
      </div>
      <div className="space-y-1 min-w-0">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="truncate">{s.label}</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200 ml-auto">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- SegBar：分段状态条（互斥状态占比，如任务状态分布） ---------------- */
export function SegBar({
  segments,
  height = 10,
  showLegend = true,
  className = '',
}: {
  segments: { label: string; value: number; color?: string; hint?: string }[];
  height?: number;
  showLegend?: boolean;
  className?: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  return (
    <div className={className}>
      <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
        {segments.map((s, i) => (
          <div
            key={i}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color ?? PALETTE[i % PALETTE.length] }}
            title={s.hint ?? `${s.label}：${s.value}`}
          />
        ))}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
              {s.label}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{s.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Sparkline：迷你趋势（SVG polyline + 渐变面积） ---------------- */
export function Sparkline({
  data,
  width = 100,
  height = 30,
  fill = true,
  stroke = BRAND,
  className = '',
}: {
  data: number[];
  width?: number;
  height?: number;
  fill?: boolean;
  stroke?: string;
  className?: string;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <polygon points={area} fill={`url(#spark-${gid})`} />}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------- LineChart：带刻度与交互的时序折线（趋势的核心图） ---------------- */
export function LineChart({
  points,
  height = 150,
  yDomain,
  formatY,
  onPointClick,
  color = 'url(#lc-line)',
  className = '',
}: {
  points: { label: string; value: number }[];
  height?: number;
  yDomain?: [number, number];
  formatY?: (v: number) => string;
  onPointClick?: (i: number) => void;
  color?: string;
  className?: string;
}) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (points.length < 2) return null;
  const W = 100; // 视口按 100x100 归一化，由 CSS 拉伸（text 也会被水平拉伸，故 Y 轴刻度需足够左边距防裁切）
  const H = height;
  const padT = 10, padB = 18, padL = 26, padR = 8;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const vals = points.map((p) => p.value);
  const [lo, hi] = yDomain ?? [Math.min(...vals), Math.max(...vals)];
  const span = hi - lo || 1;
  const x = (i: number) => padL + (i / (points.length - 1)) * iw;
  const y = (v: number) => padT + (1 - (v - lo) / span) * ih;
  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = `${padL},${padT + ih} ${line} ${padL + iw},${padT + ih}`;
  // 横向参考线：最小值 / 中点 / 最大值
  const gridVals = [lo, (lo + hi) / 2, hi];
  const xTickIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full h-auto ${className}`}
      role="img"
      aria-label="时序折线图"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`lc-${gid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brand-600)" />
          <stop offset="55%" stopColor="var(--brand-500)" />
          <stop offset="100%" stopColor="var(--brand-400)" />
        </linearGradient>
        <linearGradient id={`lcf-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line x1={padL} y1={y(gv)} x2={padL + iw} y2={y(gv)} stroke="var(--chart-grid, #e2e8f0)" strokeWidth="0.4" className="dark:stroke-slate-700/50" />
          <text x={padL - 1} y={y(gv) + 2} fontSize="3.2" textAnchor="end" fill="#94a3b8" className="dark:fill-slate-500">
            {formatY ? formatY(Math.round(gv)) : Math.round(gv)}
          </text>
        </g>
      ))}
      <polygon points={area} fill={`url(#lcf-${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(p.value)}
          r={onPointClick ? 2.6 : 1.8}
          fill="var(--brand-500)"
          stroke="#fff"
          strokeWidth="0.8"
          className="dark:stroke-slate-900"
          style={onPointClick ? { cursor: 'pointer' } : undefined}
          onClick={onPointClick ? () => onPointClick(i) : undefined}
        >
          <title>{`${p.label}：${p.value}`}</title>
        </circle>
      ))}
      {xTickIdx.map((ti, i) => (
        <text key={i} x={x(ti)} y={H - 5} fontSize="3.4" textAnchor={ti === 0 ? 'start' : ti === points.length - 1 ? 'end' : 'middle'} fill="#94a3b8" className="dark:fill-slate-500">
          {points[ti].label}
        </text>
      ))}
    </svg>
  );
}

/* ---------------- ProgressRing：圆形进度环（总分/任务完成度） ---------------- */
export function ProgressRing({
  value,
  size = 76,
  thickness = 8,
  label,
  sub,
  className = '',
}: {
  value: number; // 0-100
  size?: number;
  thickness?: number;
  label?: string;
  sub?: string;
  className?: string;
}) {
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 80 ? 'var(--brand-500)' : v >= 60 ? '#f59e0b' : '#f87171';
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? '进度'} ${v}/100`}>
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#e2e8f0" strokeWidth={thickness} className="dark:stroke-slate-800" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${(v / 100) * C} ${C}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-800 dark:text-slate-100">
          {Math.round(v)}
        </div>
      </div>
      {(label || sub) && (
        <div>
          {label && <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</div>}
          {sub && <div className="text-[11px] text-slate-400 dark:text-slate-500">{sub}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------------- ChartEmpty：图表空状态（说明原因 + 下一步） ---------------- */
export function ChartEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3v18h18" />
          <path d="M7 15l3-4 3 3 4-6" />
        </svg>
      </div>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</div>
      {hint && <div className="text-[11px] text-slate-400 dark:text-slate-500 max-w-56">{hint}</div>}
    </div>
  );
}
