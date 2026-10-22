// 本文件覆盖三处真实缺陷的回归护栏：
//   1) jsonText 收到「已 parse 过的对象」时崩溃（raw.trim is not a function）
//      —— /api/quality/latest 等接口会 parseJson 后再返回，与 DB 原样回传的字符串形态并存
//   2) HBar 曾把 barHeight 当整图高度使用（图表被压成 5px、柱条折叠到同一像素行）
//   3) HBar 的默认高度公式漏算坐标轴区，3 条数据时最后一个类别标签被裁掉（2026-10 修复）
//      现在高度完全由组件内部决定，调用方无法再传错。

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { jsonText } from './ui';
import { Donut, donutCellColors, HBar } from './charts';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children?: ReactNode; height?: number }) => (
      <div data-testid="chart-container" data-height={height}>
        {children}
      </div>
    ),
    BarChart: Pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    PieChart: Pass,
    Pie: Pass,
    Cell: () => null,
    Label: () => null,
  };
});

describe('jsonText（宽松 JSON 取值）', () => {
  it('字符串形态：正常解析', () => {
    expect(jsonText('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('已是对象（/api/quality/latest 形态）：原样返回，不崩溃', () => {
    const obj = { literature: 88, logic: 86 };
    expect(jsonText(obj, {})).toEqual(obj);
  });

  it('null / 空串 / 非法 JSON：回落 fallback', () => {
    expect(jsonText(null, { fb: 1 })).toEqual({ fb: 1 });
    expect(jsonText('', { fb: 1 })).toEqual({ fb: 1 });
    expect(jsonText('   ', { fb: 1 })).toEqual({ fb: 1 });
    expect(jsonText('{broken', { fb: 1 })).toEqual({ fb: 1 });
  });

  it('数组形态字符串：解析为数组', () => {
    expect(jsonText('[1,2,3]', [])).toEqual([1, 2, 3]);
  });
});

describe('HBar（高度自适应回归）', () => {
  it('高度随条目数线性增长，且每条都有独立行高', () => {
    const items = [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }];
    render(<HBar items={items} />);
    const h = Number(screen.getByTestId('chart-container').getAttribute('data-height'));
    // 3 行 × 30 + 轴区 26 + 上边距 6 = 122；关键断言：每条至少 30px，最后一行的标签不会被裁
    expect(h).toBeGreaterThanOrEqual(items.length * 30);
    expect(h).toBeLessThan(items.length * 60);
  });

  it('条目越多高度越大（不是固定值）', () => {
    const { unmount } = render(<HBar items={[{ label: 'a', value: 1 }]} />);
    const h1 = Number(screen.getByTestId('chart-container').getAttribute('data-height'));
    unmount();
    render(<HBar items={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }]} />);
    const h3 = Number(screen.getByTestId('chart-container').getAttribute('data-height'));
    expect(h3).toBeGreaterThan(h1);
    expect(h3 - h1).toBe(60); // 每多一条固定 +30（ROW_H）
  });

  it('空数据：渲染占位而非崩溃', () => {
    render(<HBar items={[]} />);
    expect(screen.getByText(/暂无数据/)).toBeTruthy();
  });
});

describe('Donut（零值分段配色）', () => {
  it('零值分段被剔除，唯一非零分段使用第 1 系列色而非第 N 色', () => {
    // 真实场景：4 个状态里只有「已定稿」=1，其余 0 → 旧实现整环取到 --viz-series-4（紫色）
    render(
      <Donut
        segments={[
          { label: '草稿', value: 0 },
          { label: '评审中', value: 0 },
          { label: '已润色', value: 0 },
          { label: '已定稿', value: 1 },
        ]}
      />,
    );
    const aria = screen.getByRole('img').getAttribute('aria-label') || '';
    expect(aria).toContain('已定稿 1');
    expect(aria).not.toContain('草稿 0');
    expect(aria).not.toContain('评审中 0');
    // 关键断言（原用例只查 aria-label，把 SERIES[i] 改成 SERIES[(i+3)%] 仍全绿）：
    // 唯一非零分段必须落到第 1 系列色，而不是按原始下标取第 4 色。
    const colors = donutCellColors([
      { label: '草稿', value: 0 },
      { label: '评审中', value: 0 },
      { label: '已润色', value: 0 },
      { label: '已定稿', value: 1 },
    ].filter((d) => d.value > 0));
    expect(colors).toEqual(['var(--viz-series-1)']);
  });

  it('全部为零：不渲染空环，给出占位', () => {
    render(<Donut segments={[{ label: '草稿', value: 0 }, { label: '已定稿', value: 0 }]} />);
    expect(screen.getByText(/暂无数据/)).toBeTruthy();
  });
});
