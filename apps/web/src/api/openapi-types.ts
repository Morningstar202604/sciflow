/**
 * OpenAPI 生成类型入口（openapi-typescript 产物在 ./openapi.d.ts，源：openapi.json ← NestJS Swagger）。
 * 重新生成：仓库根 `pnpm openapi:gen`。
 * 用途：为新端点提供类型化契约（渐进迁移 client.ts；paths 可组合出 openapi-fetch 客户端）。
 */
export type { paths, components, operations } from './openapi';
