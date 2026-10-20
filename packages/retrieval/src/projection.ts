/**
 * 二维投影（PCA）— 用于知识库语义地图。
 *
 * 为什么手写而不是引 umap-js：需求只是「把 384 维向量压到 2D 看聚簇」，
 * UMAP/t-SNE 是几十 KB 起步的重依赖，而 PCA 这里只需 ~60 行线性代数，
 * 且结果稳定可复现（UMAP 有随机性，每次刷新图形会跳变）。
 * 若将来需要更好的局部结构保持，再按 §7 守则评估引入。
 *
 * 实现要点：
 *  - 先中心化（减去每维均值）
 *  - 用幂迭代求协方差矩阵前两个主成分（比完整特征分解快，且不需要依赖）
 *  - 输出归一化到 [0,1] 便于前端直接映射像素
 */

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** 向量点积 */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 向量归一化（零向量返回原样） */
function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** 用幂迭代求矩阵乘向量的主特征向量 */
function powerIterate(
  applyMatrix: (v: number[]) => number[],
  dim: number,
  seed: number,
  iterations = 60,
): number[] {
  // 确定性初始化（不用 Math.random，保证同一输入每次投影结果一致）
  let v: number[] = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.7);
  v = normalize(v);
  for (let it = 0; it < iterations; it++) {
    const next = applyMatrix(v);
    const norm = Math.sqrt(dot(next, next));
    if (norm < 1e-12) break;
    for (let i = 0; i < dim; i++) next[i] /= norm;
    v = next;
  }
  return v;
}

/**
 * 把 N 个 D 维向量投影到 2D。
 * @param vectors 每个元素等长（维度不足时按 0 补齐）
 */
export function projectTo2D(vectors: ArrayLike<number>[]): ProjectedPoint[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = Math.max(...vectors.map((v) => v.length));
  if (n === 1) return [{ x: 0.5, y: 0.5 }];

  // 1) 中心化
  const mean: number[] = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < v.length; d++) mean[d] += v[d];
  }
  for (let d = 0; d < dim; d++) mean[d] /= n;

  const centered: number[][] = vectors.map((v) => {
    const out: number[] = new Array(dim).fill(0);
    for (let d = 0; d < dim; d++) out[d] = (v[d] ?? 0) - mean[d];
    return out;
  });

  // 2) 协方差矩阵的「乘向量」算子（避免显式构造 D×D 矩阵）
  const applyCov = (x: number[]): number[] => {
    const out: number[] = new Array(dim).fill(0);
    for (const c of centered) {
      const w = dot(c, x);
      for (let d = 0; d < dim; d++) out[d] += w * c[d];
    }
    return out;
  };

  const pc1 = powerIterate(applyCov, dim, 1.0);

  // 3) 第二个主成分：在「去掉 pc1 方向」的子空间里再做幂迭代
  const applyDeflated = (x: number[]): number[] => {
    const proj = dot(x, pc1);
    const out = applyCov(x);
    for (let d = 0; d < dim; d++) out[d] -= proj * pc1[d] * dot(pc1, pc1);
    return out;
  };
  const pc2 = powerIterate(applyDeflated, dim, 7.0);

  // 4) 投影
  const raw = centered.map((c) => ({ x: dot(c, pc1), y: dot(c, pc2) }));

  // 5) 归一化到 [0,1]（退化情况给 0.5）
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return raw.map((p) => ({
    x: (p.x - minX) / spanX,
    y: (p.y - minY) / spanY,
  }));
}

/** BLOB(Float32) → number[] */
export function blobToVector(blob: Buffer | Uint8Array | null | undefined): number[] {
  if (!blob) return [];
  const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  // 必须按字节偏移读取：Buffer 可能来自共享内存池，直接 .buffer 会读错区间
  const out: number[] = new Array(Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
}

/**
 * 数据量大时下采样（保持各文档相对比例）。
 * 超过上限时按等间隔抽样，返回被选中的下标（确定性，不随机）。
 */
export function downsampleIndices(total: number, limit: number): number[] {
  if (total <= limit) return Array.from({ length: total }, (_, i) => i);
  const step = total / limit;
  return Array.from({ length: limit }, (_, i) => Math.min(total - 1, Math.floor(i * step)));
}
