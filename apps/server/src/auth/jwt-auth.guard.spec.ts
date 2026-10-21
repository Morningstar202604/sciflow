import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * JwtAuthGuard 行为测试（补充静态 @Public() 白名单契约）。
 *
 * 为什么需要这一层：静态测试只检查源码里有没有 `@UseGuards(JwtAuthGuard)` 字样，
 * 把 guard 本体改成 `return true` 后依然全绿（独立审计的突变实验实测）。
 * 这里直接实例化 guard + 真实 JwtService，用假 ExecutionContext 断言行为：
 * 无 token 401 / 坏 token 401 / 有效 token 放行并挂 req.user / @Public() 放行。
 */

const SECRET = 'test-secret-for-guard';

function ctx(opts: { public?: boolean; authorization?: string }): { context: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { headers: opts.authorization ? { authorization: opts.authorization } : {} };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard 行为', () => {
  const jwt = new JwtService({ secret: SECRET });
  let guard: JwtAuthGuard;
  const originalMode = process.env.AUTH_MODE;
  let currentPublic = false;

  beforeEach(() => {
    // Reflector.getAllAndOverride 在这里用可控桩：由 ctx() 的 public 标记决定
    const reflector = {
      getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? currentPublic : undefined),
    } as unknown as Reflector;
    guard = new JwtAuthGuard(reflector, jwt);
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalMode;
  });

  it('AUTH_MODE=none（本地模式）直接放行，不要求 token', () => {
    process.env.AUTH_MODE = 'none';
    currentPublic = false;
    expect(guard.canActivate(ctx({}).context)).toBe(true);
  });

  it('AUTH_MODE=jwt：无 Authorization 头必须 401', () => {
    process.env.AUTH_MODE = 'jwt';
    currentPublic = false;
    expect(() => guard.canActivate(ctx({}).context)).toThrow(UnauthorizedException);
  });

  it('AUTH_MODE=jwt：伪造/过期 token 必须 401', () => {
    process.env.AUTH_MODE = 'jwt';
    currentPublic = false;
    expect(() => guard.canActivate(ctx({ authorization: 'Bearer not-a-jwt' }).context)).toThrow(UnauthorizedException);
    const wrong = new JwtService({ secret: 'another-secret' }).sign({ sub: 'u1', email: 'a@b.c', role: 'member' });
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${wrong}` }).context)).toThrow(UnauthorizedException);
  });

  it('AUTH_MODE=jwt：有效 token 放行并把 payload 挂到 req.user', () => {
    process.env.AUTH_MODE = 'jwt';
    currentPublic = false;
    const token = jwt.sign({ sub: 'u1', email: 'a@b.c', role: 'admin' });
    const { context, req } = ctx({ authorization: `Bearer ${token}` });
    expect(guard.canActivate(context)).toBe(true);
    expect(req.user).toMatchObject({ sub: 'u1', email: 'a@b.c', role: 'admin' });
  });

  it('AUTH_MODE=jwt：@Public() 端点（登录/健康检查）无需 token', () => {
    process.env.AUTH_MODE = 'jwt';
    currentPublic = true;
    expect(guard.canActivate(ctx({}).context)).toBe(true);
  });

  it('Bearer 前缀大小写与空白：仅接受标准 "Bearer <token>"', () => {
    process.env.AUTH_MODE = 'jwt';
    currentPublic = false;
    const token = jwt.sign({ sub: 'u1', email: 'a@b.c', role: 'member' });
    expect(() => guard.canActivate(ctx({ authorization: token }).context)).toThrow(UnauthorizedException);
    expect(guard.canActivate(ctx({ authorization: `Bearer   ${token}` }).context)).toBe(true);
  });
});
