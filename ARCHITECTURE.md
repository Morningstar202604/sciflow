# SciFlow 架构文档（v0.4 重构目标态）

> 本文档是唯一真理源。任何影响架构、接口、数据模型、依赖的代码变更，必须同步回写本文档。
> 状态基线：commit 3c601d1（v0.3.0）。重构决策依据见 §6 ADR 索引。
>
> **本 §7「禁止重复造轮子守则」对所有后续开发会话生效**：动手前先查 §2.6 地图——能用成熟件的必须用，不允许在任务中途自造已有成熟替代的基建。

## 0. 现状基线（S0 考古结论）

- 意图：本地优先、单机部署的科研 AI 全生命周期工作台（文献→规划→大纲→分章起草→质量门→润色→引用→投稿）。
- 现状：顺序流水线已可用且部分工艺良好（密钥加密、Python 沙箱、CSL 引用、断点续跑防覆盖）；但 README/docs 描述的架构（orchestrator/、并行 Research、多 Agent 追踪）未被实现，存在三处幻觉文档、两张从未写入的表、一处自造"伪 MCP"协议。
- 手搓基建待替换：`ai-transport.service.ts`(362 行 OpenAI 协议手写)、`json-utils.ts`(80 行)、`pipeline-steps.ts`(189 行伪 DAG)、`pipeline.service.ts` 内手写断点续跑/互斥锁/异常哨兵、`mcp.service.ts`(314 行自造 REST 协议)、`cli.ts` 手写参数解析、`knowledge.service.ts:33` 手写分段、`documents.service.ts:128` pdf-parse。
- 检索层**不是**手搓：FTS5 BM25（`db/database.ts:378`）+ sqlite-vec ANN（:487）+ 本地嵌入 node-llama-cpp（`embedding.service.ts`，bge-small-zh-v1.5）已是原生 SQLite 方案，保留。
- 认证层不是手搓：@nestjs/jwt + bcryptjs 已在用，保留。
- 桌面端基线（2026-10-14 实测修正）：Electron 33→**38**（内嵌 Node 22，原生支持 `require(ESM)`；33 的内嵌 Node 20 无法 require 现代 ESM-only 依赖，打包运行时实测三连炸：swagger@12 ESM → 降 v11、better-sqlite3 ABI → prepare 脚本自动按 Electron ABI 重编、p-retry@6/ai@7 ESM-only → 随 38 升级解决）。桌面打包验证：Setup.exe 产出 + `ELECTRON_RUN_AS_NODE` 实跑 health/流水线 completed/agent trace 全通过。
- 导出层不是手搓：`docx`@9.7.2 已是依赖且用于 exportDocx（`documents.service.ts:407`），保留。
- 测试现状：server 2 个 spec / 12.6k 行；web 零测试、无 vitest；**全仓无 eslint/prettier**；回归靠 `scripts/full_regression.py`（不在 CI）。

## 1. 目标架构总览

```
┌─ 前端 apps/web ─────────────────────────────────────────────────┐
│ React 19 + react-router(声明式) + TanStack Query(数据)          │
│ TanStack Table(文献表) · recharts(图) · streamdown(流式MD)      │
│ CodeMirror 6(写作编辑器) · graphology+sigma(文献网络,可选)      │
└──────────────┬───────────────────────────────────────────────────┘
               │ REST + SSE（client.ts 按域拆分；Swagger→openapi-typescript 类型同步）
┌─ 服务端 apps/server ────────────────────────────────────────────┐
│ 编排层  LangGraph.js 1.5（真DAG · interrupt 人工确认 ·          │
│         Send API 并行 · SQLite checkpointer 断点续跑）          │
│ 模型层  Vercel AI SDK 7 + @ai-sdk/openai-compatible             │
│         generateObject+zod 结构化输出 · fast/strong 路由        │
│         （Ollama/LM Studio 经同一 openai-compatible 端点免费获得）│
│ 协议层  @modelcontextprotocol/sdk（MCP server+client）          │
│ 领域层  原封不动：FTS5+vec0 混合检索 · secret-crypto ·          │
│         Python沙箱 · citation-js/CSL · docx · memory · submission│
└──────────────────────────────────────────────────────────────────┘
```

分层原则：**编排、模型、协议三层全部换成业界成熟件；领域层一行不换。** 四个"工程"落位：

| 工程 | 落位 |
|---|---|
| 模型工程 | AI SDK provider 抽象（OpenAI 兼容全厂商 + Ollama 本地模型）、fast/strong 档路由（保留）、node-llama-cpp 本地嵌入（保留） |
| 上下文工程 | LangGraph state + checkpointer（流水线状态）、chat_session 摘要注入（已有）、Contextual Retrieval 前缀（已有） |
| 提示工程 | `prompts.ts` 领域 prompt 保留（自有资产）、customPrompts 可定制（已有）、promptfoo 离线评估（dev） |
| 约束工程 | zod 端到端（generateObject schema、MCP tool inputSchema、API DTO）、质量门阈值、LangGraph interrupt 人工确认 |

## 2. 依赖地图（全部 npm 实查版本，2026-10）

### 2.1 运行时新增（server）

| 包 | 版本 | 许可证 | 替换/启用 | 删除的手搓代码 |
|---|---|---|---|---|
| `ai` | 7.0.138 | Apache-2.0 | 模型层：传输/流式/重试/结构化输出 | `ai-transport.service.ts` 协议部分（保留 fast/strong 路由、token 落库、密钥解密约 50 行薄封装） |
| `@ai-sdk/openai-compatible` | 3.0.68 | Apache-2.0 | OpenAI 兼容厂商接入（含 Ollama/LM Studio 本地端点，无需额外包） | 同上 |
| `@langchain/langgraph` | 1.5.0 | MIT | 编排层：真 DAG、`interrupt()` 人工确认、Send API 并行起草、checkpointer 断点续跑 | `pipeline-steps.ts` 全部 189 行（伪 DAG + AWAITING_CONFIRMATION 异常哨兵）、`pipeline.service.ts` 的 `running` Set 互斥与 `resumeInterrupted()` 手写续跑 |
| `@langchain/langgraph-checkpoint-sqlite` | 1.1.0 | MIT | SQLite 持久化（底层 better-sqlite3 ^12.10） | 手写 checkpoint 恢复逻辑 |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | 真 MCP server（对外暴露工具）+ 真 MCP client（接外部工具） | `mcp.service.ts:286-298` 自造 `/tools`+`/call` REST 协议 |
| `jsonrepair` | 3.15.0 | MIT | 修复 AI 返回的近合法 JSON（渐进迁移期兜底） | `ai/json-utils.ts` 80 行 + `stripFencesAndExtract` |
| `@langchain/textsplitters` | 1.0.2 ✅已落地 | MIT | 知识库分块 RecursiveCharacterTextSplitter（800 字/块，中文句读分隔符） | `knowledge.service.ts` 手写段落聚合 chunkText（已删） |
| `unpdf` | 1.8.1 ✅已落地 | MIT | 知识库 PDF 解析（实测：手造 PDF→base64→提取全文→分块 201） | `pdf-parse`@2.4.5（已移除依赖） |
| `helmet` | 8.3.0 | MIT | HTTP 安全头（main.ts 现仅有 CORS） | — |
| `nestjs-pino` + `pino` | 5.3.1 / 10.4.0 | MIT | 结构化日志（现全部是 NestJS console Logger） | 各处散落 `console.error` |
| `commander` | 15.0.0 | MIT | CLI 参数解析 | `cli.ts` 手写 argv 解析 |
| `autoevals` | 0.4.0 | MIT | 质量门补充评估器（Factuality 等，可选维度） | — |

体积代价：约 32MB node_modules 增量（server 为 Node 进程，不影响浏览器 bundle；Electron asar 可接受）。

**兼容点（必须处理）**：`@langchain/langgraph-checkpoint-sqlite` 依赖 `better-sqlite3 ^12.10.0`，项目现锁 `~11.9.0`（apps/server/package.json:25）。需升 major 并重新构建 Electron 原生模块。

### 2.2 运行时新增（web）

| 包 | 版本 | 用途 |
|---|---|---|
| `@tanstack/react-query` | 5.104.2 | 替换各页手写 useState/useEffect/loading/error 数据获取（App.tsx ~15 个 useState 起步） |
| `@tanstack/react-table` | **8.21.3（钉版）** | 抽取矩阵表（动态列 = 文献 + 字段、表头点击排序）；v9 为新 major（API 重写）暂不升 |
| `streamdown` | 2.7.0 | ChatPanel 流式 Markdown 渲染（处理不完整块），替代裸 react-markdown 拼流 |
| `@uiw/react-codemirror` + `@codemirror/lang-markdown` | 4.25.12 / 6.5.2 | 论文写作编辑器：替换 `WritingEditor.tsx` 的裸 Textarea（89 行），获得语法高亮/标题折叠/快捷键 |

已装未用/错用（零新增依赖，纯改用法）：
- `react-router-dom`@7.18.4 **已在依赖里**，但 `App.tsx:123` 仍用硬编码数组手解析 pathname → 改为声明式路由表。
- `recharts`@2.15 已存在且 `components/charts.tsx`(238 行) 是它的薄封装 → 保留，**不引入 echarts**（60MB 对本应用无增益）。

### 2.3 devDependencies（质量工程）

| 包 | 版本 | 用途 |
|---|---|---|
| `eslint` + `typescript-eslint` + `prettier` | 10.12.0 / 8.71.2 / 3.9.10 | **全仓零 lint/format，P0 补齐**，入 CI |
| `vitest` + `@testing-library/react` + `happy-dom` | 已有(vitest server) / 16.3.3 / 21.0.1 | web 单测从零到有（happy-dom 比 jsdom 轻 9MB） |
| `msw` | 3.0.3 | web 单测 API mock |
| `@playwright/test` | 1.64.0 | E2E 冒烟（Electron/本地双模式各一条主路径） |
| `promptfoo` | 0.124.1 | prompt 回归评估（仅 dev，禁入运行时） |
| `@nestjs/swagger` + `openapi-typescript` | 12.0.2 / 7.13.0 | 契约先行：装饰器 → `openapi.json`（111 paths）→ `apps/web/src/api/openapi.d.ts`（`pnpm openapi:gen` 重建）；openapi-fetch 未采用（取类型即可，client.ts 对外行为不变） |

CI 同步：`ci.yml` 增加 lint 步骤、web 测试步骤、`full_regression.py` 接入、promptfoo 评估可选 job。

### 2.4 已采用且必须继续用的现有依赖（防后续会话误删/重复造）

| 已有依赖 | 用在哪 | 谁也不许替代它的原因 |
|---|---|---|
| `@citation-js/*` + plugin-ris + csl-register | `documents.service.ts:5-6`、`references.service.ts` 引用渲染/BibTeX·RIS 导入导出 | CSL 生态标准实现；RIS 输出由官方 plugin-ris（0.8.1，core 0.8 系）提供 |
| `docx`@9.7.2 | `exportDocx`（`documents.service.ts:407`） | 已解决 Word 导出，勿再评估 mammoth/html-docx |
| `better-sqlite3` + FTS5 + `sqlite-vec` | `db/database.ts:378,487` 混合检索 | 原生 SQLite 能力即最强方案，禁止用 JS 重写 BM25 |
| `node-llama-cpp`（bge-small-zh-v1.5） | `embedding.service.ts` 本地嵌入 | local-first 语义嵌入已就位，不引 @huggingface/transformers（46MB 重复职能） |
| `@nestjs/jwt` + `bcryptjs` + `@nestjs/throttler` | auth/限流 | 成熟件已在用 |
| `p-retry` / `p-limit` | transport 重试/并发 | 保留 |
| `zod`@4.6 | DTO 校验 | 升级为端到端契约（AI schema/MCP schema 共用） |
| `recharts`、`react-router-dom`、`diff`、`katex`、`remark-*` | 前端 | 已在依赖里，改用法不换包 |

### 2.5 明确拒绝清单（评估过，不引入）

| 候选 | 实查版本 | 拒绝理由 |
|---|---|---|
| Mastra | @mastra/core 1.76.0 | 75MB 全家桶，单用户本地应用过度设计；编排选 LangGraph |
| @openai/agents (JS) | 0.20.0 | 与 LangGraph 职能重叠，编排器只保留一个 |
| LlamaIndex.TS | llamaindex 0.12.1 | 检索层 FTS5+vec0 已是原生方案，RAG 编排职能与 LangGraph 重叠 |
| mem0ai | 3.3.1 | 现有 memory 模块 88 行已覆盖单用户场景；mem0 需额外 LLM 抽取调用 |
| A2A (a2a-js) | 0.2.0 | Agent 跨组织互操作协议，单机单用户无此需求。**Watch**：等 1.0+ 且出现科研多智能体互操作场景再评 |
| AG-UI (@ag-ui/core) | 1.0.2 | 前后端自有契约已够用。**Watch** |
| echarts | 6.1.0 | recharts 已覆盖且已封装 |
| @huggingface/transformers | 4.3.1 | 与 node-llama-cpp 职能重复，46MB |
| pyodide | 314.0.7 | 13.9MB；Python 沙箱已用本机 python3 + 威胁模型成型。**Watch**：若要做"零 Python 依赖分发"再评 |
| Storybook | 10.6.2 | 22MB，单人项目组件规模不需要 |
| i18next / react-i18next | 26.4.4 / 17.0.16 | 单语言产品 |
| langfuse | 3.39.2 | 需自建服务端；llmCallLogs 够用。**Watch**：观测需求超出现有仪表板再评 |
| duck-duck-scrape | 2.2.7 | 2025-01 起停更，比自研 94 行版本更旧，不换 |

### 2.6 观察名单（不排期，条件触发再评）

- ✅ **已采用（P4 落地）**：`graphology`@0.26.0 + `graphology-layout-forceatlas2`@0.10.1 + `sigma`@4.0.0 重写 `ForceGraph.tsx`（手写 FR 物理引擎 `literature-graph.ts` 已删）。
- `@opentelemetry/api`@1.9.1：LangGraph/AI SDK 均可吐 OTel，观测需求升级时接 pino/OTel 管线。

## 3. 数据模型变更

1. **删除 `agent_run` 表**（schema.ts:163）：从未被写入（全仓 0 处 insert），PipelinePage 读取它的 UI（:684-722）为死代码，一并删除。
2. **保留 `agent_execution`/`agent_step`**（schema.ts:409,434）：作为 chat/tool 来源的 Agent 轨迹（AgentTraceService 已写完整，需接线：注入 chat.service、experiments 等）。
3. **流水线可观测性**：LangGraph checkpointer 自管 checkpoint 表；pipeline 轨迹 = checkpointer 状态 + llmCallLogs。`pipeline_task.steps` JSON 列改为由 graph state 投影生成（保持前端契约不变，PipelinePage 无需重写）。
4. 其余表不动（documents/references/citations/knowledge/submissions 等全部保留）。

## 4. 模块结构变更（server）

```
apps/server/src/
├── graph/                  # 新：LangGraph 编排（原 orchestrator 职责，兑现 README）
│   ├── research.graph.ts   #   Research 阶段：Send API 并行 ReAct 子图
│   ├── writing.graph.ts    #   主流水线：verify→research→interrupt(大纲确认)→draft(并行)→quality-gate→polish→citation
│   └── nodes/*.ts          #   7 个步骤 = 7 个 node 函数（从 pipeline.service.ts 内联闭包抽出）
├── ai/
│   ├── ai-transport.service.ts   # 瘦身为 ~50 行：AI SDK 封装 + fast/strong 路由 + token 落库 + 密钥解密
│   ├── ai.service.ts             # 领域方法改用 generateObject+zod；删除 json-utils.ts
│   └── prompts.ts                # 保留（领域资产）
├── mcp/                    # 换 @modelcontextprotocol/sdk：真 stdio/HTTP server + 外部工具 client
└── （其余模块不动）
```

> 落地说明：未建独立 `graph/` 目录——编排落在 `pipeline/pipeline.graph.ts` + `pipeline/pipeline-state.ts`（与 pipeline 模块内聚，避免跨目录循环依赖）；research 子图与 Send API 并行未单拆（主图内 `runDrafting` 经 p-limit 并行，ReAct 循环在 literature 节点内）。§4 其余规划已按原样落地。

前端：`App.tsx` 拆壳（声明式路由 + React Query Provider）；`client.ts` 按域拆 `api/*.ts`（P4 起由 openapi-typescript 生成类型）；各页数据获取迁 React Query；`WritingEditor` 换 CodeMirror。

## 5. 分阶段实施（每阶段完成即回写本文档）

| Phase | 内容 | 验收门 |
|---|---|---|
| **P0 诚实化+地基** ✅ 2026-10-13 | 修 README/docs 三处幻觉（orchestrator 描述、并行声明、回归基线数字 162→142）；删 agent_run 全链死代码（DDL/schema/service/controller/client/types/PipelinePage 80 行 UI + 3s 无效轮询）；eslint(flat config)+prettier 全仓 0 errors；web 测试从零到一（vitest+happy-dom+@testing-library，ui.tsx 8 测试）；better-sqlite3 11.9→12.11.1（14 测试 GREEN + 启动冒烟）；CI 增 lint/web-test 步骤 | typecheck+lint+build 双端全绿；server 14 + web 8 测试通过；文档与代码零口径冲突 ✅ |
| **P1 模型层** ✅ 2026-10-13 | Vercel AI SDK（ai@7 + openai-compatible@3，supportsStructuredOutputs）替换全部手写 HTTP/SSE 协议；complete 保持 p-retry/p-limit/token 落库；新增 completeStructured（generateObject+zod）；jsonrepair 替换 json-utils/stripFences（文件已删）；**恢复 mock-gateway**（HEAD 上已被删导致 AI_MOCK 失效、文档基线不可复现）；流式改经 streamText→SSE 转接 | e2e：health/项目/流水线 interrupt→confirm→completed 全通；回归 mock 分支自 P1 起重新可跑 ✅ |
| **P2 编排层** ✅ 2026-10-13 | LangGraph 重写主流水线（pipeline.graph.ts：interrupt 人工确认 + SqliteSaver checkpointer + Reflexion 回炉节点）；删除 pipeline-steps.ts（executeDAG/异常哨兵清零）；起草并行化（p-limit，AI_DRAFT_CONCURRENCY 可配）；AgentTraceService 接线（pipeline/pipeline-resume 两类 run + 每步 addStep 实测落库）；服务层重建为图门面（controller/cli/steps JSON 契约不变） | 断点续跑/人工确认/并行三行为全部实测：mock e2e interrupt→confirm→completed ✓；checkpoint 表 11 行落库 ✓；回归 PASS 143 / FAIL 0（全新库，scripts/full_regression.py v6，KNOWN 11 存量缺口单列）✅ |
| **P3 协议层+加固** ✅ 2026-10-13 | `@modelcontextprotocol/sdk` 真 MCP Server：`POST /api/mcp/rpc`（Streamable HTTP）+ `cli.js mcp serve`（stdio）；工具注册表单一来源（REST 端点与 MCP 协议共用）；helmet 安全头（4 项实测响应头）；nestjs-pino 结构化日志（JSON 实测）；cli.ts 全量重写为 commander；外部 MCP client 仍为 REST 兼容模式（SDK 化列入 §8 待办） | 官方 SDK Client 双传输实测：HTTP 11 工具握手+callTool ✓；stdio 11 工具握手+callTool ✓；helmet 头/X-Content-Type-Options 等 ✓；pino JSON ✓；CLI --help/命令✓ |
| **P4 前端** ✅ 主体完成 2026-10-13（含对话优先重构） | 视图注册表 + CodeMirror 6 + streamdown（一轮）；**二轮重构**：① `client.ts` 551 行拆为 `api/core|writing|research|platform`（barrel 兼容，对外形状不变）② `@tanstack/react-query` 全局接入（main.tsx Provider），WorkspacePage 的文档列表/正文/流水线轮询全部走 Query（refetchInterval 驱动 run card 进度）③ **WorkspacePage 对话优先工作台**：左对话线程（流式/推理折叠/来源卡/停止）+ 右文档预览 + 内联流水线卡（interrupt 大纲确认在对话内完成）④ 导航 IA 重排：工作台默认，核心/自动化/辅助三级，其余经 ⌘K。**本轮（技术债清零，2026-10-14）**：react-query 全站迁移（Dashboard/Experiments/Memory/Literature/Knowledge/Submission/Pipeline/Writing/App 壳，数据获取与轮询全部 Query 化）；sigma.js+graphology 重写 ForceGraph（手写 FR 物理引擎 literature-graph.ts 已删）；lint 豁免**全部删除**（set-state-in-effect/refs/immutability/exhaustive-deps 等归零 39→0）。✅ 该批遗留项已在第六轮全部完成（TanStack Table v8 抽取矩阵 / openapi 类型链 / msw / Workspace 二期 / mock-gateway MSW 化 / autoevals / Electron 构建验证——见 §8 终局） | typecheck 0 / build ✓ / **测试 12/12（WorkspacePage 4 条新增）** / lint 0 errors；Playwright 真机冒烟 ✓ |
| **P5 质量工程** ✅ 主体完成 2026-10-13 | ① 回归入 CI + final_acceptance 矩阵（21 项）② **promptfoo**：`evals/promptfooconfig.yaml` 离线评估集（指向 mock 网关，实测 **2 passed / 0 failed**）+ `pnpm eval:prompts` ③ **Playwright**：`e2e/workspace-smoke.spec.ts` 真机冒烟（headless chromium 实测 **1 passed**，验证默认视图与导航 IA）+ CI `e2e-and-evals` job。✅ autoevals、sigma.js 均已在后续轮次落地（见 §8 终局） | final_acceptance **21/21**；回归 **161/0/0**；promptfoo 2/2；Playwright 1/1 |

顺序依赖：P0→P1→P2 必须串行（同一模块）；P4 可与 P2/P3 并行。

### 5.1 P0 完成快照（2026-10-13，commit 基线 3c601d1 之上）

- 删除量：agent_run 表 DDL（database.ts）+ schema 定义 + `agentRuns(id)` 查询 + `GET /api/pipeline/:id/agents` 路由 + client `api.pipeline.agents` + `AgentRun` 类型 + PipelinePage 80 行死 UI + 每 3 秒无效轮询。
- 修正量：README 4 处（首段 Supervisor 描述、特性区多智能体节、目录树 orchestrator 行、AgentRun→AgentExecution、基线 162→142）；docs/development.md 1 处；docs/api-overview.md 2 处（含删除 agents 端点行）。
- 新增工具链：根 eslint.config.js（flat config，typescript-eslint recommended + react-hooks）+ .prettierrc.json + `pnpm lint`/`pnpm format` 脚本；apps/web vitest.config.ts + test-setup.ts + 首个测试 `src/components/ui.test.tsx`（8 条）。
- lint 豁免（P2/P4 清零）：no-this-alias、no-require-imports、set-state-in-effect、refs、immutability（存量放行）；exhaustive-deps 降为 warn（5 处存量）。
- 已知遗留：① Electron desktop:dist 未在本机验证 v12 重编（allowBuilds 已配置，编译产物 build/Release/better_sqlite3.node 正常产出）；② 5 条 exhaustive-deps warnings 待 P4 处理。

## 6. ADR 索引

- ADR-001 编排层选型：LangGraph vs Mastra vs @openai/agents vs 保留手搓 → LangGraph（docs/adr/001-orchestrator-langgraph.md）
- ADR-002 模型层选型：Vercel AI SDK vs 继续手写传输层 → AI SDK（docs/adr/002-model-layer-ai-sdk.md）
- ADR-003 协议层选型：@modelcontextprotocol/sdk vs 自造协议 → MCP SDK（docs/adr/003-mcp-official-sdk.md）
- ADR-004 反过度设计拒绝清单：Mastra/LlamaIndex/mem0/A2A/AG-UI/echarts/transformers.js/pyodide/Storybook/i18next/langfuse/duck-duck-scrape（docs/adr/004-rejected-alternatives.md）

## 7. 禁止重复造轮子守则（对所有后续开发会话生效）

动手写任何"基建感"代码前，先对照本守则与 §2 地图。命中即用现成件；地图里没有的先查 npm（活跃度/体积/许可证三查），再回写本地图。

| 你正要手搓… | 必须改用 | 理由 |
|---|---|---|
| 调 LLM / 解析 SSE 流 / 重试 | AI SDK（§2.1 ai + openai-compatible） | 传输层已整体换装 |
| 从 AI 文本里抠 JSON | `generateObject` + zod；兜底 `jsonrepair` | 手写 stripFences 类代码已删除，禁止复活 |
| 流水线步骤/状态机/断点续跑/人工确认 | LangGraph（node + interrupt + checkpointer） | §1 编排层唯一入口 |
| 工具协议（对内或对外） | @modelcontextprotocol/sdk | 自造 REST 工具协议已删除 |
| 任何图表 | `components/charts.tsx`（recharts 封装），缺图型先扩它 | 禁止页面内手写 SVG 图表 |
| 任何表格排序/筛选/分页 | @tanstack/react-table | 禁止页面内手写表逻辑 |
| 服务端分页数据获取/loading/error 态 | @tanstack/react-query | 禁止手写 useState+useEffect+fetch 三件套 |
| 文本分块 | @langchain/textsplitters | 手写 chunkText 已删除 |
| PDF 解析 | unpdf | — |
| 全文/向量检索 | SQLite FTS5 + sqlite-vec（已有） | 禁止 JS 重写 BM25/余弦 |
| 参数解析（CLI） | commander | 手写 argv 已删除 |
| 重试/并发控制 | p-retry / p-limit（已有） | — |
| 密码哈希/JWT/限流 | bcryptjs / @nestjs/jwt / @nestjs/throttler（已有） | — |
| Word 导出 | docx（已有） | — |
| 引用格式化 | @citation-js + csl-register（已有） | — |
| HTTP 安全头 | helmet | — |
| 结构化日志 | nestjs-pino | 禁止新增裸 console.* |
| 前端类型契约 | @nestjs/swagger → openapi-typescript | 禁止 client.ts 手写重复类型 |
| 流式 Markdown 渲染 | streamdown | — |
| 富文本/Markdown 编辑器 | @uiw/react-codemirror | 禁止裸 Textarea 充当编辑器 |
| 单测 API mock | msw | — |

| 桌面打包原生模块 / 依赖 ESM 形态 | 原生模块交给 `apps/desktop/scripts/prepare-server.mjs` 自动按 Electron ABI 重编（幂等 ABI 戳）；Electron 基线 **≥41.10.7**（内嵌 Node 24；安全公告 5 条 high 的修复线）；CI/本机下载 electron 用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；`@electron/get` 必须留 3.1.x（electron-builder 26.x 需要 v3.1 才导出的 `ElectronDownloadCacheMode`，见 §2 overrides） | Electron 33 冒烟实测三连炸（ESM/ABI）教训；新增 ESM-only 依赖前对照本行 |
| 桌面 `extraResources` 拷贝目录 | 后端 bundle 必须放在**二级目录**（`resources/bundle/server`），禁止让 `node_modules` 处于 `from` 目录的根级 | electron-builder 过滤器硬编码 `if (relative === "node_modules") return false`（app-builder-lib/out/util/filter.js），根级 node_modules 会被**静默丢弃** → 安装包从 1.42GB 掉到 100MB、应用启动即崩（0.4.1 实测踩中并修复） |

**判断规则**：新代码若含 `JSON.parse` 于模型输出、`new RegExp` 解析协议、手写 `for` 循环分页/排序、手拼 SSE `data:` 行——先停下查本表。

### 7.1 交接自检（每次会话开始处理本仓库任务时执行）

1. 任务涉及依赖/基建 → 重读 §2 依赖地图与 §2.4「已有依赖防误删表」。
2. 任务涉及流水线/编排 → 只允许经 `graph/`（LangGraph），禁止在 service 里内联闭包编排。
3. 想新建 util 文件 → 先查 §7 表格是否已有对应成熟件。
4. 新装任何包 → 三查（npm 活跃度 / 体积 / 许可证）并回写 §2；同时检查是否与 §2.5 拒绝清单冲突。
5. 完成任何影响架构的改动 → 回写本文档（§0 基线、§2 地图、§4 结构图、§5 进度）。

## 8. 待办快照

### P0 前置项（2026-10-13 全部核销 ✅）

- [x] README.md 删除 `orchestrator/` 目录树行；「并行 ReAct」标注为 P2 交付项；回归基线 162 → 142（以 scripts/full_regression.py docstring 为准）
- [x] docs/development.md、docs/api-overview.md 删除 orchestrator 描述（后者连同 `/agents` 端点行一并删除）
- [x] 删除 agent_run 全链：DDL（database.ts）+ schema 定义 + service 查询 + controller 路由 + client 方法 + types + PipelinePage 死 UI（80 行）+ 无效轮询
- [x] apps/server/package.json better-sqlite3 ~11.9.0 → ~12.11.1（本机编译+14 测试+启动冒烟通过；Electron desktop:dist 重编待首次打包时验证）
- [x] web 测试从零到一：vitest + happy-dom + @testing-library/react + jest-dom + user-event；`src/components/ui.test.tsx` 8 条全绿（msw 按 §5 P4 接入）
- [x] eslint(flat config) + prettier 全仓配置，0 errors；CI 增 lint 与 web 测试步骤

### 存量后端缺口 ✅ 已全部修复（2026-10-13，R1-R8）

历史 11 项（回归脚本 KNOWN 清单）修复记录，逐项：
- ✅ 流水线落 qualityReports：`pipeline.graph.ts` quality-gate 节点每轮评分一行落库（修复点同左）
- ✅ 对象数组作者归一化：`references.service.ts` createSchema 收三形态作者，统一 `parseAuthors`（common/authors 单一来源）
- ✅ BibTeX 保护括号解包（负向后行断言保 LaTeX 命令）；RIS 经官方 `@citation-js/plugin-ris@0.8.1`（原 500：format 'ris' 插件缺失）
- ✅ 中文全文检索：`knowledge_chunk_fts` 迁移 unicode61 → **trigram**（database.ts 自动迁移+重建索引；查询侧 `buildTrigramQuery` 3-gram OR 展开），并修复 P0 期遗留的引用渲染丢失（renderCitations 回填）
- ✅ apa 姓氏排序：CSL 引擎本身按姓排序；旧断言（`B Chen` 手写前缀）系 commit 2f6c885 去轮子化换 CSL 后未同步的**过期期望**，已更正为 CSL 契约（"Chen, B."）
- ✅ 25.1 研究命中：新增 Planner（`PLAN_RESEARCH` 多语关键词）→ `crossEnrich` 逐关键词检索文献库并集去重 → libScore 命中标记「（文献库 · 匹配 N）」
- ✅ 筛选 upsert 回包带 `title`（join 口径与 screenList 一致）
- ✅ 顺带修复：quality-gate 节点读活行（researchMeta 在 literature 节点之后写入，图状态快照会读空）

### 真实模型端到端验收（2026-10-14，OpenCode 的 Agnes 端点）

用真实 OpenAI 兼容端点（agnes-3.0-flash / 2.5-flash）跑通三层验收，并抓到 3 个 mock 无法暴露的真实缺陷：

1. **P1 修复：system 消息语义**——AI SDK v7 禁止 system 混入 `messages`（真实厂家直接 400，mock 不校验）。修复：`splitSystemMessages` 统一拆分 → `instructions`，三个调用点（generateText/generateObject/streamText）全覆盖。
2. **P1 修复：限流识别**——上游配额报错为「免费用户 API 速率限制」文案 + `statusCode` 字段，原判定只认 `(429)`→ 未重试即失败。修复：`isRetriableLimit`（statusCode/status/中英文文案）+ 退避放宽（4 次 / 2s→60s）。
3. **P2 修复：默认视图未生效**——`rawView` 的 `|| 'dashboard'` 短路了三元的 workspace 兜底，导致根路径仍落旧 dashboard（mock 冒烟当时用 `or` 断言掩盖了）。修复 + E2E 断言收紧（`data-testid="chat-thread"`）。

体验打磨（真实跑中发现）：评审 prompt 加**评分锚点 + 维度独立**（原 citation 存疑会把 novelty/figures 连坐压到 0）+「疑似不实引用逐条标注，不臆断学术不端」；起草**逐节进度通知**（quality-gate 步骤实时显示"起草进度 n/N 节"，含回炉轮次）；workspace run card **已用时计时**；大纲 prompt **类型感知**（综述/比较研究不得套「实验与结果」章节，评审实测会据此判逻辑断裂）。

真实验收结果：连通自检 ✓ | 非流式问答 7.3s ✓ | **SSE 流式首包 0.91s / 85 字秒 / usage 收尾 ✓** | **完整流水线 509s→completed（6 节 12.5k 字，引用/质量报告/trace 全落库）** ✓ | 逐节进度 6/6 实时可见 ✓ | 桌面打包版（Electron 38）真实模型 health+chat ✓ | CLI（health/project/status）✓ | Web Playwright 真实对话 ✓（`e2e/real-chat.spec.ts`，`E2E_REAL=1` 启用，默认 CI 跳过）。token 总账：首跑 46 calls / 90.5k tokens（含 3 轮回炉）——三轮回炉因"评审严格 + 首轮大纲含实验章节"所致，已用类型感知+维度独立收敛。

### 计划内任务全部核销（2026-10-14 终局）

**技术债清零（第五轮）**：eslint 39→0（豁免块删除、六规则 error 强制）。**收尾轮（第六轮）全部完成**：
- ✅ msw 测试接入（web 测试 15/15，含 3 条网络层拦截：成功解析/中文业务错误透传/msw×fetch 协同）
- ✅ autoevals 接入（server 测试 16/16；NumericDiff 守护质量门文案、Levenshtein 守护 mock 契约；LLM-judge 归 promptfoo）
- ✅ swagger→openapi-typescript（openapi.json 111 paths；`pnpm openapi:gen`；apps/web/src/api/openapi-typescript 入口）
- ✅ mock-gateway MSW 化（a20d12e MSW 版回归：**AI_MOCK 不再占用 5099 端口**；回归 161/0/0）
- ✅ Workspace 二期（线程 localStorage 持久化；chat_session 历史侧栏注入背景；独立问答页并入——导航移除，深链保留）
- ✅ TanStack Table v8（**钉 ^8.21.3**：v9 为新 major API 未稳）重写抽取矩阵（动态列=文献+字段、表头点击排序）
- ✅ 路线图 #17 大纲模板（综述/IMRaD/基金三模板，本地 JSON 注入，零 AI 零依赖）
- ✅ Electron desktop:dist 构建验证（见构建日志；better-sqlite3 v12 原生模块在 Electron 重编）

### 0.4.1 依赖安全与发布质量批次（2026-10-15 续作）

- ✅ **依赖安全：全量告警 103 → 3**（生产依赖仅 1 low=katex）。处置：electron 38.8.6→**41.10.7**（关 5 条 high）、simple-git→4.0.2 / argv-parser→2.0.1、tar→7.5.22、shell-quote→1.12.0、vite→6.4.3、vitest/@vitest/mocker→4.1.11、diff→8.0.4、js-yaml（5.x 线）、source-map-js、postcss-selector-parser、semver、electron-builder→26.15.3；`pnpm audit --registry=https://registry.npmjs.org --prod` 为目标命令。
- ✅ **overrides 纪律**：全部**按受影响范围定点钉版**，禁止跨 major 全局替换——实测全局升 js-yaml 打坏 `@redocly/openapi-core`（`openapi:gen` 崩）、全局升 basic-ftp 打坏 `@electron/get` 缓存枚举（electron-builder 崩）。
- ✅ **残留 3 条已登记** `SECURITY.md`（node-forge/sprintf-js 修复版未发布；katex 0.16 线无补丁且 rehype 链路锁 ^0.16）。
- ✅ **桌面打包致命回归修复**：electron-builder `extraResources` 静默丢弃根级 `node_modules`（bundle 1.42GB→100MB）；改为二级目录 `resources/bundle/server` + `server-manager.ts` 入口路径同步 + `prepare-server.mjs` 布局调整；**实跑验证**：打包产物内 `ELECTRON_RUN_AS_NODE` 起后端 → `/api/health` 200、111 路由全注册。
- ✅ **容器编排缺陷修复**：`docker-compose.yml` 缺 `HOST` 导致容器内绑回环（宿主 `-p` 不通）→ 补 `HOST=0.0.0.0` + 宿主侧仅发布 `127.0.0.1:3000`；`docker-compose.prod.yml` 因 `HOST=0.0.0.0`+`AUTH_MODE=none` 会被启动闸拒绝 → 显式 `ALLOW_INSECURE_BIND`（并注明不发布 3000 端口）；Dockerfile `pnpm@9`→`11.7.0` 并补 desktop package.json（锁文件一致性）。
- ✅ **仓库卫生**：删除两份陈旧 `package-lock.json`（声明 0.1.0、依赖口径与 0.4.x 全不符）+ `.gitignore` 拦截；删除零引用的 `pdf-parse`；移除根目录交付报告与重复的 `docs/website.html`；新增 `.github/dependabot.yml`（每周 + 安全组优先）与 `.prettierignore`。
- ✅ **门面与文档一致性**：`docs/index.html`（Pages 实际服务页）清除 Supervisor/手写 SVG/四平台等过时口径并补 badhope 仓入口；`docs/sciflow-code-tree.html` 删除幽灵 `orchestrator/` 模块改为真实 `pipeline/` 说明；`development.md`/`CONTRIBUTING.md`/`product-roadmap.md` 图表与计数口径改正；CHANGELOG 历史条目加"已被 0.4.0 取代"注记。
- ✅ **openapi:gen 跨平台修复**：Windows 下 `spawnSync` 经 shell 执行含空格路径（如 `Program Files` 下的 node.exe）失败 → 改为 node 直连 exec + pnpm 走 shell；产物 111 paths / version 0.4.1。

**已知准入项（非债）**：TanStack Table × React Compiler 互操作 lint warning ×1（库级官方已知，跳过组件记忆化，无运行时影响；CI 门禁为 0 error）。

**仅剩 backlog（路线图明确标注的 P2/不做项）**：QuickJS 不可信 JS 兜底（#23 尾项，路线图 P2 backlog）、外部学术 API/Pyodide/TeX Live/协作（路线图 §5 保持不做）。无其他计划内任务。
