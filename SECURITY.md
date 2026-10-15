# 安全策略 · Security Policy

## 项目定位与威胁模型

SciFlow 定位为**单用户、本地/私有部署**的科研助手：SQLite 单文件、不建账号体系、不做多租户。它的主要威胁模型是「LLM 生成的代码 / 输入把本进程搞挂」，而不是「公网上的恶意多租户」。因此我们把安全预算花在：默认不暴露网络、沙箱资源上限、不存密钥、输入校验。

## 安全设计要点

- **默认只监听回环地址**：后端 `main.ts` 默认 `HOST=127.0.0.1`，不对局域网暴露零鉴权 API；确需对外暴露时必须显式 `HOST=0.0.0.0`，并置于反向代理/内网之后。
- **CORS 最小放行**：默认仅 `http://localhost:5173`，多来源用逗号分隔，`*` 需显式配置。
- **密钥不落盘、不入仓**：API Key 仅从环境变量 / 本地 `apps/server/.env` 读取；`.env` 已在 `.gitignore`，CI 会校验 `.env` 从未被跟踪；前端展示 Key 时做掩码处理。
- **实验沙箱隔离**：实验执行通过隔离 `spawn` 运行 Python，带 `SANDBOX_TIMEOUT_MS` 超时与独立工作目录；超时/失败时降级引导，不拖垮主进程。
- **SQL 安全**：全部 SQL 经 Drizzle ORM 参数化，禁止字符串拼接。
- **输入校验**：全局 `InputValidationPipe` 约束 JSON Body；MCP 工具参数按 JSON Schema 动态校验（缺参即拒），第三方工具返回统一加 untrusted-content 提示与指令隔离（对标 OWASP MCP Top 10）。
- **健壮性兜底**：全局 `unhandledRejection` / `uncaughtException` 兜底 + SQLite `busy_timeout` + SIGTERM/SIGINT 优雅关闭（WAL checkpoint 后退出）。
- **mock 网关只听回环**：`AI_MOCK=1` 的测试网关仅绑定 `127.0.0.1`，零外网访问，仅供本机测试/演示。

## 依赖安全与已知残留风险

核对命令（每次发版前必须重跑）：

```bash
# 生产依赖（进入运行时/镜像的闭包）——目标 0 已知漏洞
pnpm audit --registry=https://registry.npmjs.org --prod
# 全量（含 devDependency；devDep 不进入发布产物）
pnpm audit --registry=https://registry.npmjs.org
```

**2026-10-15 依赖安全批次结果**：全量告警 **103 → 3**，生产依赖 **1 low（katex）**，其余 2 条为 devDependency 链路。

已完成的处置：

| 包 | 处置 | 验证 |
|---|---|---|
| `electron` 38.8.6 → **41.10.7** | 关闭 5 条 high（沙箱继承、`<webview>` Node 集成、协议处理器、拖拽等） | 桌面打包成功 + `prepare-server.mjs` 按 Electron ABI 重编 better-sqlite3 |
| `simple-git` → **4.0.2** / `@simple-git/argv-parser` → **2.0.1** | 关闭 2 critical + 3 high（命令注入/配置包含） | 构建 + 全量回归 161/0/0 通过 |
| `tar` → **7.5.22**（仅 7.5.x 受影响区间） | 关闭 1 critical + 多条 high/moderate | 构建 + 桌面打包通过 |
| `shell-quote` → **1.12.0** | 关闭 1 critical | 脚本执行正常 |
| `vite` → **6.4.3**、`vitest`/`@vitest/mocker` → **4.1.11**、`tinypool` | 关闭 critical/moderate（路径穿越、原型污染 RCE） | 单测 16+15 通过 |
| `js-yaml`（仅 5.x 线 → 5.4.3）、`source-map-js` → 1.2.2、`diff` → 8.0.4、`basic-ftp` → 6.2.1、`postcss-selector-parser` → 7.1.6、`semver`（5.x 线）| 关闭 moderate/high/low | `openapi:gen` 通过（js-yaml v4 消费者保持 v4）、Tailwind typography CSS 正常、promptfoo 2/2 |
| `electron-builder` → 26.15.3、`app-builder-lib` / `builder-util-runtime` | 关闭 high | 桌面 NSIS 打包成功 |
| 删除 `pdf-parse`（已被 `unpdf` 取代，零引用）、清理两份陈旧 `package-lock.json` | 消除错误锁文件与冗余依赖面 | `pnpm install --frozen-lockfile` 通过 |

**无法消除的残留（3 条，均已核实无可用修复版）**：

| 包 | 严重度 | 公告要求 | 现状 | 引入路径 | 为何不影响发布产物 |
|---|---|---|---|---|---|
| `katex` | low | `>=0.18.2` | `rehype-katex@7` / `micromark-extension-math@3` 固定 `^0.16.0`，且 0.16 线最新发布就是 **0.16.47** | `apps/web` → rehype-katex / remark-math | 前端已声明 `katex@^0.18.9`（满足补丁）；该传递副本仅被 markdown 数学语法解析链引用，属于**转换期**依赖，不直接渲染用户输入。风险面为原型污染绕过 trust 限制，需同时满足"上游已有原型污染"才有意义 |
| `node-forge` | high | `>=1.4.1` | npm 最新发布 **1.4.0** | `promptfoo`(devDep) → `jks-js` → `node-forge` | devDependency，不进生产依赖闭包、不进镜像；仅 eval 工具的证书解析 |
| `sprintf-js` | moderate | `>=1.1.4` | npm 最新发布 **1.1.3** | `electron`(devDep) → `@electron/get` → `global-agent` → `roarr` | devDependency，仅桌面**打包期**代理探测；不进入最终 app.asar 运行路径 |

另：`extract-zip` 的告警在 electron 41 中已由官方替代实现（`@electron-internal/extract-zip`）消解。

**处置纪律**：以上 3 条设置上游发版后立即重新钉版；`pnpm-workspace.yaml` 的 `overrides` 采用**按受影响范围定点钉版**（不做跨 major 全局替换——实测全局替换 `js-yaml` 会直接打坏 `@redocly/openapi-core`，使 `openapi:gen` 失败）。

- 依赖更新策略见 `.github/dependabot.yml`（每周检查；安全更新单独立组优先处理）。

## 我们不做的事（及原因）

- 不做登录态爬虫、不做邮箱授权守护进程——凡是编辑部/外部不会主动给你的数据，我们不假装自动获取。
- 不依赖任何国外在线学术源；网络出站仅指向你自己配置的 OpenAI 兼容端点。

## 报告漏洞

如果你发现安全问题（例如可被利用的注入、沙箱逃逸、密钥泄露路径），请**不要**先发公开 Issue，优先私密披露：

- 通过仓库镜像（GitCode / Gitee / GitHub）的 **Private Security Advisory / 私密 Issue** 通道提交；
- 或邮件至维护者（占位：`sciflow-security@example.com`，请以仓库主页最新联系方式为准）。

请附上：复现步骤、影响版本、环境（OS / Node / pnpm 版本）、PoC（如有）。我们会在 **72 小时内** 初步响应，确认后给出修复时间表并致谢。

> 提示：本工具无账号体系，**请勿把它直接暴露到公网**；任何公网部署都必须自行加网关鉴权与 TLS。
