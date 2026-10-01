/**
 * 作者字段三形态归一化（与前端 WritingPage/DocExporter 的 authorToName/parseAuthorArr 逐口径对齐）：
 *  - 字符串元素：直接 trim 使用；
 *  - 对象元素：取 name；缺省时回退 family（再拼 given，given 在前）——兼容知识库上传/SQL 直插产生的对象数组形态；
 *  - null / 坏 JSON / 非数组：降级为空数组。
 *
 * 历史后端多处用 `arr.map(String)` 处理 authors，遇到 `[{name}]` 对象数组会渲染成 `[object Object]`。
 * 这里统一替换该逻辑；输出形状保持「字符串数组」不变（调用方按需 join）。
 */

/** 单个作者元素归一化为展示用姓名字符串；不可解析返回空串（由上层 filter 过滤） */
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

/**
 * 解析 authors 字段为字符串作者数组。
 * 兼容：JSON 字符串（历史存储形态）、已是对象/字符串数组、null/空值/坏 JSON。
 * 字符串数组路径与旧实现输出一致；对象元素不再产生 `[object Object]`。
 */
export function parseAuthors(input: string | unknown[] | null | undefined): string[] {
  let raw: unknown = [];
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input || '[]');
    } catch {
      return [];
    }
  } else if (Array.isArray(input)) {
    raw = input;
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(authorToName).filter(Boolean);
}

/** 归一化后拼成展示用作者串（逗号分隔）；空数组返回空串 */
export function authorsToString(input: string | unknown[] | null | undefined): string {
  return parseAuthors(input).join(', ');
}
