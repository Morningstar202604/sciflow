import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/* ─────────────────────────────────────────────────────────────────────
 * 图表层设计约束（2026-10 重写）
 *
 * 1. 颜色一律走主题变量（--brand-*、--foreground、--border），不写死 hex，
 *    否则深/浅色主题切换时会出现「白字白底」「黑线黑底」。
 * 2. HBar 的高度是内部实现细节：调用方只给数据，不再传 height/barHeight。
 *    历史事故：0.4.2 把 barHeight 当整图高度导致图表压成 5px；
 *    本轮又因默认公式没预留坐标轴空间，3 条数据丢掉 1 个标签。
 * 3. 每个图表都提供 aria-label 与 <desc>，屏幕阅读器可读出数值。
 * ───────────────────────────────────────────────────────────────────── */

/* ── MetricCard ─────────────────────────────────────────────────────── */
export interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: 'brand' | 'amber' | 'rose' | 'emerald' | 'sky';
  tone?: string;
}

const accentVar: Record<NonNullable<MetricCardProps['accent']>, string> = {
  brand: '--brand-500',
  amber: '--amber-500',
  rose: '--rose-500',
  emerald: '--emerald-500',
  sky: '--sky-500',
};

export function MetricCard({ label, value, delta, hint, icon, accent, tone }: MetricCardProps) {
  const resolvedAccent = (accent ?? tone ?? 'brand') as NonNullable<MetricCardProps['accent']>;
  const c = `var(${accentVar[resolvedAccent] ?? '--brand-500'})`;
  return (
    <div className="metric-card">
      <div className="metric-card__label">
        {icon && <span className="metric-card__icon" style={{ color: c }}>{icon}</span>}
        {label}
      </div>
      <div className="metric-card__value tabular-nums">{value}</div>
      {delta && <div className="metric-card__delta">{delta}</div>}
      {hint && <div className="metric-card__hint">{hint}</div>}
    </div>
  );
}

/* ── ChartEmpty ──────────────────────────────────────────────────────── */
export interface ChartEmptyProps {
  message?: string;
  title?: string;
  hint?: string;
}

export function ChartEmpty({ message, title, hint }: ChartEmptyProps) {
  const text = message || title || hint || '暂无数据';
  return (
    <div className="chart-empty" role="status">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
      {text}
    </div>
  );
}

/* ── 共享主题常量（全部取自 CSS 变量，见 index.css） ───────────────── */
const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--popover-foreground)',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.4)',
};
const SERIES = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)', 'var(--viz-series-5)', 'var(--viz-series-6)'];
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const GRID_STROKE = 'var(--border)';

/* ── Donut (PieChart) ───────────────────────────────────────────────── */
export interface DonutDataPoint {
  name?: string;
  label?: string;
  value: number;
  color?: string;
}
export interface DonutProps {
  data?: DonutDataPoint[];
  segments?: DonutDataPoint[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

function normalizeDonutData(input: DonutDataPoint[] | undefined): DonutDataPoint[] {
  // 过滤零值分段：否则 0 值分片仍占据配色槽位，唯一非零分段会取到第 N 个系列色
  // （例如只有「已定稿」时整个环变紫），语义错位且与品牌色不符。
  return (input || [])
    .filter((d) => d.value > 0)
    .map((d) => ({ name: d.name || d.label || '', value: d.value, color: d.color }));
}

export function Donut({ data, segments, size = 160, thickness = 24, centerLabel, centerValue }: DonutProps) {
  const chartData = normalizeDonutData(data || segments);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  const total = chartData.reduce((s, d) => s + d.value, 0);
  const summary = chartData.map((d) => `${d.name} ${d.value}`).join('；');
  return (
    <div className="donut" style={{ width: size, height: size }} role="img" aria-label={`占比图：${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={size / 2 - thickness} outerRadius={size / 2} paddingAngle={2} stroke="none" isAnimationActive={false}>
            {chartData.map((e, i) => (
              <Cell key={`${e.name}-${i}`} fill={e.color ?? SERIES[i % SERIES.length]} />
            ))}
            {centerLabel && <Label value={centerLabel} position="center" fill="var(--muted-foreground)" fontSize={11} />}
            {centerValue != null && <Label value={centerValue} position="center" fill="var(--foreground)" fontSize={20} fontWeight={500} dy={12} />}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [`${v} (${total > 0 ? ((v / total) * 100).toFixed(1) : '0'}%)`, '数值']}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── HBar（横向条形图）───────────────────────────────────────────────── *
 * 高度完全内部自适应：每行固定 ROW_H，另加坐标轴与边距。
 * 调用方不再能传 height/barHeight —— 这类参数正是历史上两次事故的来源。
 */
export interface HBarDataPoint {
  name?: string;
  label?: string;
  value: number;
  color?: string;
  sub?: string;
  hint?: string;
}
export interface HBarProps {
  data?: HBarDataPoint[];
  items?: HBarDataPoint[];
  /** 单条柱厚度（px），默认 16；仅影响观感，不影响行距与标签可见性 */
  barThickness?: number;
  /** 数值上限；不传则按数据最大值自适应 */
  max?: number;
  formatValue?: (v: number) => string;
  /** 悬浮时补充说明 */
  sub?: (d: HBarDataPoint) => string;
  hint?: string;
}

const HBar_ROW_H = 30;
const HBar_AXIS_H = 26; // X 轴刻度 + 上下边距
const HBar_TOP_PAD = 6;
const HBar_LABEL_W = 84;

function normalizeHBarData(input: HBarDataPoint[] | undefined): HBarDataPoint[] {
  return (input || []).map((d) => ({ name: d.name || d.label || '', value: d.value, color: d.color, sub: d.sub, hint: d.hint }));
}

export function HBar({ data, items, barThickness = 16, max, formatValue, sub, hint }: HBarProps) {
  const chartData = normalizeHBarData(data || items);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;

  // 高度 = 行数 × 行高 + 轴区 + 上边距。每一行都拿到完整 ROW_H，
  // 因此最后一个类别的 tick 一定落在绘图区内（此前漏了轴区导致末尾标签被裁）。
  const height = chartData.length * HBar_ROW_H + HBar_AXIS_H + HBar_TOP_PAD;
  const summary = chartData.map((d) => `${d.name} ${d.value}`).join('；');

  return (
    <div className="hbar" role="img" aria-label={`条形图：${summary}`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: HBar_TOP_PAD, right: 18, bottom: 4, left: 4 }}
          barCategoryGap={8}
        >
          <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickFormatter={formatValue ?? ((v: number) => `${v}`)}
            axisLine={false}
            tickLine={false}
            domain={[0, max ?? 'dataMax']}
            height={HBar_AXIS_H}
          />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={HBar_LABEL_W} interval={0} />
          <Tooltip
            cursor={{ fill: 'var(--accent)', fillOpacity: 0.5 }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [formatValue ? formatValue(v) : v, '数值']}
            labelFormatter={(n: string) => {
              const pt = chartData.find((d) => d.name === n);
              return pt && sub ? sub(pt) : n;
            }}
          />
          <Bar dataKey="value" barSize={barThickness} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {chartData.map((e, i) => (
              <Cell key={`${e.name}-${i}`} fill={e.color ?? SERIES[i % SERIES.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hint && <p className="chart-hint">{hint}</p>}
    </div>
  );
}

/* ── LineChart + Area ───────────────────────────────────────────────── */
export interface LineDataPoint {
  label: string;
  [key: string]: string | number;
}
export interface LineSeries {
  dataKey: string;
  name?: string;
  color?: string;
  area?: boolean;
  strokeWidth?: number;
}
export interface LineChartProps {
  data?: LineDataPoint[];
  points?: LineDataPoint[];
  series?: LineSeries[];
  height?: number;
  grid?: boolean;
  showDots?: boolean;
  showLegend?: boolean;
  onPointClick?: (index: number) => void;
}

export function LineChart({ data, points, series, height = 240, grid = true, showDots = false, showLegend = true, onPointClick }: LineChartProps) {
  const chartData = data || points || [];
  const chartSeries: LineSeries[] =
    series ||
    (chartData.length > 0
      ? Object.keys(chartData[0])
          .filter((k) => k !== 'label')
          .map((k) => ({ dataKey: k, name: k }))
      : []);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  return (
    <div className="linechart" role="img" aria-label="趋势折线图">
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
          onClick={(e: { activeTooltipIndex?: number }) => {
            if (onPointClick && e?.activeTooltipIndex != null) onPointClick(e.activeTooltipIndex);
          }}
        >
          {grid && <CartesianGrid stroke={GRID_STROKE} vertical={false} />}
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {showLegend && chartSeries.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />}
          {chartSeries.map((s, i) => {
            const color = s.color ?? SERIES[i % SERIES.length];
            return s.area ? (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name ?? s.dataKey}
                stroke={color}
                fill={color}
                fillOpacity={0.1}
                strokeWidth={s.strokeWidth ?? 2}
                dot={showDots}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name ?? s.dataKey}
                stroke={color}
                strokeWidth={s.strokeWidth ?? 2}
                dot={showDots ? { r: 3, fill: color } : false}
                isAnimationActive={false}
              />
            );
          })}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── SegBar（分段占比条）────────────────────────────────────────────── */
export interface SegBarDataPoint {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}
export interface SegBarProps {
  data?: SegBarDataPoint[];
  segments?: SegBarDataPoint[];
  height?: number;
}

export function SegBar({ data, segments, height = 20 }: SegBarProps) {
  const chartData = data || segments || [];
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  const total = chartData.reduce((s, d) => s + d.value, 0);
  return (
    <div className="segbar" style={{ height, borderRadius: height / 2 }} role="img" aria-label={chartData.map((s) => `${s.label} ${s.value}`).join('；')}>
      {chartData.map((seg, i) => {
        const pct = total > 0 ? (seg.value / total) * 100 : 0;
        return (
          <div
            key={`${seg.label}-${i}`}
            className="segbar__seg"
            title={seg.hint || `${seg.label}: ${seg.value} (${pct.toFixed(1)}%)`}
            style={{ width: `${pct}%`, background: seg.color || SERIES[i % SERIES.length] }}
          />
        );
      })}
    </div>
  );
}

/* ── Sparkline（极简 SVG）───────────────────────────────────────────── */
export interface SparklineProps {
  data: number[];
  color?: string;
  stroke?: string;
  height?: number;
  width?: number | string;
  fillArea?: boolean;
}

export function Sparkline({ data, color, stroke, height = 36, width = '100%', fillArea = true }: SparklineProps) {
  const resolvedColor = color || stroke || 'var(--viz-series-1)';
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const PAD = 4;
  const drawH = height - PAD * 2;
  const path = data
    .map((v, i) => {
      const x = PAD + (i / (data.length - 1 || 1)) * 100;
      return `${i === 0 ? 'M' : 'L'}${x},${PAD + (1 - (v - min) / range) * drawH}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 108 ${height}`} preserveAspectRatio="none" className="sparkline" aria-hidden="true">
      {fillArea && <path d={`${path} L108,${height} L4,${height} Z`} fill={resolvedColor} opacity={0.12} />}
      <path d={path} fill="none" stroke={resolvedColor} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/* ── ProgressRing（进度环）──────────────────────────────────────────── *
 * 标签颜色改为主题变量：历史上写死 rgba(255,255,255,*)，浅色主题下文字不可见。
 */
export interface ProgressRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sub?: string;
}

export function ProgressRing({ value, size = 64, strokeWidth, thickness, color = 'var(--brand-500)', trackColor, label, sub }: ProgressRingProps) {
  const resolvedStrokeWidth = strokeWidth ?? thickness ?? 5;
  const r = (size - resolvedStrokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const offset = c - (clamped / 100) * c;
  const hasSub = Boolean(sub);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="progress-ring" role="img" aria-label={`${label ?? '进度'} ${Math.round(clamped)}%${sub ? `，${sub}` : ''}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor ?? 'var(--border)'} strokeWidth={resolvedStrokeWidth} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={resolvedStrokeWidth}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      {label && (
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" dy={hasSub ? -3 : 0} fill="var(--foreground)" fontSize={size > 60 ? 12 : 10} fontWeight={500}>
          {label}
        </text>
      )}
      {sub && (
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" dy={11} fill="var(--muted-foreground)" fontSize={9}>
          {sub}
        </text>
      )}
    </svg>
  );
}
