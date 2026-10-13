import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 供应商 API Key 落库加密（AES-256-GCM）。
 *
 * 威胁模型：本地单用户工具最大的真实泄露面是「数据库文件被复制/备份/截图」——
 * 明文 api_key 会让备份文件等同于凭据本身。此处让库内只存密文，
 * 主密钥来自 SCIFLOW_SECRET（显式配置优先），否则在数据库同目录生成 .sciflow.key。
 *
 * 密文格式：`v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>`；
 * 无该前缀的值按历史明文处理，启动时一次性就地加密。
 */

const PREFIX = 'v1:';
const KEY_LEN = 32;
const IV_LEN = 12;

let cachedKey: Buffer | null = null;
let keyDir: string | null = null;

/** 由数据库引导层注入密钥目录（与 DB 同目录，绝不落 cwd） */
export function configureSecrets(dir: string): void {
  keyDir = dir;
}

function keyFilePath(): string {
  if (!keyDir) throw new Error('SecretStore 未初始化：必须先调用 configureSecrets(dbDir)');
  return join(keyDir, '.sciflow.key');
}

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envSecret = process.env.SCIFLOW_SECRET?.trim();
  if (envSecret) {
    cachedKey = scryptSync(envSecret, 'sciflow-provider-key', KEY_LEN);
    return cachedKey;
  }
  const file = keyFilePath();
  if (existsSync(file)) {
    cachedKey = Buffer.from(readFileSync(file, 'utf-8').trim(), 'hex');
    if (cachedKey.length === KEY_LEN) return cachedKey;
  }
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  cachedKey = randomBytes(KEY_LEN);
  writeFileSync(file, cachedKey.toString('hex'), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows 下 mode 由 ACL 决定，忽略 */
  }
  console.log(`[Secret] 已生成主密钥文件：${file}（请与数据库同等保护；丢失则库内 Key 不可恢复）`);
  return cachedKey;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** 加密明文 Key；空串原样返回（未配置 Key 的厂商不应产生密文行） */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (isEncrypted(plain)) return plain;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

/** 解密；非密文原样返回（兼容历史明文），密文损坏时返回空串并告警 */
export function decryptSecret(stored: string | null | undefined): string {
  const value = String(stored ?? '');
  if (!value || !isEncrypted(value)) return value;
  try {
    const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf-8');
  } catch (e: any) {
    console.warn(`[Secret] api_key 解密失败（主密钥是否变更？）: ${e?.message || e}`);
    return '';
  }
}

/** 一次性迁移：把库中历史明文 api_key 就地加密 */
export function encryptLegacyKeys(
  run: (sql: string) => Array<Record<string, string | null>>,
  write: (id: string, encrypted: string) => void,
): number {
  let migrated = 0;
  for (const row of run('SELECT id, api_key FROM model_provider')) {
    const raw = row['api_key'] ?? '';
    if (!raw || isEncrypted(raw)) continue;
    write(String(row.id ?? ''), encryptSecret(raw));
    migrated += 1;
  }
  if (migrated > 0) console.log(`[Secret] 已加密 ${migrated} 条历史明文 api_key`);
  return migrated;
}
