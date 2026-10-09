/**
 * WritingPage 子组件共享的引用样式定义与格式化工具函数。
 * 从原 WritingPage.tsx 抽出，避免循环依赖。
 */

/** 引用样式元数据：8 种前端自实现 + bibtex（后端） */
export type CiteStyleMeta = { value: string; label: string; inText: string; numbered: boolean };

export const CITE_STYLES: CiteStyleMeta[] = [
  { value: 'apa', label: 'APA 7', inText: '(Author, Year)', numbered: false },
  { value: 'ieee', label: 'IEEE', inText: '[n]', numbered: true },
  { value: 'vancouver', label: 'Vancouver', inText: '[n]', numbered: true },
  { value: 'gbt', label: 'GB/T 7714', inText: '[n]', numbered: true },
  { value: 'nature', label: 'Nature', inText: '[n]', numbered: true },
  { value: 'chicago', label: 'Chicago 著者-年', inText: '(Surname Year)', numbered: false },
  { value: 'springer', label: 'Springer', inText: '[n]', numbered: true },
  { value: 'acs', label: 'ACS', inText: '[n]', numbered: true },
];

/** 参考文献条目精简形态 */
export type RefLite = { title: string; authors: string; year: number | null; venue: string; doi: string };

/* ---- 作者解析工具 ---- */

/** 单个作者元素归一化为展示用姓名字符串：字符串/对象/null 兼容 */
export function authorToName(a: unknown): string {
  if (typeof a === 'string') return a.trim();
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    if (typeof o.family === 'string' && o.family.trim()) {
      return typeof o.given === 'string' && o.given.trim() ? `${o.given.trim()} ${o.family.trim()}`.trim() : o.family.trim();
    }
  }
  return '';
}

/** 解析 authors 字段为字符串作者数组（兼容 JSON 串/数组/null） */
export function parseAuthorArr(authors: string | unknown[] | null | undefined): string[] {
  let raw: unknown = [];
  if (typeof authors === 'string') {
    try {
      raw = JSON.parse(authors || '[]');
    } catch {
      return [];
    }
  } else if (Array.isArray(authors)) {
    raw = authors;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(authorToName).filter(Boolean);
}

/** "First Middle Last" -> "Last" */
export function surnameOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : a;
}

/** "First Middle Last" -> "F. M." */
export function initialsOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase()).join('. ') + (parts.length ? '.' : '');
}

/* ---- 单条参考文献格式化 ---- */

/**
 * 按给定样式格式化单条参考文献条目（文末列表）。
 * 8 种前端自实现样式 + bibtex 由后端处理（不在本函数内）。
 */
export function formatRefEntry(ref: RefLite, format: string, index: number): string {
  const arr = parseAuthorArr(ref.authors);
  const year = ref.year ? `${ref.year}` : 'n.d.';
  const venue = ref.venue || '';
  const doi = ref.doi ? ` https://doi.org/${ref.doi}` : '';
  const t = ref.title || 'Untitled';

  const apaAuthors = arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : `${arr[0]} et al.`;
  const iniOf = (a: string) => initialsOf(a).replace(/\.\s?/g, '');
  const ieeeAuthors = arr.map((a) => (iniOf(a) ? `${initialsOf(a)} ${surnameOf(a)}` : surnameOf(a))).join(', ');
  const vanAuthors = arr.map((a) => `${surnameOf(a)} ${iniOf(a)}`.trim()).join(', ');
  const semiAuthors = arr.map((a) => `${surnameOf(a)}${iniOf(a) ? `, ${initialsOf(a)}` : ''}`).join('; ');
  const gbtAuthors = arr.length === 0 ? '佚名' : arr.length === 1 ? arr[0] : arr.length > 3 ? `${arr[0]} 等` : arr.join(', ');

  switch (format) {
    case 'ieee':
      return `[${index}] ${ieeeAuthors || 'Anonymous'} "${t},"${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'vancouver':
      return `${index}. ${vanAuthors || 'Anonymous'} ${t}.${venue ? ` ${venue}.` : ''} ${year}.${doi}`;
    case 'gbt':
      return `[${index}] ${gbtAuthors}. ${t}[J].${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'nature': {
      const names = arr.slice(0, 6).map((a) => `${iniOf(a)} ${surnameOf(a)}`.trim()).join(', ');
      return `[${index}] ${names || 'Anonymous'}${arr.length > 6 ? ' et al.' : ''}. ${t}. ${venue} ${year}.${doi}`;
    }
    case 'chicago': {
      const names =
        arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
      return `${names}. ${year}. "${t}."${venue ? ` ${venue}.` : ''}${doi}`;
    }
    case 'springer':
    case 'acs':
      return `[${index}] ${semiAuthors || 'Anonymous'}. ${t}. ${venue} ${year}.${doi}`;
    case 'apa':
    default:
      return `${apaAuthors} (${year}). ${t}.${venue ? ` ${venue}.` : ''}${doi}`;
  }
}
