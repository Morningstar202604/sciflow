# SciFlow 方向修正 + 完整可用化 — 交付报告

> 日期：2026-10-13 · 工作目录：`C:\Users\X1882\Desktop\github\agent\sciflow`
> 目标：把被误删的完整功能集还原，并把项目修复成**可以打包成 exe 的完整智能体**。

---

## 一、背景与方向判断

工作树在某个时刻做了一次大规模"精简"，删除了 **48 个文件**、改动了 **52 个文件**，导致项目退回成"没有桌面端、没有 Agent 轨迹、没有 MCP、没有记忆中心"的残缺版。经核对 git 历史（`9f697e6` 即为 v0.2.2 竞品对齐提交），确认这些删除**不是维护方向**，而是误伤。按你的要求"不砍、修完整"，本次执行了**全量还原 + 真修复 + 集成改进**。

---

## 二、恢复的 48 个删除文件（已全部还原）

### 桌面端（10）
- `apps/desktop/` 全套：`electron/main.ts`（主进程）、`preload.ts`、`server-manager.ts`（内嵌 NestJS 后端）、`auto-updater.ts`、`electron-builder.yml`、`package.json`、`tsconfig.json`、`README.md`、`scripts/prepare-server.mjs`、`build/icon-512.png`、`build/icon.png`

### 后端模块（22）
- `agent/`：agent-trace.controller.ts / module.ts / service.ts（Agent 轨迹追踪）
- `experiments/`：实验沙箱 3 文件
- `judgment/`：审稿判断 3 文件
- `mcp/`：MCP 工具 3 文件
- `memory/`：记忆中心 3 文件
- `research/`：submission.controller.ts / submission.service.ts（投稿流程）
- `websearch/`：web 搜索 3 文件
- `types/shims.d.ts`

### 前端页面（4+1）
- `ExperimentsPage.tsx`、`MemoryPage.tsx`、`SubmissionPage.tsx`、`settings/McpToolList.tsx`

### 文档与品牌（9）
- `docs/BRAND.md`、`docs/brand/`（5 个 Logo 资源）、`docs/website.html`、`docs/sciflow-code-tree.html`

### 脚本（2）
- `scripts/full_regression.py`、`scripts/generate-icons.mjs`

---

## 三、保留并修复的改进（25 个文件，均为叠加式改进，非删除）

### 已完成的真实修复（B 类独立改进）
| 文件 | 内容 |
|---|---|
| `main.ts` | 启动安全闸：非回环绑定必须 `AUTH_MODE=jwt` |
| `common/sse.helper.ts` | SSE `onComplete` 回调（对话摘要的驱动源） |
| `chat/chat.controller.ts` | 新增 `GET /api/chat/sessions` + 流结束记录摘要 |
| `chat/chat.service.ts` | 注入 ChatSessionService，保留 MemoryService 双记忆 |
| `chat/chat.module.ts` | 注册 ChatSessionService provider/export |
| `documents/*` | 版本快照（对标 git commit）+ commit-message |
| `pipeline/pipeline.service.ts` | 断点续跑防覆盖 + 起草前自动快照 + 质量门最高分选优 |
| `ai/ai.service.ts` | 评审 JSON 解析失败显式报错（不再静默当 0 分） |
| `ai/ai-transport.service.ts` | 密钥解密读取 + 移除 mockMode 死代码 + 429 重试类型修正 |
| `settings/settings.service.ts` | 密钥 AES-256-GCM 加密落库（保留 MCP CRUD） |
| `auth/auth.module.ts` | **AuthModule 全局化**（修复 agent-trace/websearch 的 JwtService 依赖解析崩溃） |
| `agent/agent-trace.controller.ts` | **路由前缀修复** `api/agent` → `agent`（原来与全局前缀叠加成 `/api/api/agent`） |
| `websearch/websearch.controller.ts` | **路由前缀修复** `api/web` → `web` |

### 新增的 4 个文件（未跟踪 → 纳入）
- `chat/chat-session.service.ts`（跨会话记忆注入）
- `chat/chat-session.service.spec.ts`（7 个测试）
- `cli.ts`（headless CLI 入口，9 子命令）
- `common/secret-crypto.ts`（API Key 加密）

### 配置与文档
- `pnpm-workspace.yaml`：删除占位符，`node-llama-cpp: false → true`（关键修复：允许其原生二进制编译）
- `.github/workflows/ci.yml`：filter 名修正为 `@sciflow/server` / `@sciflow/web`
- 版本号统一 `0.3.0`（server / web / desktop / 根 package.json）
- `cli.ts` 版本号 `CLI_VERSION = '0.3.0'`
- `CHANGELOG.md`：新增 v0.3.0 条目，修正 v0.2.2 超前描述（AgentTracePage 前端面板实际未实现）
- `apps/server/package.json`：`p-limit`/`p-retry` 移入生产依赖（桌面端 pnpm deploy 需要）；`better-sqlite3` 锁 `~11.9.0`
- `apps/desktop/scripts/prepare-server.mjs`：pnpm v11 适配 `deploy --legacy`
- `apps/server/tsconfig.json`：排除 `**/*.spec.ts`（生产构建不拉入测试文件）

### sqlite-vec 启动报错（真修，根因已定位）
原代码 `require.resolve('sqlite-vec/better-sqlite3')` 必然失败——该包 `exports` 只允许 `.` 子路径，会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。改用官方 `require('sqlite-vec').getLoadablePath()` 按平台解析预编译扩展。**已验证 Windows 下 `vec_version()=v0.1.9`，启动日志不再报错。**

---

## 四、验证结果

| 验证项 | 结果 |
|---|---|
| `pnpm install`（全 workspace 4 包） | ✅ 通过（electron / better-sqlite3 原生编译成功） |
| `pnpm --filter @sciflow/server typecheck` | ✅ 通过 |
| `pnpm --filter @sciflow/server build` | ✅ 通过 |
| `pnpm --filter @sciflow/web typecheck` | ✅ 通过 |
| `pnpm --filter @sciflow/web build` | ✅ 通过（Memory/Experiments/Submission 页面均打进产物） |
| 后端启动（Node 22.23.3） | ✅ **完整启动**：sqlite-vec 加载、node-llama-cpp 就绪、Nest 全部模块注册 |
| `/api/health` | ✅ `{"status":"ok","db":true,"authMode":"none"}` |
| 恢复模块 API | ✅ memory / mcp / experiments / judgment / submission / chat sessions 全部 200 |
| 修复后的路由 | ✅ `/api/agent/executions` 200、`/api/web/search` 201 |
| 单元测试（单文件） | ✅ 14/14 全绿（chat-session 7 + documents 7） |
| 桌面端 `build:main`（tsc） | ✅ 通过 |
| 桌面端 `prepare:resources` | ✅ server bundle + web 资源打包完成 |
| 桌面端 `dist:dir`（electron-builder） | ✅ **产出 `release/win-unpacked/SciFlow.exe`（188MB）** |
| `SciFlow.exe` 启动冒烟 | ✅ 启动 10 秒存活不崩溃 |

---

## 五、遗留问题（非阻塞，需你知悉）

1. **Node 版本要求**：本项目在 **Node 22 LTS**（22.23.3 已验证）下全链路正常。Node 24 下 `better-sqlite3` 在进程退出时可能触发 `RemoveEnvironmentCleanupHook` 原生断言崩溃（安装/测试/退出时偶发）。已通过锁 `better-sqlite3@~11.9.0` 缓解，但**生产/开发环境建议固定 Node 22**。
2. **vitest 多文件 runner**：Node 24 下同时跑多个 spec 文件时 worker 崩溃；**单个文件全部通过**（14/14）。CI（Ubuntu + Node 22）不受影响。
3. **桌面端完整安装包（NSIS）**：`dist:win` 在 winCodeSign 解压时需要创建符号链接（darwin 部分），当前用户权限（非管理员/未开开发者模式）下失败。`--dir` 模式已成功产出可运行目录；如需出 `setup.exe`，请以管理员身份运行打包或开启 Windows 开发者模式。
4. **AgentTrace 前端面板**：CHANGELOG v0.2.2 提到的 `AgentTracePage.tsx` 实际未在代码库中实现（历史超前描述）。后端 API 已就绪，前端面板待后续补做。
5. **`apps/desktop/release/` 与 `resources/` 是构建产物**：已由 `.gitignore` 覆盖，不入库。

---

## 六、后续建议（按优先级）

1. **固定 Node 22**：建议在 `package.json` 加 `"engines": { "node": ">=22.13 <24" }`，并在 README 明确推荐 Node 22 LTS。
2. **补 AgentTrace 前端面板**（对标 Cursor/Cline/OpenHands 轨迹视图），后端已就绪。
3. **CI 补桌面端 `--dir` 构建**（不依赖 winCodeSign 的路径已验证可行）。
4. **集成 MCP 官方 SDK**：现有 `mcp.service.ts` 为手写实现（314 行），可评估迁移到 `@modelcontextprotocol/sdk`，减少自维护协议代码。
5. **完成 winCodeSign 权限后出正式安装包**：管理员运行 `pnpm --filter @sciflow/desktop dist:win` 即可产出 NSIS `setup.exe`。

---

## 七、最终 git 状态

- **25 个文件 M**（全部是本次叠加的改进/修复，无删除）
- **4 个文件 ??**（新纳入：chat-session.service / spec / cli.ts / secret-crypto.ts）
- 无 D、无冲突。改动全部留在工作树，**未 commit**，供你审阅。