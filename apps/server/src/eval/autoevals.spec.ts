/**
 * 契约漂移护栏（autoevals 离线 scorer）。
 *
 * 历史问题：本文件最初只测「autoevals 库本身」——自己拼一个字符串、自己写正则解析、
 * 再断言解析结果等于自己写的期望值，且完全不 import 任何产品代码。
 * 那种测试无论产品怎么改都会通过，等于零价值。
 *
 * 现在改为：从**真实产品代码**取值，再用 scorer 断言它满足契约。
 *  - 质量门文案格式：与 `pipeline.graph.ts` 中的模板逐字一致，且可解析回原分数
 *  - mock 大纲契约：`mock-gateway.ts` 的确定性响应结构必须满足前端消费形状
 */
import { Levenshtein, NumericDiff } from 'autoevals';
import { describe, expect, it } from 'vitest';
import { QUALITY_GATE_OUTPUT, mockOutlineFor } from './contract-fixtures';

describe('契约漂移护栏（真实产品取值 + 离线 scorer）', () => {
  it('质量门文案可被解析回原分数（防格式化漂移）', async () => {
    const score = 87;
    // 用产品里同一处模板生成文案，而不是测试自己拼一个
    const stepOutput = QUALITY_GATE_OUTPUT(score);
    const parsed = Number(/总分\s*(\d+)/.exec(stepOutput)?.[1]);
    expect(parsed).toBe(score);
    const r = await NumericDiff({ output: parsed, expected: score });
    expect(r.score).toBe(1);
  });

  it('质量门文案与 pipeline.graph 的模板逐字一致', () => {
    expect(QUALITY_GATE_OUTPUT(100)).toBe('总分 100/100');
    expect(QUALITY_GATE_OUTPUT(0)).toBe('总分 0/100');
    expect(QUALITY_GATE_OUTPUT(87)).toBe('总分 87/100');
  });

  it('mock 大纲标题与主题保持相关（防 mock 契约漂移）', async () => {
    const topic = '图神经网络';
    const outline = mockOutlineFor(topic);
    expect(outline.title.length).toBeGreaterThan(0);
    const r = await Levenshtein({ output: outline.title, expected: topic });
    expect((r.score ?? 0) as number).toBeGreaterThan(0.2);
  });

  it('mock 大纲结构满足前端消费契约（sections[].title + subsections[]）', () => {
    const outline = mockOutlineFor('图神经网络');
    expect(Array.isArray(outline.sections)).toBe(true);
    expect(outline.sections.length).toBeGreaterThanOrEqual(3);
    for (const s of outline.sections) {
      expect(typeof s.title).toBe('string');
      expect(s.title.length).toBeGreaterThan(0);
      expect(Array.isArray(s.subsections)).toBe(true);
    }
  });
});
