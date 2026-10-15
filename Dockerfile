# ============ 构建阶段：全量安装 + 双端编译 ============
FROM node:22-alpine AS build
# 版本与仓库 packageManager 保持一致（此前写 pnpm@9，与 lockfile 混用会产生解析歧义）
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
# 桌面端（Electron）不参与容器构建：跳过其二进制下载，避免无谓的 ~100MB 拉取
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# workspace 声明为 apps/*，锁文件含 desktop importer；补其 package.json 以保证 frozen 校验一致，
# 再按 filter 只装 web/server（不装 electron 依赖树）
COPY apps/desktop/package.json apps/desktop/
RUN pnpm install --frozen-lockfile --filter @sciflow/server --filter @sciflow/web
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @sciflow/server build && pnpm --filter @sciflow/web build

# ============ 后端运行时 ============
FROM node:22-alpine AS server
WORKDIR /app
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/apps/server
EXPOSE 3000
# AI 配置经环境变量注入（AI_BASE_URL / AI_API_KEY / AI_MODEL），勿把 .env 打进镜像
CMD ["node", "dist/main.js"]

# ============ 前端运行时（nginx 静态 + /api 反代） ============
FROM nginx:alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
