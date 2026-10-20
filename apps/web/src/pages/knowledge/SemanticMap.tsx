import { useMemo, useRef, useState } from 'react';

/**
 * SemanticMap —— 知识库语义地图（F-2.2）。
 *
 * 后端把每个分块的 embedding 用 PCA 压到 2D，这里用自绘 SVG 画散点：
 *  - 同一文档的点用同一颜色（聚簇直观可见）
 *  - 悬停/点击显示该块文本片段
 *  - 自带图例与下采样提示
 *
 * 为什么不用 echarts：需求只是散点 + tooltip，echarts 会增加 ~300KB 依赖；
 * 自绘 SVG 在这里几十行就能覆盖，且与现有主题变量天然一致（§7 守则：不为单一图表引重依赖）。
 */

export interface SemanticPoint {
  id: string;
  docId: string;
  docName: string;
  seq: number;
  x: number;
  y: number;
  snippet: string;
}

const PALETTE = [
  'var(--viz-series-1)',
  'var(--viz-series-2)',
  'var(--viz-series-3)',
  'var(--viz-series-4)',
  'var(--viz-series-5)',
  'var(--viz-series-6)',
];

export function SemanticMap({
  points,
  total,
  sampled,
  height = 420,
}: {
  points: SemanticPoint[];
  total: number;
  sampled: boolean;
  height?: number;
}) {
  const [active, setActive] = useState<SemanticPoint | null>(null);
  const [hover, setHover] = useState<SemanticPoint | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 文档 → 颜色索引（按文档名排序，保证同一项目刷新后配色稳定）
  const docColors = useMemo(() => {
    const names = [...new Set(points.map((p) => p.docName))].sort();
    return new Map(names.map((n, i) => [n, PALETTE[i % PALETTE.length]]));
  }, [points]);

  const offsets = useMemo(() => {
    const groups = new Map<string, SemanticPoint[]>();
    for (const p of points) {
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    const map = new Map<string, { dx: number; dy: number }>();
    for (const arr of groups.values()) {
      if (arr.length === 1) {
        map.set(arr[0].id, { dx: 0, dy: 0 });
        continue;
      }
      arr.forEach((p, i) => {
        const angle = (Math.PI * 2 * i) / arr.length;
        const radius = 3 + Math.min(arr.length, 8) * 0.9;
        map.set(p.id, { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius });
      });
    }
    return map;
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="chart-empty" role="status">
        暂无向量数据：知识库为空，或嵌入模型未配置（未配置时检索走全文，不生成向量）。
      </div>
    );
  }

  const PAD = 24;
  const W = 720;
  const H = height;
  /**
   * 投影后仍可能有多点落在同一像素（真实 embedding 里同段落分块往往极其相近）。
   * 这里按「同坐标分组」做确定性环形偏移，让重叠点散开可见——
   * 偏移量用索引派生，不用随机数，保证刷新后位置稳定。
   */

  const toPx = (p: SemanticPoint) => {
    const off = offsets.get(p.id) ?? { dx: 0, dy: 0 };
    return {
      cx: PAD + p.x * (W - PAD * 2) + off.dx,
      cy: PAD + p.y * (H - PAD * 2) + off.dy,
    };
  };

  const shown = active ?? hover;

  return (
    <div className="semantic-map">
      <div className="semantic-map__canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`知识库语义地图，共 ${points.length} 个分块，来自 ${docColors.size} 份资料`}
        >
          <desc>
            每个点代表一个知识库分块，位置由向量降维得到；颜色代表所属资料。
            {sampled ? `当前展示 ${points.length} / ${total} 个分块（已下采样）。` : ''}
          </desc>
          {/* 底板 */}
          <rect x="0" y="0" width={W} height={H} fill="transparent" />
          {points.map((p) => {
            const { cx, cy } = toPx(p);
            const isActive = shown?.id === p.id;
            return (
              <circle
                key={p.id}
                cx={cx}
                cy={cy}
                r={isActive ? 6 : 3.2}
                fill={docColors.get(p.docName) ?? PALETTE[0]}
                fillOpacity={isActive ? 1 : 0.72}
                stroke={isActive ? 'var(--foreground)' : 'none'}
                strokeWidth={isActive ? 1.2 : 0}
                style={{ cursor: 'pointer', transition: 'r 120ms ease' }}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setActive((cur) => (cur?.id === p.id ? null : p))}
              >
                <title>{`${p.docName} · 第 ${p.seq + 1} 块`}</title>
              </circle>
            );
          })}
        </svg>
      </div>

      {shown && (
        <div className="semantic-map__detail" role="status">
          <div className="semantic-map__detail-head">
            <span className="semantic-map__dot" style={{ background: docColors.get(shown.docName) }} aria-hidden="true" />
            <span className="font-medium">{shown.docName}</span>
            <span className="text-muted">· 第 {shown.seq + 1} 块</span>
          </div>
          <p>{shown.snippet}{shown.snippet.length >= 160 ? '…' : ''}</p>
        </div>
      )}

      <div className="semantic-map__legend">
        {[...docColors.entries()].map(([name, color]) => (
          <span key={name} className="semantic-map__legend-item">
            <span className="semantic-map__dot" style={{ background: color }} aria-hidden="true" />
            <span className="truncate max-w-[180px]">{name}</span>
          </span>
        ))}
      </div>

      <p className="text-small text-muted">
        共 {total} 个分块{points.length !== total ? `，当前展示 ${points.length} 个（已下采样以保证渲染流畅）` : ''}。
        点位相近表示语义相近；点击查看分块原文。
      </p>
    </div>
  );
}
