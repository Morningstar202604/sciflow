# 更新日志 · Changelog

本项目格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义化版本号。以下按 `git log` 自底向上归纳历轮功能与修复，未含真实密钥。

## [0.3.0] - 2026-10

方向修正：还原被误删的完整功能集，做可交付可打包的完整智能体。

### Added
- **还原桌面端（`apps/desktop`，Electron）**：恢复被误删的 Electron 主进程 + preload + server-manager + auto-updater + electron-builder 配置 + 图标资源，`pnpm --filter @sciflow/desktop build` 可出 Windows NSIS 安装包。
- **还原 6 个后端模块 + 4 个前端页面**：Agent 轨迹追踪（`agent/`）、实验沙箱（`experiments/`）、审稿判断（`judgment/`）、MCP 工具（`mcp/`）、记忆中心（`memory/`）、Web 搜索（`websearch/`）、投稿流程（`research/submission`）及对应前端 ExperimentsPage / MemoryPage / SubmissionPage / McpToolList。
- **还原品牌体系与文档**：`docs/brand/` 全套 Logo 资源 + `docs/BRAND.md` + `docs/website.html` + `docs/sciflow-code-tree.html` + `scripts/full_regression.py` + `scripts/generate-icons.mjs`。
- **供应商 API Key 落库加密（`common/secret-crypto.ts`）**：AES-256-GCM，主密钥来自 `SCIFLOW_SECRET` 或 DB 同目录 `.sciflow.key`；历史明文启动时一次性就地加密；备份/复制 sciflow.db 不再等于泄露凭据。
- **对话跨会话摘要注入（`chat-session.service.ts`）**：会话结束 LLM 摘要落库，新会话自动注入最近 5 轮（SSE `onComplete` 回调驱动，不阻塞流）。
- **CLI 入口（`cli.ts`）**：headless 批处理，`health / project list / pipeline run|status / doc export / chat sessions` 子命令。
- **文档版本快照（对标 git commit）**：`POST /api/documents/:id/snapshot` 手动快照 + `PATCH .../commit-message` 提交说明 + 流水线起草前自动快照，自动流水线永不静默吃掉用户正文。

### Fixed
- **sqlite-vec 启动报错（真修）**：`require.resolve('sqlite-vec/better-sqlite3')` 因包 exports 只允许 `.` 子路径必然抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`；改用官方 `getLoadablePath()` 按平台解析预编译扩展（已验证 Windows `vec_version()=v0.1.9`）。
- **pnpm-workspace.yaml 占位符**：删除 `set this to true or false` 字面占位；`node-llama-cpp: false` 改为 `true`（此前禁止其 build scripts 导致原生二进制不编译）。
- **CI filter 名**：`pnpm --filter server|web` 改为 `--filter @sciflow/server|@sciflow/web`（与包名一致）。
- **版本号对齐**：server / web / desktop / 根 package.json 统一 `0.3.0`；CLI_VERSION 同步。
- **启动安全闸**：非回环绑定（`HOST=0.0.0.0`）必须 `AUTH_MODE=jwt`，否则拒绝启动（容器内零鉴权暴露面）。
- **评审 JSON 解析失败显式报错**：不再把格式漂移静默当成 0 分白烧一轮回炉。
- **断点续跑防覆盖**：重启续跑若文档在中断期间被人工编辑过，跳过自动覆盖式续跑并提示。
- **质量门最高分选优**：多轮回炉后若末轮非最高分，采用最高分轮次正文与评分落库。

## [0.2.2] - 2026-10

竞品对齐增强——Agent 轨迹追踪 + Web 搜索工具 + 对话摘要注入 + CLI 入口 + 版本快照增强。

### Added
- **Agent 执行轨迹追踪（`AgentTraceService`）**：统一 trace 模型记录每次 Agent 执行的完整输入/输出、步骤链、Token 用量与时耗；SSE 流输出模式回填，HTTP/JSON 模式直接记录；步骤级（Step）详细输入/输出可单条展开。
- **Agent 轨迹后端 API（`agent/` 模块）**：统一 trace 模型记录每次 Agent 执行的完整输入/输出、步骤链、Token 用量与时耗；SSE 流输出模式回填，HTTP/JSON 模式直接记录；步骤级（Step）详细输入/输出可单条展开。前端轨迹面板（对标 Cursor/Cline/OpenHands）尚未实现，待补。
- **Web 搜索工具（`WebSearchService`）**：DuckDuckGo Instant Answer API 无 key 即时搜索 + HTML 回退抓取描述 + SQLite 缓存（TTL 1 小时）。
- **对话跨会话摘要注入（`ChatSessionService`）**：会话结束时异步 LLM 总结并存库，新会话启动时注入最近 5 轮摘要，消除重启应用后的失忆问题。
- **CLI 入口模式（`cli.ts`）**：`NestFactory.createApplicationContext` 无 HTTP 启动，复用全部 DI 容器，health / project list / pipeline run / doc export / chat sessions 子命令。
- **文档版本快照增强**：手动快照（幂等）+ commit message 持久化。
- **SSE 流完成回调（`sse.helper.ts` onComplete）**：流解析层汇聚 fullText 与 totalTokens，在自然结束/abort/错误三个退出路径均触发回调。

### Changed
- `PipelineService` 调用 `AgentTraceService`（补齐执行链路的可观测节点）。
- `documents.service.parseVersions()` 返回类型扩展 `commitMessage?` 字段。

### Fixed
- 修复 `chat.controller.ts` 历史消息类型不匹配（`historyMsgs` 显式 `ChatMessage[]` 注解）。
- 修复 `documents.service.ts` 版本创建时 `content` 允许空串。
- 修复 `cli.ts` 子进程 stdout 类型歧义。
- 修复 `AgentTracePage.tsx` 未使用图标导入。
- **注**：AgentTracePage.tsx 实际未在代码库中，此条为历史 CHANGELOG 超前描述，保留仅供追溯。
- 修复 `database.ts` DDL 中误用 JS 风格 `//` 注释（应为 `--`，SQLite 不认），此 bug 导致服务启动报 `near "/": syntax error`。
- **[0.2.3 补齐]** AgentTrace keyset 分页 + Badge variant 重构 + CLI `pipeline status` 子命令 + 4 个 spec（38 测试全绿）+ tsconfig 排除 spec + 版本快照 UI 内联编辑 + 对话摘要注入 UI 透明化 + `/web` slash 命令集成。

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

## [0.2.1] - 2026-10

生产级治理——消除重复造轮子 + 跨平台兼容 + 类型安全加固。

### Fixed
- **实验沙箱 Windows 兼容**：`process.kill(-pid, 'SIGKILL')` 在 Windows 上语义不同 → `taskkill /pid /T /F` 替代；内存监控(`仅 Linux /proc`)；兜底 `child.kill('SIGKILL')`。
- **Dashboard 类型安全**：`countRows(table: any)` → `SQLiteTable` 泛型约束；硬编码 `60` → `LOW_SCORE_THRESHOLD` 常量。
- **知识库评分归一化**：魔术数字 `999` → `NO_SCORE` 常量；FTS5 全文检索 bug 修复（缺失 MATCH 参数 + SQL 路径错误）。
- **MCP 工具校验**：`z.object(shape).passthrough()` → `.strip()`（拒绝未声明字段，避免工具契约泄露）。
- **前端 JSON 兜底**：`jsonText('')` 返回 `null` → 返回 fallback（消除 P0 崩溃链，影响 Dashboard/Settings 等多处）。
- **SVG 渐变 ID 冲突**：多插图共用 `id="brandDoc"` 导致渐变引用错乱 → `useId()` + `BrandGradient` 共享子组件。
- **CSL 作者构造去重**：`formatRefEntry8` 重复的作者解析逻辑 → 统一使用共享 `toCslAuthors`。
- **质量维度去重**：`QualityPage` / `WritingPage` 各自一份 `DIMS` 常量 → 共享 `qualityDims.ts` 模块（同时消除标签不一致）。
- **类型检查加固**：`WritingPage` 无效的 `'error' in reviewResult` 类型检查（interface 无 error 字段）→ `reviewers?.length` 判断。
- **Auth 异步一致性**：移除误加的 `await` 在同步 Drizzle 查询上；`login` 保留 async（bcrypt.compare 需要）。

### Added
- **`apps/server/src/common/sse.helper.ts`**：SSE 流解析统一封装 `forwardOpenAiSse`，替代 `chat.controller.ts` 中手写 SSE 拼接逻辑。
- **`apps/server/src/common/citation-csl.ts`**：CSL-JSON 构造工具（`toCslAuthors` / `buildCslEntry` / `buildCslEntries`），references 与 documents 共用。
- **`@nestjs/throttler` 全局频率限制**：60 RPM，防 DoS / Token 成本爆炸。
- **`@types/node` 前端依赖**：修复 `Buffer` 全局类型缺失。

### Removed
- **`@ts-nocheck` / `@ts-ignore`**：从 `DocExporter.tsx` 和 `SettingsPage.tsx` 全部消除。
- **4 个 LangChain 孤儿依赖**：git log 确认已剥离但未从 `package.json` 清理的 `@langchain/core`、`@langchain/langgraph`、`@langchain/langgraph-checkpoint-sqlite`、`@langchain/openai`。
- **`msw` 未使用 devDependency**。

### Changed
- **`database.ts` (~100 行手写 schema reconciliation 系统 → 删除)**：启动时反射遍历 SQLite 表/列对比 drizzle schema 的逻辑已冗余（DDL + ensureColumn 双通道覆盖迁移），依赖 drizzle-kit push 管理 schema。
- **`database.ts` DATA_DIR 路径**：`__dirname` 解析（dist 打包后错误）→ `process.cwd()/apps/server/data`。
- **`embedding.service.ts`**：`this.model` / `this.ctx` 旧属性 → `this.llamaContext`（unknown + 精确类型断言）。
- **`ai-transport.service.ts`**：手写并发限制器 ~38 行 → `p-limit` 库替代。
- **`version-diff`**：手写 LCS DP ~55 行 → `diff` 库替代。
- **`as any` 数量**：14 → 10（全部在合理的第三方库边界）。

## [0.1.9] - 2026-10

### Changed

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
