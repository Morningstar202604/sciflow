/**
 * JSON 解析安全守卫（全项目统一来源，替代 6 处重复的 try-catch JSON.parse 模板）
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

/** 安全解析 tags JSON 字符串 → string[] */
export function parseTagsJson(tags: string | null | undefined): string[] {
  return parseJsonArray<string>(tags, []);
}
