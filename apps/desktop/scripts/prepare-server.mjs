#!/usr/bin/env node
/**
 * SciFlow 桌面端 · 打包资源准备
 *
 * 产出到 apps/desktop/resources/（electron-builder extraResources 引用）：
 *   resources/bundle/server/  自包含后端 bundle（pnpm deploy 产出：dist + 生产 node_modules，原生模块可用）
 *   resources/web/            前端静态产物（apps/web/dist）
 *
 * 为什么多一层 resources/bundle/：electron-builder 的 extraResources 过滤器硬编码
 * `if (relative === "node_modules") return false`（app-builder-lib/out/util/filter.js），
 * 会把 from 目录根级的 node_modules 静默丢弃 —— 实测导致 0.4.1 安装包缺少全部生产依赖（1.42GB→100MB）。
 * 放进二级目录后相对路径不再是 "node_modules"，复制正常。
 *
 * 前置：已执行 pnpm --filter @sciflow/server build 与 pnpm --filter @sciflow/web build
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // apps/desktop/scripts
const desktopDir = path.resolve(here, '..'); // apps/desktop
const repoRoot = path.resolve(desktopDir, '..', '..'); // 仓库根
const resourcesDir = path.join(desktopDir, 'resources');
const bundleRoot = path.join(resourcesDir, 'bundle');
const serverBundleDir = path.join(bundleRoot, 'server');
const webDir = path.join(resourcesDir, 'web');

const step = (msg) => console.log(`\x1b[36m[prepare]\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m[prepare]\x1b[0m ${msg}`);

function assertBuilt() {
  const serverDist = path.join(repoRoot, 'apps', 'server', 'dist', 'main.js');
  const webDist = path.join(repoRoot, 'apps', 'web', 'dist', 'index.html');
  if (!fs.existsSync(serverDist)) {
    console.error('\x1b[31m[prepare]\x1b[0m 缺少后端构建产物，请先执行：pnpm --filter @sciflow/server build');
    process.exit(1);
  }
  if (!fs.existsSync(webDist)) {
    console.error('\x1b[31m[prepare]\x1b[0m 缺少前端构建产物，请先执行：pnpm --filter @sciflow/web build');
    process.exit(1);
  }
}

/** 递归删除目录（仅限本次生成的 resources 子目录，路径受控） */
function cleanDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  step('校验构建产物…');
  assertBuilt();
  ok('后端 dist 与前端 dist 均就绪');

  // ---------- 1. server bundle：pnpm deploy（pnpm 官方部署机制） ----------
  step('生成自包含 server bundle（pnpm deploy --prod）…');
  cleanDir(bundleRoot);
  cleanDir(serverBundleDir);
  execSync(`pnpm --filter @sciflow/server deploy --legacy --prod "${serverBundleDir}"`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  // deploy 不复制 .env（也不应该：密钥不入包），写一个空模板提示运行时经设置页/环境变量配置
  const bundleEnv = path.join(serverBundleDir, '.env.example');
  fs.writeFileSync(bundleEnv, '# 桌面端通常无需此文件：AI Key 在应用「设置」页配置（存本地数据库）。\n');
  ok(`server bundle 就绪：${serverBundleDir}`);

  // ---------- 1.5 Electron ABI：为内嵌 Node 重编原生模块 ----------
  // 背景：server bundle 的 better-sqlite3 在开发机按 Node ABI 编译；Electron 内嵌 Node 的 ABI
  // 与系统 Node 不同（Node24=137 / Electron38 内嵌 Node22=127），不重编会在运行时报 ERR_DLOPEN_FAILED。
  // 本步骤读取 desktop 的 electron 版本，按 Electron 目标重编（幂等：ABI 戳一致则跳过）。
  step('为 Electron ABI 重编原生模块（better-sqlite3）…');
  const electronPkgPath = path.join(desktopDir, 'node_modules', 'electron', 'package.json');
  if (!fs.existsSync(electronPkgPath)) {
    console.error('\x1b[31m[prepare]\x1b[0m 未找到 electron（请先 pnpm install）');
    process.exit(1);
  }
  const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;

  /** 在 server bundle 内定位 better-sqlite3 模块目录（pnpm .pnpm 布局优先，回退深搜 binding.gyp） */
  function findBetterSqlite3(rootDir) {
    const pnpmDir = path.join(rootDir, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const hit = fs.readdirSync(pnpmDir).find((d) => d.startsWith('better-sqlite3@'));
      if (hit) {
        const dir = path.join(pnpmDir, hit, 'node_modules', 'better-sqlite3');
        if (fs.existsSync(path.join(dir, 'binding.gyp'))) return dir;
      }
    }
    const stack = [rootDir];
    while (stack.length) {
      const d = stack.pop();
      let entries = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const full = path.join(d, e.name);
        if (e.name === 'better-sqlite3' && fs.existsSync(path.join(full, 'binding.gyp'))) return full;
        if (e.name === '.pnpm' || e.name === 'node_modules' || e.name === 'build' || e.name === 'deps' || e.name === 'src' || e.name === 'lib') stack.push(full);
      }
    }
    return null;
  }

  const sqliteDir = findBetterSqlite3(serverBundleDir);
  if (!sqliteDir) {
    console.warn('\x1b[33m[prepare]\x1b[0m 未在 bundle 内找到 better-sqlite3（跳过 ABI 重编）');
  } else {
    const abiStamp = path.join(sqliteDir, '.electron-abi');
    const binary = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
    const upToDate = fs.existsSync(binary) && fs.existsSync(abiStamp) && fs.readFileSync(abiStamp, 'utf8').trim() === electronVersion;
    if (upToDate) {
      ok(`better-sqlite3 已是 Electron ${electronVersion} ABI（跳过）`);
    } else {
      // 统一使用系统 CA（部分内网/企业证书环境需要）；Windows 走 node-gyp + MSVC，无需 shell 特判
      execSync(
        `npx --yes node-gyp rebuild --release --target=${electronVersion} --dist-url=https://electronjs.org/headers`,
        { cwd: sqliteDir, stdio: 'inherit', shell: true, env: { ...process.env, NODE_OPTIONS: '--use-system-ca' } },
      );
      fs.writeFileSync(abiStamp, electronVersion);
      ok(`better-sqlite3 已按 Electron ${electronVersion} ABI 重编`);
    }
  }

  // ---------- 2. web 静态产物 ----------
  step('复制前端产物…');
  cleanDir(webDir);
  await fs.promises.cp(path.join(repoRoot, 'apps', 'web', 'dist'), webDir, { recursive: true });
  ok(`web 资源就绪：${webDir}`);

  // ---------- 3. 体积报告 ----------
  const dirSize = (d) => {
    let total = 0;
    if (!fs.existsSync(d)) return 0;
    for (const f of fs.readdirSync(d, { withFileTypes: true, recursive: true })) {
      if (f.isFile()) {
        try {
          total += fs.statSync(path.join(f.parentPath ?? f.path, f.name)).size;
        } catch {
          /* race */
        }
      }
    }
    return total;
  };
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  step(`体积：server=${mb(dirSize(serverBundleDir))} · web=${mb(dirSize(webDir))}`);
  ok('资源准备完成');
}

main().catch((e) => {
  console.error('\x1b[31m[prepare]\x1b[0m 失败:', e);
  process.exit(1);
});
