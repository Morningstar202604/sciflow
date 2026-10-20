import { describe, expect, it } from 'vitest';
import { applyStreamDelta, type StreamAggregate } from './stream-accumulator';

/**
 * 回归护栏（2026-10 D1）：工作台曾把「累积全文」当增量再拼一遍，导致输出平方膨胀
 * （实测 5 个分片后长度从 10 膨胀到 31）。这里把累积语义抽成纯函数并钉死契约：
 * onDelta / onReasoning 收到的是「累积值」，消费方必须**赋值**而不是**追加**。
 */
describe('stream-accumulator（流式累积语义）', () => {
  const chunks = ['科研', '科研论文', '科研论文写作', '科研论文写作很重要'];

  it('连续喂累积值：结果等于最后一次的值（不重复拼接）', () => {
    let s: StreamAggregate = { content: '', reasoning: '' };
    for (const c of chunks) s = applyStreamDelta(s, { content: c });
    const expected = chunks[chunks.length - 1];
    expect(s.content).toBe(expected);
    expect(s.content.length).toBe(expected.length);
  });

  it('回归：如果误按「增量」追加会得到膨胀文本（护栏确认差异真实存在）', () => {
    const wrong = chunks.reduce((acc, c) => acc + c, '');
    let s: StreamAggregate = { content: '', reasoning: '' };
    for (const c of chunks) s = applyStreamDelta(s, { content: c });
    expect(wrong.length).toBeGreaterThan(s.content.length);
    expect(s.content).not.toBe(wrong);
  });

  it('reasoning 与 content 各自独立累积', () => {
    let s: StreamAggregate = { content: '', reasoning: '' };
    s = applyStreamDelta(s, { content: 'A', reasoning: '想' });
    s = applyStreamDelta(s, { content: 'AB', reasoning: '想一下' });
    expect(s.content).toBe('AB');
    expect(s.reasoning).toBe('想一下');
  });

  it('空分片不破坏已有内容', () => {
    let s: StreamAggregate = { content: 'abc', reasoning: '' };
    s = applyStreamDelta(s, { content: '' });
    expect(s.content).toBe('abc');
  });

  it('中止后保留已收到内容', () => {
    let s: StreamAggregate = { content: '', reasoning: '' };
    s = applyStreamDelta(s, { content: '部分' });
    s = applyStreamDelta(s, { content: '部分内容' });
    expect(s.content).toBe('部分内容');
  });
});
