import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 桌面端静态产物契约（防「打开后白屏」回归）
 *
 * 背景（2026-10-22 用户实测反馈「打开软件什么都没有」）：
 *   1) web 用默认 base='/' 构建 → index.html 里是 /assets/*.js
 *      Electron 用 file:// 加载时被解析成 file:///C:/assets/... → 全部 404 → 白屏。
 *   2) 改成相对路径后仍然白屏：file:// 页面 origin 为 null，Chromium 按 CORS
 *      拒绝加载 `<script type="module">`（Access to script ... blocked by CORS policy）。
 *   最终方案：Electron 注册 app:// 自定义协议（standard+secure）提供 resources/web。
 *
 * 本测试守住两点：
 *   - 构建产物必须是相对路径（否则 app:// 之外的任何加载方式都会错位）
 *   - 桌面主进程必须使用 app:// 而非 loadFile（否则再次白屏）
 */

// __dirname = <repo>/apps/desktop/src → 上三级到仓库根
const repoRoot = path.resolve(__dirname, '..', '..', '..');

describe('桌面端静态产物契约', () => {
  it('web 构建产物使用相对资源路径（无 /assets 绝对引用）', () => {
    const indexPath = path.join(repoRoot, 'apps', 'web', 'dist', 'index.html');
    if (!existsSync(indexPath)) {
      // 未构建时跳过（CI 会在 build 之后跑该测试）
      return;
    }
    const html = readFileSync(indexPath, 'utf-8');
    const abs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(abs, `index.html 含绝对路径：${abs.join(', ')}`).toEqual([]);
  });

  it('桌面主进程通过 app:// 协议加载页面，不使用 file://', () => {
    const mainPath = path.join(repoRoot, 'apps', 'desktop', 'electron', 'main.ts');
    const src = readFileSync(mainPath, 'utf-8');
    expect(src).toContain("loadURL('app://sciflow/index.html')");
    expect(src).not.toContain("loadFile(path.join(process.resourcesPath, 'web', 'index.html'))");
  });

  it('主进程注册了 standard + secure 的自定义协议（ES module 才能在自定义协议下加载）', () => {
    const src = readFileSync(path.join(repoRoot, 'apps', 'desktop', 'electron', 'main.ts'), 'utf-8');
    expect(src).toContain('registerSchemesAsPrivileged');
    expect(src).toMatch(/standard:\s*true/);
    expect(src).toMatch(/secure:\s*true/);
    expect(src).toContain('protocol.handle');
  });

  it('打包脚本在复制前强校验前端产物为相对路径', () => {
    const src = readFileSync(path.join(repoRoot, 'apps', 'desktop', 'scripts', 'prepare-server.mjs'), 'utf-8');
    expect(src).toContain('assertWebRelative');
    expect(src).toMatch(/process\.exit\(1\)/);
  });

  it('桌面端构建 web 时显式传 --base=./', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf-8'));
    expect(pkg.scripts['build:web']).toContain('--base=./');
    expect(pkg.scripts['prepare:resources']).toContain('build:web');
  });
});
