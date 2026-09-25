# SciFlow · 全自动 AI 科研助手

> 多 Agent 编排流水线架构的科研工作台：输入一个研究主题，自动完成 **文献调研 → 大纲生成 → 分章起草 → 质量门评分（不达标自动回炉）→ 润色定稿 → 引用格式化** 的全流程。

## ✨ 功能

| 模块 | 能力 |
| --- | --- |
| **论文写作** | 大纲生成（outline-first）、章节起草、三段式学术润色（原文+润色文+理由）、中英互译、降重改写、自动保存与多版本历史 |
| **文献调研** | OpenAlex / arXiv / Semantic Scholar 三源真实检索、文献库管理、AI 结构化综述（每处观点绑定真实文献，防幻觉） |
| **全自动流水线** | 8 步状态机：主题验证 → 文献调研 → 大纲生成（**人工确认点**）→ 分章起草 → **质量门评分（<80 自动回炉重写）** → 润色定稿 → 引用格式化 → 完成 |
| **质量评分** | 7 维评分（文献/逻辑/引用/语言/创新/图表/格式，0-100）+ ECharts 雷达图 + 历史评分对比 |
| **科研问答** | SSE 流式多轮对话 |
| **投稿辅助** | 期刊推荐、Cover Letter、审稿意见回复 |

## 🏗 技术栈

```
apps/
├── server/  NestJS 11 · TypeScript · Drizzle ORM · SQLite（better-sqlite3）
│            · 原生 fetch 对接 OpenAI 兼容协议（OpenAI/DeepSeek/通义/豆包）
│            · 7 张表：Project / Document / Reference / Citation / QualityReport / PipelineTask / PolishRecord
└── web/     React 19 · Vite · TypeScript · Tailwind CSS v4 · ECharts · lucide-react
```

数据链条：`Project → Document（多版本）→ Citation → Reference（真实可追溯）`，`QualityReport` 关联文档可历史对比，`PipelineTask` 记录每步状态/回炉次数。

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

未配置 Key 时应用可正常使用（项目管理/文献检索），AI 功能会给出明确配置提示，不会返回假数据。

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

## 📜 License

MIT
