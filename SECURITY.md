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

## 我们不做的事（及原因）

- 不做登录态爬虫、不做邮箱授权守护进程——凡是编辑部/外部不会主动给你的数据，我们不假装自动获取。
- 不依赖任何国外在线学术源；网络出站仅指向你自己配置的 OpenAI 兼容端点。

## 报告漏洞

如果你发现安全问题（例如可被利用的注入、沙箱逃逸、密钥泄露路径），请**不要**先发公开 Issue，优先私密披露：

- 通过仓库镜像（GitCode / Gitee / GitHub）的 **Private Security Advisory / 私密 Issue** 通道提交；
- 或邮件至维护者（占位：`sciflow-security@example.com`，请以仓库主页最新联系方式为准）。

请附上：复现步骤、影响版本、环境（OS / Node / pnpm 版本）、PoC（如有）。我们会在 **72 小时内** 初步响应，确认后给出修复时间表并致谢。

> 提示：本工具无账号体系，**请勿把它直接暴露到公网**；任何公网部署都必须自行加网关鉴权与 TLS。
