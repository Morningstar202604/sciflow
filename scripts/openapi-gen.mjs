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

/**
 * 跨平台执行。
 * - node 自身用绝对路径直接 exec（Windows 下若走 shell，`C:\Program Files\...` 的空格会被切碎，
 *   spawnSync 会以 status=null 返回，报出无法定位的 "exit null"）。
 * - 包管理器脚本（pnpm）在 Windows 需经 shell 才能解析 .cmd，但其调用一律不带含空格参数。
 */
export function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(
      `[openapi-gen] 失败：node ${args.join(' ')}（status=${r.status} signal=${r.signal || '-'}${
        r.error ? ` error=${r.error.message}` : ''
      }）`,
    );
    process.exit(r.status ?? 1);
  }
}

function runPnpm(args, opts = {}) {
  const r = isWin
    ? spawnSync(['pnpm', ...args].join(' '), { stdio: 'inherit', shell: true, ...opts })
    : spawnSync('pnpm', args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`[openapi-gen] 失败：pnpm ${args.join(' ')}（status=${r.status}）`);
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
  runNode([dumpScript, 'openapi.json'], {
    cwd: root,
    env: { ...process.env, DATABASE_PATH: join(tmp, 'openapi.db') },
  });
  runPnpm(['--filter', '@sciflow/web', 'exec', 'openapi-typescript', '../../openapi.json', '-o', 'src/api/openapi.d.ts'], { cwd: root });
  console.log('[openapi-gen] 完成：openapi.json + apps/web/src/api/openapi.d.ts');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
