import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * 企业认证模块（默认旁路，不破坏本地/桌面零登录体验）
 *
 * - AUTH_MODE=none（默认）：JwtAuthGuard 直接放行，全 API 行为与历史一致；
 * - AUTH_MODE=jwt：全局启用 Bearer Token 校验（@Public() 端点除外）。
 * JWT 密钥：JWT_SECRET（生产必须显式配置）；默认值仅供本地自测。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'sciflow-local-secret-change-me',
      // JWT_EXPIRES 形如 '7d' / '12h'（ms StringValue）；此处收窄类型，非法值由 jwt 运行时报错
      signOptions: { expiresIn: (process.env.JWT_EXPIRES || '7d') as JwtSignOptions['expiresIn'] },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
