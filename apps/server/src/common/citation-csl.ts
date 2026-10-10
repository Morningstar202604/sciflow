/**
 * CSL-JSON 构造工具（shared：references + documents 共用）
 *
 * 将数据库 reference 行转换为 citation-js 可消费的 CSL-JSON 格式，
 * 避免在 ReferencesService 与 DocumentsService 中各自实现。
 */

import { parseAuthors } from './authors';

/** 从 authors JSON 字符串生成 CSL-JSON author 数组 */
export function toCslAuthors(authorsJson: string | null): { family: string; given: string }[] {
  const arr = parseAuthors(authorsJson);
  if (arr.length === 0) return [];
  return arr.filter(Boolean).map((name) => {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const family = parts.pop() || '';
    const given = parts.join(' ');
    return { family, given };
  });
}

/** DB reference 行 → CSL-JSON 条目（符合 citation-js Cite 输入格式） */
export function buildCslEntry(row: {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
}) {
  return {
    id: row.id,
    type: 'article-journal' as const,
    title: row.title,
    author: toCslAuthors(row.authors),
    issued: row.year ? { 'date-parts': [[row.year]] } : undefined,
    'container-title': row.venue || undefined,
    DOI: row.doi || undefined,
  };
}

/** 批量 DB reference 行 → CSL-JSON 条目数组 */
export function buildCslEntries<T extends { id: string; title: string; authors: string | null; year: number | null; venue: string | null; doi: string | null }>(rows: T[]) {
  return rows.map(buildCslEntry);
}
