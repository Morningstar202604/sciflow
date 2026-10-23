/**
 * 环境变量数值解析（安全版）
 *
 * `Number(process.env.X || default)` 在 X 被设成非数字（如 "abc"、"10s"、带空格）时返回 NaN，
 * 且 NaN 会静默穿透到下游：
 *   - `pLimit(NaN)` → 并发闸门失效，可能瞬时打爆端点
 *   - `setTimeout(fn, NaN)` → 视为 0，超时保护变成立即失败
 *   - `Math.max(1, NaN)` → NaN，比较全部为 false，分支走错
 * 这里统一解析：非法值回落默认值并告警一次，合法值再夹到 [min, max]。
 */

const warned = new Set<string>();

export function envInt(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return clamp(fallback, opts);
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[env] ${name}="${raw}" 不是合法数字，已回落默认值 ${fallback}`);
    }
    return clamp(fallback, opts);
  }
  return clamp(Math.trunc(n), opts);
}

export function envFloat(
  name: string,
  fallback: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return clamp(fallback, opts);
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[env] ${name}="${raw}" 不是合法数字，已回落默认值 ${fallback}`);
    }
    return clamp(fallback, opts);
  }
  return clamp(n, opts);
}

function clamp(n: number, { min, max }: { min?: number; max?: number }): number {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}
