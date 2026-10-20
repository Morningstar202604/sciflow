import { describe, expect, it } from 'vitest';
import { summarizeStepOutput } from './PipelineDag';

/**
 * DAG 步骤摘要（回归护栏）
 *
 * 实测缺陷（2026-10-20，截图取证）：大纲步骤的 output 是一整段 JSON，
 * 直接渲染会把 DAG 行高撑成多行，并在窄列里横向溢出。摘要必须：
 *  - 大纲 → 标题 + 章节数（信息量最高，且长度可控）
 *  - 质量门 → 总分
 *  - 其他/非 JSON → 单行压缩 + 硬截断（永不换行、永不超长）
 */
describe('summarizeStepOutput', () => {
  it('大纲 JSON：抽取标题与章节数，不残留 JSON 符号', () => {
    const out = summarizeStepOutput(
      'outline',
      JSON.stringify({ title: '图神经网络研究综述', sections: [{ title: '引言' }, { title: '方法' }, { title: '结论' }] }),
    );
    expect(out).toBe('图神经网络研究综述（3 章）');
    expect(out).not.toContain('{');
    expect(out).not.toContain('subsections');
  });

  it('质量门 JSON：抽取总分', () => {
    expect(summarizeStepOutput('quality-gate', JSON.stringify({ totalScore: 87, dims: {} }))).toBe('总分 87/100');
  });

  it('非 JSON 文本：压缩换行并截断到上限', () => {
    const out = summarizeStepOutput('literature', '检索到 2 条\n文献 2 / 知识 0');
    expect(out).toBe('检索到 2 条 文献 2 / 知识 0');
    expect(out).not.toContain('\n');
  });

  it('超长文本：严格不超过上限（含省略号）', () => {
    const out = summarizeStepOutput('topic-verify', 'x'.repeat(500), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('空输出：返回空串（调用方据此不渲染该行）', () => {
    expect(summarizeStepOutput('outline', '')).toBe('');
    expect(summarizeStepOutput('outline', '   \n  ')).toBe('');
  });

  it('畸形成功 JSON（非对象）：不抛错，退化为原文截断', () => {
    expect(() => summarizeStepOutput('outline', '[1,2,3]')).not.toThrow();
    expect(summarizeStepOutput('outline', '[1,2,3]')).toBe('[1,2,3]');
  });
});
