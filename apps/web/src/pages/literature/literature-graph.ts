import type { GraphEdge } from '../../types';

export type Pt = { x: number; y: number };
export type View = { scale: number; tx: number; ty: number };

export const VENUE_COLORS = ['#0d9488', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#10b981'];
export const W = 900;
export const H = 600;
export const SEED_CAP = 70; // 初始种子簇节点上限（大图先只放核心连通分量）
export const EXPAND_ROUNDS = 90; // 每次展开邻居后重跑的 FR 轮次
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 3;

// FR 单步：对可见节点两两斥力、可见边引力，原地改写 pos，返回衰减后的温度
export function frStep(
  pos: Map<string, Pt>,
  ids: string[],
  idx: Map<string, number>,
  edges: GraphEdge[],
  k: number,
  disp: Pt[],
  temp: number,
): number {
  const n = ids.length;
  for (let i = 0; i < n; i++) { disp[i].x = 0; disp[i].y = 0; }
  for (let i = 0; i < n; i++) {
    const pi = pos.get(ids[i])!;
    for (let j = i + 1; j < n; j++) {
      const pj = pos.get(ids[j])!;
      let dx = pi.x - pj.x;
      let dy = pi.y - pj.y;
      let d = Math.hypot(dx, dy);
      if (d < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 1; }
      const f = (k * k) / d;
      const ux = dx / d;
      const uy = dy / d;
      disp[i].x += ux * f; disp[i].y += uy * f;
      disp[j].x -= ux * f; disp[j].y -= uy * f;
    }
  }
  for (const e of edges) {
    const i = idx.get(e.a);
    const j = idx.get(e.b);
    if (i === undefined || j === undefined) continue;
    const pi = pos.get(ids[i])!;
    const pj = pos.get(ids[j])!;
    const dx = pi.x - pj.x;
    const dy = pi.y - pj.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const f = (d * d) / k;
    const ux = dx / d;
    const uy = dy / d;
    disp[i].x -= ux * f; disp[i].y -= uy * f;
    disp[j].x += ux * f; disp[j].y += uy * f;
  }
  for (let i = 0; i < n; i++) {
    const pi = pos.get(ids[i])!;
    const m = Math.hypot(disp[i].x, disp[i].y) || 0.01;
    const lim = Math.min(m, temp);
    pi.x += (disp[i].x / m) * lim;
    pi.y += (disp[i].y / m) * lim;
    pi.x += (W / 2 - pi.x) * 0.01; // 轻微向心牵引防漂移
    pi.y += (H / 2 - pi.y) * 0.01;
  }
  return temp * 0.92;
}
