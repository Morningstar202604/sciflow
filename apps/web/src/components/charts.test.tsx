import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { jsonText } from './ui';
import { HBar } from './charts';

// 本文件覆盖两个真实缺陷的回归护栏（2026-10-15 修复）：
//   1) jsonText 收到「已 parse 过的对象」时崩溃（raw.trim is not a function）
//      —— /api/quality/latest 等接口会 parseJson 后再返回，与 DB 原样回传的字符串形态并存
//   2) HBar 把 barHeight 当整图高度使用（resolvedHeight = height ?? barHeight ?? 240），
//      调用方传 5/6/7 时图表被压成 5px、柱条全部折叠到同一像素行，Recharts 因此报重复 key

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

describe('HBar（柱高语义回归）', () => {
  it('barHeight 是「单条厚度」而非整图高度：容器高度随条目数自适应', () => {
    render(<HBar items={[{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }]} barHeight={6} />);
    const h = Number(screen.getByTestId('chart-container').getAttribute('data-height'));
    // 修复前：高度 = barHeight = 6（被压成 6px）；修复后：≥ 条目数 ×(厚度+行距)
    expect(h).toBeGreaterThan(40);
  });

  it('显式 height 优先于自适应', () => {
    render(<HBar items={[{ label: 'a', value: 1 }]} barHeight={6} height={200} />);
    expect(screen.getByTestId('chart-container').getAttribute('data-height')).toBe('200');
  });

  it('空数据：渲染占位而非崩溃', () => {
    render(<HBar items={[]} />);
    expect(screen.getByText(/No bars to show/i)).toBeTruthy();
  });
});
