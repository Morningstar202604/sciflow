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
} from "recharts";

/* ── MetricCard ─────────────────────────────────────────────────────── */
export interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  icon?: React.ReactNode;
  accent?: "brand" | "amber" | "rose" | "emerald" | "sky";
}

const accentVar: Record<NonNullable<MetricCardProps["accent"]>, string> = {
  brand: "--brand-500", amber: "--amber-500", rose: "--rose-500",
  emerald: "--emerald-500", sky: "--sky-500",
};

export function MetricCard({ label, value, delta, icon, accent = "brand" }: MetricCardProps) {
  const c = `var(${accentVar[accent]})`;
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-2 border border-white/5 bg-white/[0.03]"
         style={{ boxShadow: `inset 0 1px 0 0 ${c}22` }}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/40">
        {icon && <span className="size-4" style={{ color: c }}>{icon}</span>}
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight text-white">{value}</div>
      {delta && <div className="text-xs text-white/50">{delta}</div>}
    </div>
  );
}

/* ── ChartEmpty ──────────────────────────────────────────────────────── */
export interface ChartEmptyProps { message?: string; }

export function ChartEmpty({ message = "No data available" }: ChartEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-white/30">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
           className="opacity-40">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
      {message}
    </div>
  );
}

/* ── Shared constants ────────────────────────────────────────────────── */
const TOOLTIP: React.CSSProperties = {
  background: "rgba(15,15,20,0.92)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8, fontSize: 12, color: "#fff",
};
const P = ["var(--brand-400)", "var(--brand-500)", "var(--brand-600)", "var(--brand-300)", "var(--brand-700)"];
const LP = ["var(--brand-400)", "var(--brand-500)", "var(--brand-600)", "var(--amber-400)", "var(--emerald-400)", "var(--rose-400)"];
const TC = "rgba(255,255,255,0.4)";
const GC = "rgba(255,255,255,0.05)";

/* ── Donut (PieChart) ───────────────────────────────────────────────── */
export interface DonutDataPoint { name: string; value: number; color?: string; }
export interface DonutProps { data: DonutDataPoint[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string | number; }

export function Donut({ data, size = 160, thickness = 24, centerLabel, centerValue }: DonutProps) {
  if (!data.length) return <ChartEmpty message="Nothing to show" />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
               innerRadius={size / 2 - thickness} outerRadius={size / 2} paddingAngle={2} stroke="none" isAnimationActive>
            {data.map((e, i) => <Cell key={e.name} fill={e.color ?? P[i % P.length]} />)}
            {centerLabel && <Label value={centerLabel} position="center" fill="rgba(255,255,255,0.35)" fontSize={11} fontWeight={500} />}
            {centerValue != null && <Label value={centerValue} position="center" fill="#fff" fontSize={22} fontWeight={600} dy={14} dx={0} />}
          </Pie>
          <Tooltip contentStyle={TOOLTIP}
                   formatter={(v: number) => [`${v} (${total > 0 ? ((v / total) * 100).toFixed(1) : "0"}%)`, "Value"]} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── HBar (BarChart) ────────────────────────────────────────────────── */
export interface HBarDataPoint { name: string; value: number; color?: string; }
export interface HBarProps { data: HBarDataPoint[]; height?: number; formatValue?: (v: number) => string; sub?: (d: HBarDataPoint) => string; hint?: string; }

export function HBar({ data, height = 240, formatValue, sub, hint }: HBarProps) {
  if (!data.length) return <ChartEmpty message="No bars to show" />;
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap={10}>
          <CartesianGrid stroke={GC} horizontal={false} />
          <XAxis type="number" tick={{ fill: TC, fontSize: 11 }} tickFormatter={formatValue ?? ((v: number) => `${v}`)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fill: TC, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={TOOLTIP}
                   formatter={(v: number) => [formatValue ? formatValue(v) : v, "Value"]}
                   labelFormatter={(n: string) => { const pt = data.find((d) => d.name === n); return pt && sub ? sub(pt) : n; }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive>
            {data.map((e, i) => <Cell key={e.name} fill={e.color ?? P[i % P.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hint && <p className="mt-1 text-center text-xs text-white/30">{hint}</p>}
    </div>
  );
}

/* ── LineChart + Area ───────────────────────────────────────────────── */
export interface LineDataPoint { label: string; [key: string]: string | number; }
export interface LineSeries { dataKey: string; name?: string; color?: string; area?: boolean; strokeWidth?: number; }
export interface LineChartProps { data: LineDataPoint[]; series: LineSeries[]; height?: number; grid?: boolean; showDots?: boolean; showLegend?: boolean; }

export function LineChart({ data, series, height = 260, grid = true, showDots = false, showLegend = true }: LineChartProps) {
  if (!data.length) return <ChartEmpty message="No data points" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        {grid && <CartesianGrid stroke={GC} vertical={false} />}
        <XAxis dataKey="label" tick={{ fill: TC, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: TC, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip contentStyle={TOOLTIP} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }} />}
        {series.map((s, i) => {
          const color = s.color ?? LP[i % LP.length];
          return s.area
            ? <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name ?? s.dataKey} stroke={color} fill={color} fillOpacity={0.08} strokeWidth={s.strokeWidth ?? 2} dot={showDots} isAnimationActive />
            : <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} name={s.name ?? s.dataKey} stroke={color} strokeWidth={s.strokeWidth ?? 2} dot={showDots ? { r: 3, fill: color } : false} isAnimationActive />;
        })}
      </ReLineChart>
    </ResponsiveContainer>
  );
}

/* ── Sparkline (minimal SVG) ────────────────────────────────────────── */
export interface SparklineProps { data: number[]; color?: string; height?: number; width?: number | string; fillArea?: boolean; }

export function Sparkline({ data, color = "var(--brand-400)", height = 36, width = "100%", fillArea = true }: SparklineProps) {
  if (!data.length) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const PAD = 4, drawH = height - PAD * 2;
  const path = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1 || 1)) * 100;
    return `${i === 0 ? "M" : "L"}${x},${PAD + (1 - (v - min) / range) * drawH}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 108 ${height}`} preserveAspectRatio="none" className="overflow-visible">
      {fillArea && <path d={`${path} L108,${height} L4,${height} Z`} fill={color} opacity={0.12} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/* ── ProgressRing (SVG) ─────────────────────────────────────────────── */
export interface ProgressRingProps { value: number; size?: number; strokeWidth?: number; color?: string; trackColor?: string; label?: string; }

export function ProgressRing({ value, size = 64, strokeWidth = 5, color = "var(--brand-400)", trackColor = "rgba(255,255,255,0.08)", label }: ProgressRingProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, value)) / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
              strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ transition: "stroke-dashoffset 0.5s ease" }} />
      {label && <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={12} fontWeight={600}>{label}</text>}
    </svg>
  );
}
