import { SetMetadata } from '@nestjs/common';

/** 标记公开端点（AUTH_MODE=jwt 时仍免鉴权）：健康检查、登录、注册 */
export const IS_PUBLIC_KEY = 'sciflow:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
