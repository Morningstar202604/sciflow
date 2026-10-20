import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

/**
 * 测试进程隔离数据库
 *
 * 历史问题（2026-10-20 复现两次）：多个 spec 文件并行跑在各自 worker 里，
 * 却共用 `apps/server/data/sciflow.db`。WAL 模式下并发写仍会抛
 * `SqliteError: disk I/O error`（busy_timeout 只能缓解锁等待，救不了 WAL 层错误），
 * 表现为「随机某个 spec 文件失败、重跑又绿」——CI 上就是偶发红。
 *
 * 这里给每个 vitest 进程分配独立数据库文件，按 worker 序号 + pid 命名；
 * 进程退出时随临时目录清理（temp 目录由 OS 回收）。
 */
const testDb = path.join(os.tmpdir(), `sciflow-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDb;
// 测试不应加载 384 维本地嵌入模型（慢且非必需）；检索用例走 FTS5 路径
process.env.SCIFLOW_NO_VEC = process.env.SCIFLOW_NO_VEC ?? '1';
process.env.SCIFLOW_SECRET = process.env.SCIFLOW_SECRET ?? 'test-only-secret-not-for-production';

export default defineConfig({
  test: {
    // 同时扫描接口层(src)与能力层(packages)的测试。
    // 历史问题：只 include 'src/**/*.spec.ts'，导致 packages/ 下的测试从未被执行——
    // 写了等于没写（静默不被发现）。
    include: ['src/**/*.spec.ts', '../../packages/*/src/**/*.spec.ts'],
    environment: 'node',
    // 共享同一个 SQLite 文件的 spec 必须串行，否则 WAL 层并发写会随机 I/O error。
    // 单线程下总耗时仍在可接受范围（~15s）；优先保证确定性。
    fileParallelism: false,
  },
});
