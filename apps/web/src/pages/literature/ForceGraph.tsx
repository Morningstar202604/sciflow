import { useEffect, useRef } from 'react';
import { Minus, Network, Plus, RotateCcw } from 'lucide-react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';
import type { ReferenceGraph } from '../../types';
import { Button } from '../../components/ui';

/**
 * ReferenceNetwork — 文献引用网络（sigma.js + graphology，替代 477 行手写 SVG 力导向）。
 * 节点颜色=期刊主题色、大小=被引量；边=共引（细灰） / 去重（红）。
 * 交互：拖拽/滚轮缩放/点击节点回调；工具栏提供放大/缩小/重置视图。
 * 布局：ForceAtlas2（graphology 官方实现）一次性求值后渲染（WebGL，大图可用）。
 */

const VENUE_COLORS = ['#0d9488', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981'];
const venueColor = (venue: string): string => {
  let h = 0;
  for (let i = 0; i < venue.length; i++) h = (h * 31 + venue.charCodeAt(i)) | 0;
  return VENUE_COLORS[Math.abs(h) % VENUE_COLORS.length];
};

export function ReferenceNetwork({ graph, onViewRef }: { graph: ReferenceGraph; onViewRef?: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || graph.nodes.length === 0) return;

    // 1) 构图（graphology）：节点 + 去重合并的边
    const g = new Graph({ multi: false, type: 'directed' });
    for (const n of graph.nodes) {
      if (!g.hasNode(n.id)) {
        g.addNode(n.id, {
          label: `${n.title.slice(0, 48)}${n.title.length > 48 ? '…' : ''}\n${n.venue || '未标注期刊'} · ${n.year ?? 'n.d.'}`,
          size: 4 + Math.min(12, (n.citationCount || 0) / 8),
          color: venueColor(n.venue || ''),
          nodeTitle: n.title,
        });
      }
    }
    for (const e of graph.edges) {
      if (!g.hasNode(e.a) || !g.hasNode(e.b) || e.a === e.b) continue;
      if (g.hasEdge(e.a, e.b)) continue;
      g.addEdge(e.a, e.b, {
        color: e.type === 'dup' ? '#f43f5e' : '#cbd5e1',
        size: e.type === 'dup' ? 2 : Math.min(3, 0.6 + (e.weight || 1) * 0.4),
        edgeType: e.type || 'co-cite',
      });
    }

    // 2) ForceAtlas2 布局（迭代次数随规模；Barnes-Hut 大图加速）
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: Math.min(600, 200 + g.order * 4),
        settings: { gravity: 1, scalingRatio: 12, barnesHutOptimize: g.order > 120, slowDown: 2 },
      });
    } else if (g.order === 1) {
      g.setNodeAttribute(g.nodes()[0], 'x', 0);
      g.setNodeAttribute(g.nodes()[0], 'y', 0);
    }

    // 3) sigma 渲染（WebGL）+ 交互
    const sigma = new Sigma(g, el, {
      settings: {
        renderLabels: true,
        labelDensity: 0.35,
        labelGridCellSize: 90,
        labelRenderedSizeThreshold: 6,
      },
    });
    sigma.on('clickNode', ({ node }) => onViewRef?.(node));
    sigma.on('enterNode', ({ node }) => {
      el.title = String(g.getNodeAttribute(node, 'nodeTitle') || '');
    });
    sigmaRef.current = sigma;

    return () => {
      sigmaRef.current = null;
      sigma.kill();
      g.clear();
    };
  }, [graph, onViewRef]);

  const zoom = (f: number) => {
    const cam = sigmaRef.current?.getCamera();
    if (!cam) return;
    cam.animate({ ratio: cam.getState().ratio / f }, { duration: 200 });
  };
  const reset = () => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 250 });
  };

  return (
    <div className="relative w-full h-[520px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" aria-label="文献引用网络（sigma.js 渲染）" />
      <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/85 dark:bg-slate-900/85 backdrop-blur rounded-lg border border-slate-200 dark:border-slate-700 p-1">
        <Button variant="ghost" className="px-2 py-1 text-xs" title="放大" onClick={() => zoom(1.35)}>
          <Plus size={12} />
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" title="缩小" onClick={() => zoom(1 / 1.35)}>
          <Minus size={12} />
        </Button>
        <Button variant="ghost" className="px-2 py-1 text-xs" title="重置视图" onClick={reset}>
          <RotateCcw size={12} />
        </Button>
      </div>
      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400 bg-white/85 dark:bg-slate-900/85 backdrop-blur rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1">
        <span className="flex items-center gap-1">
          <Network size={10} /> {graph.nodes.length} 文献 · {graph.edges.length} 关系
        </span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-rose-400 inline-block" /> 去重</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-300 inline-block" /> 共引</span>
        <span>节点大小=被引量 · 颜色=期刊</span>
      </div>
    </div>
  );
}
