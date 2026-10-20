import { describe, expect, it } from 'vitest';
import { projectTo2D, blobToVector, downsampleIndices } from './projection';

/**
 * 2D 投影（PCA）回归。
 *
 * 验收标准来自路线图 F-2.2：语义相近的块在地图上应彼此靠近。
 * 这里用合成的「两簇」数据验证：同簇点的投影距离必须显著小于跨簇距离。
 */

/** 生成两簇高维向量：簇心相距很远，簇内加小扰动 */
function twoClusters(nPerCluster = 20, dim = 32): { vectors: number[][]; labels: number[] } {
  const vectors: number[][] = [];
  const labels: number[] = [];
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < nPerCluster; i++) {
      const v: number[] = new Array(dim).fill(0);
      for (let d = 0; d < dim; d++) {
        // 簇心：第 c 簇在偶数维为正、奇数维为负（两簇方向相反）
        const center = d % 2 === 0 ? (c === 0 ? 1 : -1) : c === 0 ? -1 : 1;
        v[d] = center + Math.sin(i * 1.7 + d) * 0.05;
      }
      vectors.push(v);
      labels.push(c);
    }
  }
  return { vectors, labels };
}

describe('projectTo2D', () => {
  it('空输入返回空数组', () => {
    expect(projectTo2D([])).toEqual([]);
  });

  it('单点映射到中心', () => {
    expect(projectTo2D([[1, 2, 3]])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('输出归一化到 [0,1]', () => {
    const { vectors } = twoClusters(10, 16);
    const pts = projectTo2D(vectors);
    expect(pts).toHaveLength(vectors.length);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('同簇点距离显著小于跨簇距离（语义可分离）', () => {
    const { vectors, labels } = twoClusters(20, 32);
    const pts = projectTo2D(vectors);
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    const intra: number[] = [];
    const inter: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        (labels[i] === labels[j] ? intra : inter).push(dist(pts[i], pts[j]));
      }
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(intra)).toBeLessThan(avg(inter) * 0.6);
  });

  it('确定性：同一输入两次投影结果完全一致', () => {
    const { vectors } = twoClusters(8, 12);
    expect(projectTo2D(vectors)).toEqual(projectTo2D(vectors));
  });

  it('维度不齐时按 0 补齐，不抛错', () => {
    const pts = projectTo2D([[1, 2], [1, 2, 3], [0, 0, 0, 5]]);
    expect(pts).toHaveLength(3);
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('全同向量（零方差）不产生 NaN', () => {
    const same = new Array(5).fill([1, 1, 1]);
    const pts = projectTo2D(same);
    for (const p of pts) {
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
    }
  });
});

describe('blobToVector', () => {
  it('Float32 BLOB 往返一致', () => {
    const original = [0.5, -1.25, 3];
    const buf = Buffer.alloc(original.length * 4);
    original.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    expect(blobToVector(buf)).toEqual(original);
  });

  it('空值返回空数组', () => {
    expect(blobToVector(null)).toEqual([]);
    expect(blobToVector(undefined)).toEqual([]);
  });

  it('非 4 字节对齐的缓冲按整 4 字节截断', () => {
    const buf = Buffer.alloc(7);
    buf.writeFloatLE(1.5, 0);
    expect(blobToVector(buf)).toHaveLength(1);
  });
});

describe('downsampleIndices', () => {
  it('未超限返回全部下标', () => {
    expect(downsampleIndices(10, 100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('超限时返回恰好 limit 个且覆盖全区间', () => {
    const idx = downsampleIndices(1000, 100);
    expect(idx).toHaveLength(100);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBeLessThan(1000);
    // 递增（无重复）
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });

  it('确定性', () => {
    expect(downsampleIndices(500, 50)).toEqual(downsampleIndices(500, 50));
  });
});
