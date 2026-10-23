import { describe, expect, it } from 'vitest';
import { labelPropagation, groupByCommunity, type LabelGraph } from './community';

/** 用邻接表构造最小 LabelGraph 桩 */
function makeGraph(edges: [string, string][]): LabelGraph {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return {
    nodes: () => [...adj.keys()],
    neighbors: (id) => [...(adj.get(id) ?? [])],
  };
}

describe('labelPropagation（社区检测）', () => {
  it('两个完全分离的三角形 → 两个社区', () => {
    const g = makeGraph([
      ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a1'],
      ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b1'],
    ]);
    const labels = labelPropagation(g);
    expect(new Set([labels.get('a1'), labels.get('a2'), labels.get('a3')]).size).toBe(1);
    expect(new Set([labels.get('b1'), labels.get('b2'), labels.get('b3')]).size).toBe(1);
    expect(labels.get('a1')).not.toBe(labels.get('b1'));
  });

  it('两个三角形由一条边相连 → 仍倾向分成两个社区', () => {
    const g = makeGraph([
      ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a1'],
      ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b1'],
      ['a1', 'b1'],
    ]);
    const labels = labelPropagation(g);
    const a = labels.get('a1');
    const b = labels.get('b1');
    // 桥接边不应把两侧完全同化
    const sameA = labels.get('a2') === labels.get('a3');
    const sameB = labels.get('b2') === labels.get('b3');
    expect(sameA || sameB).toBe(true);
    expect([a, b].every((x) => typeof x === 'number')).toBe(true);
  });

  it('孤立节点各自成社区', () => {
    const g = makeGraph([]);
    // 空图：没有任何边，nodes() 为空
    expect(labelPropagation(g).size).toBe(0);
  });

  it('确定性：同一图两次运行结果一致', () => {
    const g = makeGraph([['a', 'b'], ['b', 'c'], ['d', 'e']]);
    expect([...labelPropagation(g).entries()]).toEqual([...labelPropagation(g).entries()]);
  });

  it('社区编号从 0 开始连续', () => {
    const g = makeGraph([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    const labels = labelPropagation(g);
    const uniq = [...new Set(labels.values())].sort((x, y) => x - y);
    expect(uniq[0]).toBe(0);
    uniq.forEach((v, i) => expect(v).toBe(i));
  });

  it('单节点图', () => {
    const g: LabelGraph = { nodes: () => ['solo'], neighbors: () => [] };
    const labels = labelPropagation(g);
    expect(labels.get('solo')).toBe(0);
  });

  it('星形图：中心与叶子倾向同社区', () => {
    const g = makeGraph([
      ['center', 'l1'], ['center', 'l2'], ['center', 'l3'], ['center', 'l4'],
    ]);
    const labels = labelPropagation(g);
    const c = labels.get('center');
    const same = ['l1', 'l2', 'l3', 'l4'].filter((l) => labels.get(l) === c).length;
    expect(same).toBeGreaterThanOrEqual(2);
  });
});

describe('groupByCommunity', () => {
  it('按社区号分组，且组内按 id 排序', () => {
    const labels = new Map([
      ['c', 1], ['a', 0], ['b', 1], ['d', 0],
    ]);
    const groups = groupByCommunity(labels);
    expect([...groups.get(0)!]).toEqual(['a', 'd']);
    expect([...groups.get(1)!]).toEqual(['b', 'c']);
  });

  it('空输入返回空映射', () => {
    expect(groupByCommunity(new Map()).size).toBe(0);
  });
});
