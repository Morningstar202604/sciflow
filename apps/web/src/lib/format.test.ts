import { describe, expect, it } from 'vitest';
import { formatWordCount } from './format';

describe('formatWordCount', () => {
  it('千字以内显示精确字符数（R1）', () => {
    expect(formatWordCount(0)).toBe('0 字');
    expect(formatWordCount(334)).toBe('334 字');
    expect(formatWordCount(999)).toBe('999 字');
  });
  it('千字以上用一位小数 k', () => {
    expect(formatWordCount(1000)).toBe('1.0k 字');
    expect(formatWordCount(12345)).toBe('12k 字');
  });
  it('非法值回落 0，不出现 NaN', () => {
    expect(formatWordCount(Number.NaN)).toBe('0 字');
    expect(formatWordCount(-5)).toBe('0 字');
  });
});
