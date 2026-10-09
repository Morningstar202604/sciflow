import { useEffect, useMemo, useRef, useState } from 'react';
import { List, Minus, Network, Plus, RotateCcw } from 'lucide-react';
import { frStep, MAX_SCALE, MIN_SCALE, SEED_CAP, EXPAND_ROUNDS, VENUE_COLORS, W, H } from './literature-graph';
import type { Pt, View } from './literature-graph';
import type { ReferenceGraph } from '../../types';
import { Badge, Button } from '../../components/ui';

const READING_TONE: Record<string, 'slate' | 'amber' | 'green' | 'blue'> = {
  unread: 'slate',
  reading: 'amber',
  read: 'green',
  cited: 'blue',
};

/** 阅读状态机中文标签（差距#1：把后端枚举本地化显示） */
const READING_LABEL: Record<string, string> = {
  unread: '未读',
  reading: '在读',
  read: '已读',
  cited: '已引',
};

export function ReferenceNetwork({ graph, onViewRef }: { graph: ReferenceGraph; onViewRef?: (id: string) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  // 全图邻接（含未展开节点），用于邻居高亮与卡片徽章
  const adj = useMemo(() => {
    const m = new Map<string, Set<string>>();
    graph.edges.forEach((e) => {
      if (!m.has(e.a)) m.set(e.a, new Set());
      if (!m.has(e.b)) m.set(e.b, new Set());
      m.get(e.a)!.add(e.b);
      m.get(e.b)!.add(e.a);
    });
    return m;
  }, [graph]);

  // 可变布局状态（动画帧内直接改写，靠 rerender 触发渲染）
  const visibleRef = useRef<Set<string>>(new Set());
  const posRef = useRef<Map<string, Pt>>(new Map());
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ px: number; py: number; tx: number; ty: number; moved: boolean } | null>(null);
  const pannedRef = useRef(false); // 平移过则抑制随后的空白点击取消

  const [selected, setSelected] = useState<string | null>(null);
  const autoCards = graph.nodes.length > 100;
  const [viewMode, setViewMode] = useState<'network' | 'cards'>(autoCards ? 'cards' : 'network');
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // venue 前 6 类各一色
  const venueColor = useMemo(() => {
    const m = new Map<string, number>();
    graph.nodes.forEach((nd) => {
      const v = nd.venue || '未标注';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
    const map = new Map<string, string>();
    top.forEach((v, i) => map.set(v, VENUE_COLORS[i % VENUE_COLORS.length]));
    return map;
  }, [graph]);

  /* ---------- 布局动画控制 ---------- */
  const fitView = () => {
    const pos = posRef.current;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pos.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    if (!isFinite(minX)) { setView({ scale: 1, tx: 0, ty: 0 }); return; }
    const pad = 60;
    const bw = Math.max(1, maxX - minX + pad * 2);
    const bh = Math.max(1, maxY - minY + pad * 2);
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(W / bw, H / bh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({ scale: s, tx: W / 2 - cx * s, ty: H / 2 - cy * s });
  };

  const runLayout = (rounds: number, animate: boolean, onDone?: () => void) => {
    cancelAnimationFrame(animRef.current);
    const ids = [...visibleRef.current];
    if (ids.length < 2) { rerender(); onDone?.(); return; }
    const idx = new Map(ids.map((id, i) => [id, i]));
    const edges = graph.edges.filter((e) => idx.has(e.a) && idx.has(e.b));
    const k = Math.sqrt((W * H) / ids.length);
    const disp: Pt[] = ids.map(() => ({ x: 0, y: 0 }));
    let temp = Math.min(W / 6, 50);
    let round = 0;
    const perFrame = animate ? 2 : rounds;
    const tick = () => {
      for (let s = 0; s < perFrame && round < rounds; s++) {
        temp = frStep(posRef.current, ids, idx, edges, k, disp, temp);
        round++;
      }
      rerender();
      if (round < rounds) animRef.current = requestAnimationFrame(tick);
      else onDone?.();
    };
    tick();
  };

  // 图加载：BFS 从最高度节点取种子簇，环形播种后跑动画化 FR
  useEffect(() => {
    cancelAnimationFrame(animRef.current);
    let start: string | undefined = graph.nodes[0]?.id;
    let best = -1;
    graph.nodes.forEach((n) => {
      const d = adj.get(n.id)?.size || 0;
      if (d > best) { best = d; start = n.id; }
    });
    const vis = new Set<string>();
    if (start) {
      const q: string[] = [start];
      vis.add(start);
      while (q.length && vis.size < SEED_CAP) {
        const cur = q.shift()!;
        for (const nb of adj.get(cur) || []) {
          if (!vis.has(nb)) {
            vis.add(nb);
            q.push(nb);
            if (vis.size >= SEED_CAP) break;
          }
        }
      }
    }
    if (graph.nodes.length <= SEED_CAP) graph.nodes.forEach((n) => vis.add(n.id));

    const pos = new Map<string, Pt>();
    const arr = [...vis];
    arr.forEach((id, i) => {
      const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
      const r = 120 + (i % 5) * 26;
      pos.set(id, { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r });
    });
    visibleRef.current = vis;
    posRef.current = pos;
    setSelected(null);
    runLayout(arr.length > 1 ? 130 : 1, true, fitView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  /* ---------- 坐标换算与缩放平移 ---------- */
  const clientToGraph = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    const vy = ((clientY - rect.top) / rect.height) * H;
    const v = viewRef.current;
    return { x: (vx - v.tx) / v.scale, y: (vy - v.ty) / v.scale };
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((clientX - rect.left) / rect.width) * W;
    const vy = ((clientY - rect.top) / rect.height) * H;
    setView((v) => {
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const gx = (vx - v.tx) / v.scale;
      const gy = (vy - v.ty) / v.scale;
      return { scale: ns, tx: vx - gx * ns, ty: vy - gy * ns };
    });
  };

  // 滚轮缩放需 passive:false 才能 preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || viewMode !== 'network') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const zoomByCenter = (f: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  const focusOnNode = (id: string) => {
    const p = posRef.current.get(id);
    if (!p) return;
    setView((v) => {
      const s = Math.max(v.scale, 1);
      return { scale: s, tx: W / 2 - p.x * s, ty: H / 2 - p.y * s };
    });
  };

  /* ---------- 节点交互 ---------- */
  const onNodeClick = (id: string) => {
    // 把未展开的一跳邻居以「邻居扇区」播种，再跑动画化 FR
    const nbs = [...(adj.get(id) || [])].filter((n) => !visibleRef.current.has(n));
    if (nbs.length > 0) {
      const anchor = posRef.current.get(id) || { x: W / 2, y: H / 2 };
      const k = Math.sqrt((W * H) / Math.max(4, visibleRef.current.size));
      nbs.forEach((nb, i) => {
        const a = (i / nbs.length) * Math.PI * 2 + Math.random() * 0.6;
        const r = k * 1.6;
        posRef.current.set(nb, { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r });
        visibleRef.current.add(nb);
      });
      runLayout(EXPAND_ROUNDS, true);
    }
    setSelected((cur) => (cur === id ? null : id));
    focusOnNode(id);
  };

  // 卡片视图「在图上聚焦」：切回网络视图，必要时把节点及其邻居播种进布局
  const focusInGraph = (id: string) => {
    setViewMode('network');
    if (!visibleRef.current.has(id)) {
      posRef.current.set(id, { x: W / 2, y: H / 2 });
      visibleRef.current.add(id);
      const nbs = [...(adj.get(id) || [])].filter((n) => !visibleRef.current.has(n));
      const k = Math.sqrt((W * H) / Math.max(4, visibleRef.current.size));
      nbs.forEach((nb, i) => {
        const a = (i / Math.max(1, nbs.length)) * Math.PI * 2;
        posRef.current.set(nb, { x: W / 2 + Math.cos(a) * k * 1.6, y: H / 2 + Math.sin(a) * k * 1.6 });
        visibleRef.current.add(nb);
      });
      runLayout(EXPAND_ROUNDS, true, () => focusOnNode(id));
    } else {
      setTimeout(() => focusOnNode(id), 60);
    }
    setSelected(id);
  };

  /* ---------- 渲染数据 ---------- */
  const visibleIds = visibleRef.current;
  const visibleNodes = graph.nodes.filter((n) => visibleIds.has(n.id));
  const visibleEdges = graph.edges.filter((e) => visibleIds.has(e.a) && visibleIds.has(e.b));
  const selNode = selected ? graph.nodes.find((n) => n.id === selected) : null;
  const neighborSet = selected ? adj.get(selected) : undefined;
  const expandedCount = visibleIds.size;

  return (
    <div>
      {/* 视图切换 + 缩放控制 */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          <button
            className={`px-2.5 py-1 flex items-center gap-1 transition-colors ${viewMode === 'network' ? 'bg-teal-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            onClick={() => setViewMode('network')}
          >
            <Network size={12} /> 网络视图
          </button>
          <button
            className={`px-2.5 py-1 flex items-center gap-1 border-l border-inherit transition-colors ${viewMode === 'cards' ? 'bg-teal-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            onClick={() => setViewMode('cards')}
          >
            <List size={12} /> 卡片列表
          </button>
        </div>
        {viewMode === 'network' && (
          <div className="flex items-center gap-1 ml-auto">
            <button title="缩小" onClick={() => zoomByCenter(1 / 1.2)} className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600">
              <Minus size={13} />
            </button>
            <button title="放大" onClick={() => zoomByCenter(1.2)} className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600">
              <Plus size={13} />
            </button>
            <button title="重置视图（适应全部已展开节点）" onClick={fitView} className="p-1 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-teal-600">
              <RotateCcw size={13} />
            </button>
          </div>
        )}
      </div>

      {autoCards && viewMode === 'cards' && (
        <div className="text-xs text-amber-600 dark:text-amber-400 mb-2">
          节点较多（{graph.nodes.length}）已切换为列表视图，可点上方按钮切回网络视图（较大图渲染较慢）。
        </div>
      )}
      {viewMode === 'network' && expandedCount < graph.nodes.length && (
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">
          已展开 {expandedCount}/{graph.nodes.length} 个节点 · 点击节点继续展开其一跳邻居 · 空白拖拽平移 / 滚轮缩放
        </div>
      )}

      {viewMode === 'network' ? (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-[300px] sm:h-[420px] rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 touch-none select-none"
            onPointerDown={(e) => {
              pannedRef.current = false;
              panRef.current = { px: e.clientX, py: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (d) {
                d.moved = true;
                const p = clientToGraph(e.clientX, e.clientY);
                posRef.current.set(d.id, p);
                rerender();
                return;
              }
              const pan = panRef.current;
              if (pan) {
                const rect = svgRef.current!.getBoundingClientRect();
                if (rect.width === 0) return;
                const dx = ((e.clientX - pan.px) / rect.width) * W;
                const dy = ((e.clientY - pan.py) / rect.height) * H;
                if (Math.abs(e.clientX - pan.px) > 2 || Math.abs(e.clientY - pan.py) > 2) {
                  pan.moved = true;
                  pannedRef.current = true;
                }
                setView((v) => ({ ...v, tx: pan.tx + dx, ty: pan.ty + dy }));
              }
            }}
            onPointerUp={() => {
              dragRef.current = null;
              panRef.current = null;
            }}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
              {/* 超大透明背景：承接空白点击取消 + 平移 */}
              <rect x={-3000} y={-3000} width={7000} height={7000} fill="transparent" onClick={() => { if (!pannedRef.current) setSelected(null); }} />
              {visibleEdges.map((e, i) => {
                const pa = posRef.current.get(e.a);
                const pb = posRef.current.get(e.b);
                if (!pa || !pb) return null;
                const isDup = e.type === 'dup';
                const dim = !!selected && e.a !== selected && e.b !== selected && !neighborSet?.has(e.a) && !neighborSet?.has(e.b);
                return (
                  <line
                    key={i}
                    x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                    stroke={isDup ? '#f43f5e' : 'var(--brand-500)'}
                    strokeWidth={isDup ? 1.6 : Math.min(3, 0.5 + e.weight * 0.5)}
                    strokeDasharray={isDup ? '5 4' : undefined}
                    opacity={dim ? 0.08 : isDup ? 0.85 : 0.3 + Math.min(0.4, e.weight * 0.1)}
                  >
                    <title>{isDup ? `重复关系` : `共引 ${e.weight} 篇文档`}</title>
                  </line>
                );
              })}
              {visibleNodes.map((nd) => {
                const p = posRef.current.get(nd.id);
                if (!p) return null;
                const isSel = selected === nd.id;
                const isNeighbor = !!neighborSet?.has(nd.id);
                const dim = !!selected && !isSel && !isNeighbor;
                const r = 4 + Math.min(11, Math.log10((nd.citationCount || 0) + 1) * 3.5);
                const color = venueColor.get(nd.venue || '未标注') || '#94a3b8';
                return (
                  <circle
                    key={nd.id}
                    cx={p.x} cy={p.y} r={r}
                    fill={color}
                    fillOpacity={dim ? 0.15 : isSel ? 1 : 0.85}
                    stroke={isSel ? '#0f172a' : '#fff'}
                    strokeWidth={isSel ? 2.5 : 1}
                    className="dark:stroke-slate-900 cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      cancelAnimationFrame(animRef.current);
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      dragRef.current = { id: nd.id, moved: false };
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      const d = dragRef.current;
                      dragRef.current = null;
                      if (d && !d.moved) onNodeClick(nd.id);
                    }}
                  >
                    <title>{`${nd.title}（${nd.year || 'n.d.'}）被引 ${nd.citationCount}`}</title>
                  </circle>
                );
              })}
            </g>
          </svg>

          {/* 图例 */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="text-slate-400">颜色 = venue（前 6）</span>
            {[...venueColor.entries()].slice(0, 6).map(([v, c]) => (
              <span key={v} className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                {v.slice(0, 12) || '未标注'}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="w-6 border-t border-dashed border-rose-500" /> 重复文献
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-6 border-t border-[var(--brand-500)]" /> 共引关系
            </span>
          </div>
        </>
      ) : (
        /* 卡片列表视图：>100 节点兜底 */
        <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
          {graph.nodes.map((nd) => {
            const deg = adj.get(nd.id)?.size || 0;
            const isSel = selected === nd.id;
            const rs = nd.readingStatus || 'unread';
            return (
              <div
                key={nd.id}
                onClick={() => setSelected(isSel ? null : nd.id)}
                className={`w-full text-left border rounded-lg p-3 cursor-pointer transition-colors ${isSel ? 'border-teal-400 bg-teal-50/50 dark:bg-teal-900/10' : 'border-slate-100 dark:border-slate-800 hover:border-teal-300'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{nd.title}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      {nd.year || 'n.d.'} · {nd.venue || '未标注'} · 被引 {nd.citationCount}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge tone="slate">邻居 {deg}</Badge>
                    <Badge tone={READING_TONE[rs] || 'slate'}>{READING_LABEL[rs] || rs}</Badge>
                  </div>
                </div>
                {deg > 0 && (
                  <button
                    className="mt-1.5 text-[11px] text-teal-600 dark:text-teal-400 hover:underline"
                    onClick={(e) => { e.stopPropagation(); focusInGraph(nd.id); }}
                  >
                    在图上聚焦 →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 选中详情卡（两视图共用） */}
      {selNode && (
        <div className="mt-3 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-3">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{selNode.title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {selNode.year || 'n.d.'} · {selNode.venue || '未标注'} · 被引 {selNode.citationCount} · 阅读状态 {READING_LABEL[selNode.readingStatus || 'unread'] || (selNode.readingStatus || 'unread')}
          </div>
          {selNode.tags?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selNode.tags.map((t) => (
                <Badge key={t} tone="teal">{t}</Badge>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" className="text-xs" onClick={() => onViewRef?.(selNode.id)}>
              去文献库查看
            </Button>
            {viewMode === 'cards' && (adj.get(selNode.id)?.size || 0) > 0 && (
              <Button variant="outline" className="text-xs" onClick={() => focusInGraph(selNode.id)}>
                <Network size={12} /> 在图上定位
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
