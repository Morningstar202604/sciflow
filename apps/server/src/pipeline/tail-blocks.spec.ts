import { describe, expect, it } from 'vitest';
import { TAIL_BLOCK_REGEX, findTailBlockStart, splitTailBlock, stripTailBlocks } from './tail-blocks';

/**
 * 尾部块识别回归。
 *
 * 这些用例覆盖两个真实缺陷：
 *  1) 润色时把「参考文献」当正文送进 LLM（学术诚信红线）——识别不到尾部块就会发生；
 *  2) 新增的「研究资料」块未被识别，导致知识库参考被改写、且每轮回炉重复追加。
 */

describe('tail-blocks · 尾部块识别', () => {
  it('识别「参考文献」（二级标题）', () => {
    const content = '## 引言\n\n正文。\n\n## 参考文献\n\n[1] A.\n';
    expect(findTailBlockStart(content)).toBeGreaterThan(0);
    const { body, tail } = splitTailBlock(content);
    expect(body).toBe('## 引言\n\n正文。');
    expect(tail.startsWith('\n\n## 参考文献')).toBe(true);
  });

  it('识别「研究资料」（本轮新增块，旧正则遗漏）', () => {
    const content = '## 引言\n\n正文。\n\n## 研究资料\n\n### 知识库参考\n\n- 《A》\n';
    const { body, tail } = splitTailBlock(content);
    expect(body).toBe('## 引言\n\n正文。');
    expect(tail).toContain('## 研究资料');
    expect(tail).toContain('知识库参考');
  });

  it('识别「图表」与英文 references', () => {
    expect(findTailBlockStart('正文\n\n## 图表\n\n### 图 1')).toBeGreaterThan(0);
    expect(findTailBlockStart('body\n\n## References\n\n[1] A')).toBeGreaterThan(0);
  });

  it('标题级别 1-3 都能识别', () => {
    for (const h of ['#', '##', '###']) {
      expect(findTailBlockStart(`正文\n\n${h} 参考文献\n[1] A`)).toBeGreaterThan(0);
    }
  });

  it('多个尾部块时取最早出现的那个（保证正文切割点正确）', () => {
    const content = '正文\n\n## 研究资料\n\n资料\n\n## 参考文献\n\n[1] A';
    const { body, tail } = splitTailBlock(content);
    expect(body).toBe('正文');
    expect(tail).toContain('## 研究资料');
    expect(tail).toContain('## 参考文献');
  });

  it('无尾部块：body 等于全文，tail 为空', () => {
    const content = '## 引言\n\n正文。\n\n## 方法\n\n方法描述。';
    expect(splitTailBlock(content)).toEqual({ body: content, tail: '' });
    expect(findTailBlockStart(content)).toBe(-1);
  });

  it('正文里出现「参考文献」但不是标题时不误判', () => {
    const content = '## 引言\n\n本文的参考文献包括三篇重要工作。\n\n## 方法\n\n方法。';
    expect(findTailBlockStart(content)).toBe(-1);
  });

  it('stripTailBlocks 去掉尾部块并保留正文', () => {
    const content = '正文内容\n\n## 图表\n\n### 图 1\n\n图示\n\n## 研究资料\n\n资料';
    expect(stripTailBlocks(content)).toBe('正文内容');
  });

  it('stripTailBlocks 对无尾部块的内容只做尾部空白清理', () => {
    expect(stripTailBlocks('正文\n\n')).toBe('正文');
  });

  it('正则不跨行贪婪匹配（避免吞掉后续正文）', () => {
    const content = '正文\n\n## 参考文献\n[1] A\n\n## 附录\n\n附录正文';
    // 尾部块从「参考文献」开始一直到结尾（附录也属于尾部）
    const { body } = splitTailBlock(content);
    expect(body).toBe('正文');
    // 正则本身不匹配换行符
    const m = '## 参考文献\n[1] A'.match(TAIL_BLOCK_REGEX);
    expect(m?.[0] ?? '').not.toContain('\n');
  });
});
