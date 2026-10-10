# 更新日志 · Changelog

本项目格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义化版本号。以下按 `git log` 自底向上归纳历轮功能与修复，未含真实密钥。

## [0.2.0] - 2026-10

企业级封装第一轮：桌面端 + 品牌体系 + 企业认证 + 运维工具链。

### Added
- **桌面端（`apps/desktop`，Electron）**：内嵌 NestJS 后端（`ELECTRON_RUN_AS_NODE` 免分发独立 Node）+ 本地 SQLite（userData 数据隔离）；自动探测空闲端口；`pnpm deploy` 产出自包含 server bundle；electron-builder 三平台打包（Windows NSIS / macOS DMG / Linux AppImage+deb）；electron-updater 自动更新（opt-in，`SCIFLOW_UPDATE_URL` 显式配置才启用，本地优先不偷偷联网）。
- **品牌体系（`docs/brand/` + `docs/BRAND.md`）**：官方 Logo——一笔流线 "S"（Science + Flow），品牌渐变 teal→cyan→sky；资产含 App 图标母版 / 独立标志（浅深底）/ 横版组合；favicon 与 apple-touch-icon 同源升级；`pnpm icons`（resvg）从矢量母版一键再生成全部位图；侧栏 Logo 替换品牌图形；品牌指南文档（色板 token / 字体 / 语调 / 各端落地要求）。
- **企业认证（`apps/server/src/auth`）**：JWT 模式（`AUTH_MODE=jwt`），注册/登录/me 三端点 + 全局 JwtAuthGuard（默认 `none` 旁路，本地/桌面零破坏）；首位注册用户自动 admin；bcryptjs 哈希；`user` 表落库；前端 `client.ts` 自动附带 Bearer Token + 401 统一事件 + 全局登录门 `AuthGate`（仅 jwt 模式可见）。
- **健康检查增强**：`/api/health` 返回 `db` 可用性 / `uptime` / `authMode` / `desktop` 标识（degraded 状态上报）。
- **运维工具**：`docker-compose.prod.yml`（healthcheck / 命名卷 / 每日 SQLite 在线备份 sidecar / 认证开关）；`scripts/backup-db.mjs`（better-sqlite3 官方 backup API，不锁库，保留策略可配）；`apps/web/nginx.conf` 增强（gzip / hash 资源 immutable 缓存 / SSE 关缓冲 / 64M 上传）。
- **CSL 官方样式补缺**：`scripts/gen-csl-templates.mjs` 从 citation-style-language/styles 生成内嵌样式模板；`csl-register.ts` 注册 IEEE / GB-T 7714 / Nature / Chicago / Springer / ACS 六种官方样式 + `@citation/csl-locale-zh-cn` 官方中文 locale。

### Fixed
- **引用样式运行时崩溃（上次重构遗留回归）**：citation-js 0.8.x 仅内置 apa/vancouver/harvard1，IEEE/GB-T 7714/Nature/Chicago/Springer/ACS 六种样式渲染即抛 "Cannot find style"；GB-T 7714 因缺 zh-CN locale 崩溃（citeproc et-al undefined）。现全部修复并可渲染。
- **顺序编码制双编号**：官方样式自带 [n]/n. 编号，旧代码再手动补 [n] 导致 `[3] [1] …`；改为整表渲染取官方连续编号，单条渲染剥离后重写全局序号。
- **单测与实现脱节**：`documents.service.spec.ts` 仍断言已删除的手写渲染器行为（5/5 失败）；更新为断言 CSL 标准行为并新增 8 样式全注册防回归测试（7/7 通过）。
- **Web 幽灵依赖**：`DocExporter.tsx` 引用未声明依赖（unified / remark-parse / @types/mdast），依赖重排后构建失败；显式声明修复。

## [0.1.9] - 2026-10

### Changed
- 全仓收口审计三线修复：安全基线、技术债清理、已知缺口补齐（以 HEAD `d1eeda0` 为准）。

## [0.1.8] - 2026-09

### Added
- 跨库检索增强、自包含导出、大纲模板管理、级联清理。

### Fixed
- 真实 API 全链路验证收尾：u2-flash 推理型网关适配、五处半成品补齐、移动端溢出修复。
- 著者-年 a/b 后缀按正文首现序生成；SSE `chunkText` 2000 字截断保护。

## [0.1.7] - 2026-09

### Added
- mock AI 网关支持流水线端到端跑通，AI 回归全绿。
- 文内 `[n]` 锚点渲染、8 种引用样式（APA/IEEE/Vancouver/GB-T 7714/Nature/Chicago/Springer/ACS）、版本 diff（LCS，2000 行上限）、选刊登记、审稿直连、学习复盘卡、后端 6 项能力（LLM 成本追踪 / zod 结构化校验 / Checkpoint 断点续跑 / MCP Guardrail / RAG 混合检索 / hash 路由）。

### Fixed
- SSE sources 补上下文、版本命名后端化、Settings 页窄屏适配。

## [0.1.6] - 2026-09

### Added
- 端到端断点全打通 + 移动端窄屏适配 + 产品路线图文档 + 大数据量实测。

## [0.1.5] - 2026-09

### Added
- 投稿状态跟踪（投稿→under review→修回→录用/拒稿→转投串联）、修回截止日倒计时。
- 力导向引用网络图（手写 SVG，可交互）。
- 实验沙箱（隔离 spawn Python，降级引导）。
- 知识库与文献双向打通、可搜索绑定 + 来源卡片。

## [0.1.4] - 2026-09

### Added
- 全页面可视化体系落地，补齐真科研环境高级功能与主流智能体交互范式（Supervisor 分组时间线、⌘K 命令面板、暗色模式）。
- 基于树状图的模块合并与横向扩展。

### Changed
- 砍除全部国外在线学术对接（OpenAlex / arXiv / Semantic Scholar / CrossRef），检索改走本地文献库，全面轻量化。

## [0.1.3] - 2026-09

### Added
- 移动端适配 + 全局快捷键；弹窗体验统一化。

### Changed
- SciFlow 品牌视觉系统升级（teal→cyan→sky 渐变 + 辉光 + 双层卡片阴影，亮/暗双套）。
- 全站错误文案友好化：HTTP 状态码 / 网络错误 / 超时统一转译中文提示（429→请求过于频繁、5xx→服务暂不可用、超时→AI 响应较慢）。

### Fixed
- CI：vitest 误扫 `dist/` 编译产物导致单测失败（限定仅跑 `src/**/*.spec.ts`）。
- 修复知识库建表缺陷；代码审计修复 8 项（引用错位、令牌桶负 delay 忙等、全文润色洗掉图表/参考文献、文献并行无闸触发 429、CommandPalette 键盘导航、无效路由兜底等）。

## [0.1.2] - 2026-09

### Fixed
- 流水线质量闭环大修：评审 Agent 切 fast 模型（思考模型 reasoning 前缀破坏 JSON 解析）；润色保留图表/参考文献尾部不被洗掉；分段润色根治长文截断；定稿自动取最高分轮次（修复「总是取最后/最差轮次」）；修复 `agent_run` 取最早行导致回炉形同虚设；回炉保图顺序；引用池主题相关性过滤 + DOI 标准化 + 按被引降序扩至 20 条；起草输出 JSON 围栏清洗。

### Added
- 综述自动配图（mermaid 技术路线/分类对比图）。

## [0.1.1] - 2026-09

### Fixed
- Agentic RAG 补检文献回填完整元数据（修复空元数据守卫过滤导致补充引用无出处）。

## [0.1.0] - 2026-09

### Added
- 首个可用版本：NestJS 11 + Drizzle/SQLite 后端、React 19 + Vite + Tailwind 前端；多智能体流水线（Planner/Research/Writer/Reviewer/Polisher + Reflexion 回炉）；本地文献库、知识库 RAG、SSE 流式科研问答、7 维质量评分、投稿辅助（选刊/Cover Letter/审稿回复）、记忆中心、MCP 工具台、内置零依赖 mock AI 网关。
