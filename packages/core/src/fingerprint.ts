import { createHash } from 'node:crypto';

/**
 * 标题归一化指纹（全项目统一来源：knowledge + references + pipeline 共用）
 * 规则：lowercase + 去标点空白（保留字母数字与中日韩），取短 md5（项目内去重依据）
 */
export function fingerprint(title: string): string {
  const norm = (title || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
  if (!norm) return '';
  return createHash('md5').update(norm).digest('hex').slice(0, 16);
}
