/**
 * JSON 解析安全守卫（全项目统一来源，替代散布各处的 try-catch JSON.parse 模板）
 *
 * 用法：
 *   parseJson<OutineBlock[]>(doc.outline, [])
 *   parseStringList(row.keywords)
 *   parseTagsJson(tags)          // 等价于 parseStringList(tags)
 */

/** 安全解析 JSON 字符串为指定类型数组；解析失败或类型不匹配返回 fallback（默认空数组） */
function parseJsonArray<T = string>(json: string | null | undefined, fallback: T[] = [] as any): T[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? parsed.map((x: unknown) => x as T) : fallback;
  } catch {
    return fallback;
  }
}

/** 安全解析 DB JSON 字段为对象（带类型守卫）；解析失败返回 fallback */
export function parseJson<T = unknown>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 安全解析 DB JSON 字段为 string[]；解析失败返回空数组 */
export function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/** 安全解析 tags JSON 字符串 → string[] */
export function parseTagsJson(tags: string | null | undefined): string[] {
  return parseJsonArray<string>(tags, []);
}
