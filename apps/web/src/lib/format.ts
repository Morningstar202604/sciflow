/** 数字/字数格式化（纯函数，页面与图表共用） */

/** 中文字数：<1000 显示精确值，>=1000 显示一位小数的 k（如 12.3k） */
export function formatWordCount(chars: number): string {
  const n = Number.isFinite(chars) ? Math.max(0, Math.floor(chars)) : 0;
  if (n < 1000) return `${n} 字`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k 字`;
  return `${Math.round(n / 1000)}k 字`;
}
