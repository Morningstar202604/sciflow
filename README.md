# SciFlow · 全自动 AI 科研助手

> 对标 2026 主流 Agent 方案（Claude Agent SDK / AutoGen / Deep Research）的科研工作台：输入一个研究主题，由 **Supervisor 编排器** 调度 5 类专业子 Agent（Planner / 并行 Research×3 / Writer / Reviewer / Polisher），完成 **研究规划 → 并行文献调研（ReAct）→ 大纲生成 → 分章起草（Agentic RAG 边写边查）→ 质量门评分（不达标 Reflexion 自动回炉）→ 润色定稿 → 引用格式化** 的全流程，并自动沉淀情景/程序记忆。

## ✨ 功能

| 模块 | 能力 |
| --- | --- |
| **论文写作** | 大纲生成（outline-first）、章节起草、三段式学术润色（原文+润色文+理由）、中英互译、降重改写、自动保存与多版本历史 |
| **文献调研** | OpenAlex / arXiv / Semantic Scholar 三源真实检索、文献库管理、AI 结构化综述（每处观点绑定真实文献，防幻觉） |
| **全自动流水线** | Supervisor 多 Agent 编排：**Planner** 研究计划（目标/子问题/检索策略/章节/风险）→ **Research×3 并行 ReAct**（think→act→observe 自主补检）→ 大纲生成（**人工确认点**）→ **Writer 分章起草**（Agentic RAG 每章补检）→ **Reviewer 7 维质量门（<80 触发 Reflexion 反思并回炉重写）** → **Polisher 润色** → 引用格式化 → 完成（自动沉淀情景记忆） |
| **Agent 编排视图** | 流水线页可视化每个子 Agent 的执行状态/耗时/摘要（`/api/pipeline/:id/agents`） |
| **MCP 工具台** | 13 个 AI 能力协议化为 11 个标准 MCP 工具（2026-07 规范），设置页可逐个可视化调用 |
| **模型路由** | fast / strong 双档：问答润色走快模型，规划/长文/评审自动切强模型 |
| **记忆中心** | 情景记忆（项目自动沉淀）+ 程序记忆（写作风格指令，起草自动注入） |
| **质量评分** | 7 维评分（文献/逻辑/引用/语言/创新/图表/格式，0-100）+ ECharts 雷达图 + 历史评分对比 |
| **科研问答** | SSE 流式多轮对话 |
| **投稿辅助** | 期刊推荐、Cover Letter、审稿意见回复 |

## 🏗 技术栈

```
apps/
├── server/  NestJS 11 · TypeScript · Drizzle ORM · SQLite（better-sqlite3）
│            · 原生 fetch 对接 OpenAI 兼容协议（OpenAI/DeepSeek/通义/豆包/Agnes）
│            · 11 表：Project / Document / Reference / Citation / QualityReport / PipelineTask / PolishRecord
│                     / KnowledgeDoc / KnowledgeChunk / ReflexionLog / MemoryLog / AgentRun
│            · orchestrator/  Supervisor 编排器（五类子 Agent + 并行调度 + 轨迹记录）
│            · mcp/           MCP 工具协议化（11 个工具，list/call/info 端点）
│            · 全局令牌桶限流（AI_RPM_CAP 可配，稳定适配免费版 429）
└── web/     React 19 · Vite · TypeScript · Tailwind CSS v4 · ECharts · lucide-react
```

数据链条：`Project → Document（多版本）→ Citation → Reference（真实可追溯）`；`PipelineTask` 记录步骤状态/回炉次数/ReAct 轨迹，`AgentRun` 记录每个子 Agent 的执行单元，`ReflexionLog` 保存质量回炉的反思指令，`MemoryLog` 沉淀情景/程序记忆。

## 🚀 快速开始

要求：Node ≥ 20、pnpm ≥ 9

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 AI（复制 .env.example 为 .env 并填写你的 API Key）
cp apps/server/.env.example apps/server/.env
#    支持 OpenAI / DeepSeek / 通义千问 / 豆包（火山方舟）等 OpenAI 兼容接口

# 3. 编译并启动（后端 :3000 + 前端 :5173）
pnpm build
pnpm dev

# 4. 浏览器打开
#    http://localhost:5173
```

> 数据库使用 SQLite，首次启动自动建表（`apps/server/data/sciflow.db`），零配置开箱即跑。
> 生产环境切换 PostgreSQL：Drizzle ORM 已抽象，替换连接驱动并执行 `pnpm db:push` 即可。

## 🔑 AI 配置说明

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `AI_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` / `https://api.deepseek.com/v1` |
| `AI_API_KEY` | API 密钥 | `sk-...` |
| `AI_MODEL` | 模型名 | `gpt-4o-mini` / `deepseek-chat` |
| `AI_MODEL_FAST` | fast 档模型（问答/润色/翻译） | `agnes-3.0-flash` |
| `AI_MODEL_STRONG` | strong 档模型（规划/长文/评审） | 未配置则回落 fast |
| `AI_RPM_CAP` | 每分钟最大 AI 调用数（令牌桶防 429） | `8` |

未配置 Key 时应用可正常使用（项目管理/文献检索），AI 功能会给出明确配置提示，不会返回假数据。


## 🧪 测试

```bash
# 单元测试（引用格式化等核心纯逻辑）
pnpm --filter server test
```

## 🧭 2026 前沿升级（查漏补缺批次）

对照 2026 主流 Agent 框架（LangGraph 1.x / OpenAI Agents SDK / Claude Agent SDK / Microsoft Agent Framework）补齐的能力，全部本地实现、零额外运行时依赖：

**后端（5 项）**
- **LLM 成本追踪**：`llm_call_log` 表 + `GET /api/usage/summary`，按任务类型（caller）与近 14 天趋势统计 token 用量 / 成功率 / 延迟。
- **结构化输出校验**：zod schema 校验大纲/章节/评审等 AI 输出，坏 JSON 自动兜底重试。
- **Checkpoint 断点续跑**：服务重启后自动恢复 `interrupted` 状态任务，从草稿阶段幂等续跑（对应 LangGraph checkpointing）。
- **Guardrails 基础版**：MCP 工具参数按 JSON Schema 动态校验（缺参即拒），第三方工具返回统一加 `untrustedContentHint` 与指令隔离（对应 OWASP MCP Top10 输入检查点）。
- **RAG 检索升级**：BM25 + TF 向量余弦混合评分、上下文前缀（Contextual Retrieval 思路）、零依赖中文 Bigram 分词。

**前端（4 项）**
- **hash 路由**：`#/settings` 等深层链接直达（对应现代 SPA 可分享状态）。
- **暗色模式**：`.dark` 变体 + localStorage 持久化 + 命令面板/底部栏切换。
- **Cmd+K 命令面板**：全局搜索导航 / 新建项目 / 主题切换（Notion 式桌面体验）。
- **Markdown 实时预览**：写作页编辑 / 预览 / 分栏三态（react-markdown + typography 排版）。

**UI 重构**：大厂式左导航分组（研究工具 / 自动化 / 辅助）、Supervisor 编排按角色分组时间线、teal 统一色板替换 AI 紫。

**全量回归**：`scripts/full_regression.py` 覆盖全部 66 个路由（39 项核心断言全绿 + AI 接口受外部网关限流时自动降级跳过，Guardrail 拒参 / RAG 混合检索 / 成本统计均有专项用例）。

## 🐳 Docker 部署

```bash
# 1. 配置环境变量（AI 网关必填）
cp .env.example .env   # 按注释填写 AI_BASE_URL / AI_API_KEY / AI_MODEL

# 2. 一键起服务（前端 :8080 → 后端 :3000，SQLite 数据持久化到 ./apps/server/data）
docker compose up -d --build
```

- 前端 nginx 静态托管 + `/api` 反代；后端 Node 22 + SQLite（WAL）。
- 镜像不包含 `.env`，AI 配置全部经环境变量注入（`docker-compose.yml` 中 `${AI_*}` 引用）。
- CORS 默认仅放行 `localhost:5173`，容器部署时设置 `CORS_ORIGIN=http://localhost:8080`。

## 🔒 安全说明

- 本工具定位为**本地/私有部署的单机科研助手**，API 未内置账号体系——请勿直接暴露到公网，部署时务必置于反向代理/内网之后。
- `.env` 已被 gitignore，CI 会自动校验 `.env` 不被提交；请勿把密钥写入代码。
- 依赖安全：`pnpm audit` 已清零（drizzle-orm / esbuild / echarts 漏洞均已升级修复）。

## 🛠 工程保障

| 项 | 状态 |
| --- | --- |
| 类型检查 | server/web 双端 `tsc --noEmit`（CI 强制） |
| 单元测试 | server vitest（CI 强制） |
| 依赖审计 | `pnpm audit` 0 漏洞（CI 前自查） |
| 前端分包 | echarts/react 独立 vendor chunk，主包 84KB |
| 稳定性 | 全局 unhandledRejection/uncaughtException 兜底 + SQLite busy_timeout + 优雅关闭 |
| CI | GitHub Actions：Node 20/22 × typecheck × test × build × 密钥校验 |
## 📁 目录结构

```
sciflow/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts            # 入口（CORS、全局前缀 /api）
│   │       ├── app.module.ts      # 模块装配
│   │       ├── db/                # Drizzle schema（7 表）+ SQLite 连接与建表
│   │       ├── ai/                # 统一 LLM 服务 + 科研 Prompt 模板库
│   │       ├── literature/        # 三源文献检索（OpenAlex/arXiv/Semantic Scholar）
│   │       ├── projects/          # 项目管理
│   │       ├── documents/         # 文档、润色、翻译、引用、版本历史
│   │       ├── references/        # 文献库与综述
│   │       ├── quality/           # 7 维质量评分
│   │       ├── pipeline/          # 8 步流水线状态机（质量门+回炉）
│   │       ├── chat/              # SSE 流式问答
│   │       └── submission/        # 期刊推荐/Cover Letter/审稿回复
│   └── web/
│       └── src/
│           ├── api/client.ts      # API 封装 + SSE 客户端
│           ├── components/        # 通用 UI
│           └── pages/             # 工作台/写作/文献/流水线/评分/问答/投稿
└── package.json                   # pnpm workspace 根
```

## 🧩 设计参考（开源项目精华）

- **GPT-Academic**：三段式润色「原文 + 润色文 + 润色理由」
- **Academic Research Skills（ARS）**：0-100 多维质量关卡、引用可核验（DOI）
- **OpenScholar**：综述引用绑定真实文献、防幻觉
- **STORM**：outline-first 大纲先行写作
- **Agent Laboratory**：分阶段流水线 + 人工确认点（Human-in-the-loop）
- **GPT Researcher**：多源检索汇总
- **Claude Agent SDK / AutoGen**：Supervisor 多 Agent 编排、并行子任务、可观测轨迹
- **OpenAI Deep Research**：Agentic RAG 迭代式自定向检索（边写边查）
- **Reflexion（Shinn et al.）**：评审失败提炼语义反思指令，回炉注入重写

## 📜 License

MIT
