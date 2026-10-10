#!/usr/bin/env node
/**
 * SciFlow 数据库备份（在线安全备份，不锁库）
 *
 * 原理：better-sqlite3 官方 .backup() API（底层 SQLite Online Backup），
 *       对 WAL 库安全，备份期间业务读写不中断。
 * 策略：输出到 backups/sciflow-<时间戳>.db，默认保留最近 14 份。
 *
 * 用法：
 *   node scripts/backup-db.mjs                    # 默认库（apps/server/data/sciflow.db）
 *   DATABASE_PATH=/x/y.db node scripts/backup-db.mjs
 *   node scripts/backup-db.mjs --keep 7           # 自定义保留份数
 *
 * 定时（企业部署）：cron / Windows 任务计划每天执行；或直接使用 Litestream 实时复制（见 docs/enterprise-transformation-plan.md）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const serverDir = path.join(root, 'apps', 'server');
const require = createRequire(path.join(serverDir, 'package.json')); // 复用 server 的 better-sqlite3，不重复安装

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const KEEP = keepIdx >= 0 ? Math.max(1, Number(args[keepIdx + 1]) || 14) : 14;

const dbPath = process.env.DATABASE_PATH || path.join(serverDir, 'data', 'sciflow.db');
if (!fs.existsSync(dbPath)) {
  console.error(`[backup] 数据库不存在：${dbPath}`);
  process.exit(1);
}

const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(backupDir, `sciflow-${stamp}.db`);

const { default: Database } = require('better-sqlite3');
const src = new Database(dbPath, { readonly: true });
try {
  await src.backup(target);
  const size = fs.statSync(target).size;
  console.log(`[backup] 完成：${target}（${(size / 1024 / 1024).toFixed(2)} MB）`);
} finally {
  src.close();
}

// 保留策略：仅删 sciflow-*.db 前缀的旧备份（精确匹配本工具命名，绝不误删其他文件）
const olds = fs
  .readdirSync(backupDir)
  .filter((f) => /^sciflow-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/.test(f))
  .sort();
while (olds.length > KEEP) {
  const victim = path.join(backupDir, olds.shift());
  fs.rmSync(victim, { force: true });
  console.log(`[backup] 清理旧备份：${path.basename(victim)}`);
}
console.log(`[backup] 当前保留 ${Math.min(olds.length, KEEP)} 份 · 策略 keep=${KEEP}`);
