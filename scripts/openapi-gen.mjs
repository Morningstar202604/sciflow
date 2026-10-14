/**
 * 一键再生成 OpenAPI 产物：
 *   openapi.json（NestJS Swagger 导出，dist/tools/openapi-dump.js）
 *   → apps/web/src/api/openapi.d.ts（openapi-typescript 生成，前端类型化契约）
 *
 * 用法：pnpm openapi:gen（内部先构建 server）
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  // Windows 下 pnpm 是 .cmd，必须走 shell；参数均为静态无空格，拼接安全（避免 DEP0190）
  const r = isWin
    ? spawnSync([cmd, ...args].join(' '), { stdio: 'inherit', shell: true, ...opts })
    : spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`[openapi-gen] 失败：${cmd} ${args.join(' ')}（exit ${r.status}）`);
    process.exit(r.status ?? 1);
  }
}

const dumpScript = join(root, 'apps/server/dist/tools/openapi-dump.js');
if (!existsSync(dumpScript)) {
  console.error('[openapi-gen] 未找到 apps/server/dist/tools/openapi-dump.js，请先构建 server');
  process.exit(1);
}

// 导出用临时库路径，避免碰真实 data/sciflow.db
const tmp = mkdtempSync(join(tmpdir(), 'sciflow-openapi-'));
try {
  run(process.execPath, [dumpScript, 'openapi.json'], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: join(tmp, 'openapi.db') },
    shell: false,
  });
  run('pnpm', ['--filter', '@sciflow/web', 'exec', 'openapi-typescript', '../../openapi.json', '-o', 'src/api/openapi.d.ts'], { cwd: root });
  console.log('[openapi-gen] 完成：openapi.json + apps/web/src/api/openapi.d.ts');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
