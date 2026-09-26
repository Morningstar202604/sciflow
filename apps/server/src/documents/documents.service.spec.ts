import { describe, it, expect } from 'vitest';
import { formatCitation } from './documents.service';

const ref = {
  title: 'Graph Neural Networks: A Review',
  authors: JSON.stringify(['Thomas Kipf', 'Max Welling', 'Petar Velickovic']),
  year: 2021,
  venue: 'IEEE TPAMI',
  doi: '10.1109/TPAMI.2021.123456',
};

describe('formatCitation 引用格式化', () => {
  it('APA：多作者 → 第一作者 et al.，含年份/期刊/DOI', () => {
    const out = formatCitation(ref, 'apa', 0);
    expect(out).toContain('Thomas Kipf et al.');
    expect(out).toContain('(2021)');
    expect(out).toContain('. IEEE TPAMI');
    expect(out).toContain('https://doi.org/10.1109/TPAMI.2021.123456');
  });

  it('IEEE：[序号] + 姓首字母缩写 + 引号标题', () => {
    const out = formatCitation(ref, 'ieee', 3);
    expect(out).toMatch(/^\[3\] /);
    expect(out).toContain('T. Kipf');
    expect(out).toContain('M. Welling');
    expect(out).toContain('"Graph Neural Networks: A Review,"');
  });

  it('Vancouver：序号 + 姓 首字母 + 期刊年份', () => {
    const out = formatCitation(ref, 'vancouver', 7);
    expect(out).toMatch(/^7\. /);
    expect(out).toContain('Kipf T');
    expect(out).toContain('2021');
  });

  it('空作者 → Anonymous，无年份 → n.d.', () => {
    const out = formatCitation({ ...ref, authors: '[]', year: null as unknown as number }, 'apa', 0);
    expect(out).toContain('Anonymous');
    expect(out).toContain('n.d.');
  });

  it('单作者 APA 不追加 et al.', () => {
    const out = formatCitation({ ...ref, authors: JSON.stringify(['Thomas Kipf']) }, 'apa', 0);
    expect(out).toContain('Thomas Kipf');
    expect(out).not.toContain('et al.');
  });
});
