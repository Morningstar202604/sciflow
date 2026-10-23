import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { envFloat, envInt } from './env';

const ORIGINAL = { ...process.env };

describe('envInt / envFloat（环境变量数值安全解析）', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL };
    console.warn = () => {};
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('未设置：回落默认值', () => {
    delete process.env.TEST_X;
    expect(envInt('TEST_X', 42)).toBe(42);
  });

  it('空串：回落默认值（不当作 0）', () => {
    process.env.TEST_X = '   ';
    expect(envInt('TEST_X', 42)).toBe(42);
  });

  it('合法整数：正常解析', () => {
    process.env.TEST_X = '7';
    expect(envInt('TEST_X', 42)).toBe(7);
  });

  it('非法值：回落默认值而非 NaN —— 这是核心保护（否则 pLimit(NaN) 会让并发闸门失效）', () => {
    process.env.TEST_X = 'abc';
    const v = envInt('TEST_X', 42);
    expect(v).toBe(42);
    expect(Number.isNaN(v)).toBe(false);
  });

  it('带单位的非法值（10s）：同样回落，不静默变 NaN', () => {
    process.env.TEST_X = '10s';
    expect(envInt('TEST_X', 42)).toBe(42);
  });

  it('小数：整型解析截断；envFloat 保留', () => {
    process.env.TEST_X = '2.9';
    expect(envInt('TEST_X', 1)).toBe(2);
    expect(envFloat('TEST_X', 1)).toBe(2.9);
  });

  it('min/max 夹取：负数与超大值都被约束', () => {
    process.env.TEST_X = '-5';
    expect(envInt('TEST_X', 10, { min: 1 })).toBe(1);
    process.env.TEST_X = '9999';
    expect(envInt('TEST_X', 10, { max: 100 })).toBe(100);
  });

  it('默认值本身也受 min/max 约束', () => {
    delete process.env.TEST_X;
    expect(envInt('TEST_X', 0, { min: 1 })).toBe(1);
  });

  it('Infinity 视为非法（Number("Infinity") 是有限值陷阱）', () => {
    process.env.TEST_X = 'Infinity';
    expect(envInt('TEST_X', 5)).toBe(5);
  });
});
