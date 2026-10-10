# SciFlow 桌面端（Electron）

SciFlow 的电脑应用端：**内嵌 NestJS 后端 + 本地 SQLite，开箱即用、离线可用**。

```
┌─ SciFlow 桌面应用 ──────────────────────────────┐
│  BrowserWindow（React 前端，file:// 加载）        │
│      ↕ fetch http://127.0.0.1:<自动端口>/api     │
│  内嵌后端（ELECTRON_RUN_AS_NODE 运行 NestJS）     │
│      ↕                                          │
│  SQLite（%APPDATA%/SciFlow/sciflow.db · WAL）    │
└─────────────────────────────────────────────────┘
```

## 数据与日志位置（平台规范 userData）

| 平台 | 数据目录 |
|---|---|
| Windows | `%APPDATA%\SciFlow`（sciflow.db / logs\server.log） |
| macOS | `~/Library/Application Support/SciFlow` |
| Linux | `~/.config/SciFlow` |

删除该目录即可完全重置到出厂状态。

## 开发调试

前置：仓库根目录已 `pnpm install`，且已构建 `apps/server/dist`。

```bash
# 终端 1：前端 dev server
pnpm dev:web

# 终端 2：桌面端（自动构建主进程 + 启动内嵌后端 + 加载 localhost:5173）
pnpm desktop:dev
```

- 前端改动走 Vite 热更新；主进程（electron/*.ts）改动需重跑 `pnpm desktop:dev`。
- 内嵌后端日志：`%APPDATA%\SciFlow\logs\server.log`。
- AI Key 可在应用「设置」页配置（存本地库），或启动前设 `AI_BASE_URL / AI_API_KEY / AI_MODEL` 环境变量传入。

## 打包分发

```bash
# 0) 生成应用图标（首次：SVG 母版 → build/icon.png）
pnpm icons

# 1) 构建后端与前端
pnpm build

# 2) 打包（自动：pnpm deploy 生成自包含 server bundle → electron-builder）
pnpm desktop:dist          # 当前平台
pnpm --filter @sciflow/desktop dist:win      # Windows NSIS 安装包
pnpm --filter @sciflow/desktop dist:mac      # macOS DMG（x64+arm64）
pnpm --filter @sciflow/desktop dist:linux    # Linux AppImage/deb

# 产物：apps/desktop/release/
```

## 自动更新（企业可选）

默认**完全关闭**（本地优先，不偷偷联网）。企业自托管更新源：

```
启动时设置环境变量 SCIFLOW_UPDATE_URL=https://your-intra.example/updates/
```

源目录放 electron-builder 产出的 `latest.yml` + 安装包即可；应用启动会检查、提示后下载。

## 打包原理（为什么不重复造轮子）

| 环节 | 方案 |
|---|---|
| 后端运行时 | Electron 自带 Node：`process.execPath` + `ELECTRON_RUN_AS_NODE=1`，不分发独立 Node |
| server 依赖 | `pnpm deploy --prod`：pnpm 官方部署命令，产出真实文件（非 symlink）的自包含 node_modules，原生模块（better-sqlite3 / sqlite-vec）开箱可用 |
| 前端资源 | 复用 `apps/web/dist`，与 Web 端完全同源（一码三端） |
| API 地址 | preload 经 contextBridge 注入 `window.sciflowDesktop.apiBase`，前端 `client.ts` 统一拼接（Web 端行为零变化） |
| 端口冲突 | 每次启动内核分配空闲端口，杜绝 3000 被占用 |
| 图标 | `docs/brand/icon-master.svg` 单一母版 → `scripts/generate-icons.mjs`（resvg）渲染 PNG，electron-builder 自动转 ico/icns |
