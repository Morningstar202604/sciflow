import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 鉴权面护栏（静态契约测试）
 *
 * 背景（2026-10-20 审计）：agent-trace / websearch 两个 controller 同时写了
 * 类级 `@UseGuards(JwtAuthGuard)` 与方法级 `@Public()`。`@Public()` 会被全局
 * JwtAuthGuard 读取并直接放行 —— 等于在 AUTH_MODE=jwt 下把执行轨迹、prompt、
 * token 用量、搜索配置完全对外开放，而类级守卫看起来"已经保护"了它，极易漏审。
 *
 * 因此把「哪些 controller 允许出现 @Public()」固化为契约：
 * 只允许 auth（登录/注册）与 health（探活）。
 */

const SRC = path.resolve(__dirname, '..');

function collectControllers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectControllers(full, acc);
    } else if (entry.name.endsWith('.controller.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const ALLOWED = new Set(['auth.controller.ts', 'health.controller.ts']);

describe('鉴权面契约：@Public() 白名单', () => {
  const controllers = collectControllers(SRC);

  it('至少扫描到全部 controller（防止 glob 失效导致空跑通过）', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(18);
  });

  it('除 auth / health 外，任何 controller 都不得标注 @Public()', () => {
    const violations: string[] = [];
    for (const file of controllers) {
      const name = path.basename(file);
      if (ALLOWED.has(name)) continue;
      const text = readFileSync(file, 'utf-8');
      if (text.includes('@Public()')) violations.push(path.relative(SRC, file));
    }
    expect(violations, `以下 controller 在鉴权模式下会被 @Public() 绕过：${violations.join(', ')}`).toEqual([]);
  });

  it('agent-trace 与 websearch 的每个端点都受类级守卫保护（不再有 Public 标注）', () => {
    for (const name of ['agent/agent-trace.controller.ts', 'websearch/websearch.controller.ts']) {
      const text = readFileSync(path.join(SRC, name), 'utf-8');
      expect(text).toContain('@UseGuards(JwtAuthGuard)');
      expect(text).not.toContain('@Public()');
    }
  });
});
