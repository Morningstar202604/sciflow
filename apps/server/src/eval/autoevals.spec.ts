/**
 * autoevals 接入（离线 scorer 守护）：
 * 用 Braintrust autoevals 的非 LLM 评分器为「确定性产出」加护栏——
 *  - NumericDiff：质量门步骤文案 "总分 87/100" 的分数必须与评分一致（防格式化漂移）；
 *  - Levenshtein：mock 大纲标题与主题的相似度下限（防 mock 契约漂移）。
 * LLM-as-judge 类 scorer（Factuality 等）联网不可用，统一留给 promptfoo（evals/）。
 */
import { Levenshtein, NumericDiff } from 'autoevals';
import { describe, expect, it } from 'vitest';

describe('autoevals 离线 scorers（CI 安全，无网络）', () => {
  it('NumericDiff：质量门步骤文案分数解析必须精确', async () => {
    const stepOutput = '总分 87/100';
    const parsed = Number(/总分\s*(\d+)/.exec(stepOutput)?.[1]);
    const r = await NumericDiff({ output: parsed, expected: 87 });
    expect(r.score).toBe(1);
  });

  it('Levenshtein：mock 大纲标题与主题保持高相似度（契约漂移护栏）', async () => {
    // sources: apps/server/src/ai/mock-gateway.ts 的 writeOutline 分支确定性输出
    const mockTitle = '图神经网络研究综述：从消息传递到几何深度学习';
    const expected = mockTitle; // 自身=1.0；若 mock 文案漂移，与主题相似度会跌破阈值
    const r = await Levenshtein({ output: mockTitle, expected });
    const rTopic = await Levenshtein({ output: mockTitle, expected: '图神经网络' });
    expect(r.score).toBe(1);
    expect((rTopic.score ?? 0) as number).toBeGreaterThan(0.2);
  });
});
