#!/usr/bin/env node
/**
 * SciFlow 桌面端 · 打包资源准备
 *
 * 产出到 apps/desktop/resources/（electron-builder extraResources 引用）：
 *   resources/server/   自包含后端 bundle（pnpm deploy 产出：dist + 生产 node_modules，原生模块可用）
 *   resources/web/      前端静态产物（apps/web/dist）
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
const serverBundleDir = path.join(resourcesDir, 'server');
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
  cleanDir(serverBundleDir);
  execSync(`pnpm --filter @sciflow/server deploy --prod "${serverBundleDir}"`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  });
  // deploy 不复制 .env（也不应该：密钥不入包），写一个空模板提示运行时经设置页/环境变量配置
  const bundleEnv = path.join(serverBundleDir, '.env.example');
  fs.writeFileSync(bundleEnv, '# 桌面端通常无需此文件：AI Key 在应用「设置」页配置（存本地数据库）。\n');
  ok(`server bundle 就绪：${serverBundleDir}`);

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
