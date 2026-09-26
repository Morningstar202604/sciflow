# ============ 构建阶段：全量安装 + 双端编译 ============
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter server build && pnpm --filter web build

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
