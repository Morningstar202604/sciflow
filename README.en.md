# SciFlow · Fully Automatic AI Research Assistant

> **🌐 Language / 语言：[English](README.en.md) · [中文](README.md)**

> **Repository mirrors (synced across 4 platforms)**
> [GitCode](https://gitcode.com/badhope/sciflow) · [Gitee](https://gitee.com/badhope/sciflow) · [GitHub · X33834](https://github.com/X33834/sciflow) · [GitHub · Morningstar202604](https://github.com/Morningstar202604/sciflow)
> All four mirrors are guarded by CI-level validation: typecheck ×2 · vitest · build ×2 · secret check — fully public and cloneable.

> A research workbench aligned with the 2026 mainstream Agent stacks (Claude Agent SDK / AutoGen / Deep Research). Give it a research topic, and a **Supervisor orchestrator** dispatches 5 specialized sub-agents (Planner / parallel Research×3 / Writer / Reviewer / Polisher) to run the full loop: **research planning → parallel literature survey (ReAct) → outline generation → section-wise drafting (Agentic RAG, search-while-writing) → quality-gate scoring (Reflexion self-reflection + rewrite below threshold) → polishing & finalization → citation formatting** — while automatically accumulating episodic/procedural memory.

## 📸 Screenshots

| Dashboard · Project Overview | Pipeline · Multi-Agent Orchestration |
| --- | --- |
| ![Dashboard](docs/screenshots/dash.png) | ![Pipeline](docs/screenshots/pipeline.png) |

| Writing · AI Assistant + Math Rendering | Quality · 7-Dimension Radar + Feedback |
| --- | --- |
| ![Writing](docs/screenshots/writing.png) | ![Quality](docs/screenshots/quality.png) |

> Screenshots are from the real running UI (local deployment, tested against a built-in AI gateway).

## ✨ Features

| Module | Capabilities |
| --- | --- |
| **Paper Writing** | Outline-first generation, section drafting, 3-stage academic polishing (original + polished + reasoning), Chinese↔English translation, de-duplication rewriting, autosave & version history |
| **Literature Survey** | Local reference library (manual add / project import / in-library search), AI structured review (every claim bound to real literature, anti-hallucination) |
| **Fully Automatic Pipeline** | Supervisor orchestration: **Planner** research plan (objective / sub-questions / search strategy / sections / risks) → **Research×3 parallel ReAct** (think→act→observe self-directed retrieval) → outline generation (**human confirmation point**) → **Writer section drafting** (Agentic RAG per-chapter lookups) → **Reviewer 7-dim quality gate (<80 triggers Reflexion + rewrite)** → **Polisher** → citation formatting → done (episodic memory auto-extracted) |
| **Agent Orchestration View** | Visualize each sub-agent's status / duration / summary on the pipeline page (`/api/pipeline/:id/agents`) |
| **MCP Toolbench** | 13 AI capabilities exposed as 11 standard MCP tools (2026-07 spec), individually invocable from Settings |
| **Model Routing** | fast / strong tiers: Q&A & polishing use the fast model; planning, long-text drafting and review auto-switch to the strong model |
| **Memory Center** | Episodic memory (auto-extracted per project) + procedural memory (writing-style instructions auto-injected into drafting) |
| **Quality Scoring** | 7 dimensions (literature / logic / citation / language / novelty / figures / format, 0-100) + ECharts radar + historical comparison |
| **Research Q&A** | SSE streaming multi-turn chat |
| **Submission Assistant** | Journal recommendation, Cover Letter, reviewer-response drafting |

## 🏗 Tech Stack

```
apps/
├── server/  NestJS 11 · TypeScript · Drizzle ORM · SQLite (better-sqlite3)
│            · Native fetch against domestic OpenAI-compatible endpoints (Doubao Volcano Ark / DeepSeek / Qwen / Zhipu / Kimi)
│            · 18 tables: Project / Document / Reference / Citation / QualityReport / PipelineTask / PolishRecord
│                     / KnowledgeDoc / KnowledgeChunk / ReflexionLog / MemoryLog / AgentRun / ModelProvider
│                     / McpServer / CustomIntent / PipelineConfig / AppSetting / CustomPrompt / LlmCallLog
│            · orchestrator/  Supervisor orchestrator (5 sub-agent types + parallel dispatch + trajectory logging)
│            · mcp/           MCP tool protocol (11 tools, list/call/info endpoints)
│            · Global token-bucket rate limiting (AI_RPM_CAP configurable, 429-safe on free tiers)
└── web/     React 19 · Vite · TypeScript · Tailwind CSS v4 · ECharts · lucide-react
```

Data chain: `Project → Document (multi-version) → Citation → Reference (real, traceable)`; `PipelineTask` records step status / retry counts / ReAct traces, `AgentRun` logs each sub-agent execution unit, `ReflexionLog` stores quality-gate reflection instructions, `MemoryLog` accumulates episodic/procedural memory.

## 🚀 Quick Start

Requirements: Node ≥ 20, pnpm ≥ 9

```bash
# 1. Install dependencies
pnpm install

# 2. Configure AI (copy .env.example to .env and fill in your API key)
cp apps/server/.env.example apps/server/.env
#    Default: Doubao (Volcano Ark). Also works with DeepSeek / Qwen / Zhipu / Kimi etc. domestic OpenAI-compatible endpoints

# 3. Build & run (backend :3000 + frontend :5173)
pnpm build
pnpm dev

# 4. Open in browser
#    http://localhost:5173
```

> SQLite is used with auto-migration on first boot (`apps/server/data/sciflow.db`) — zero-config out of the box.
> For production PostgreSQL: the Drizzle ORM abstraction is already in place — swap the driver and run `pnpm db:push`.

## 🔑 AI Configuration

| Variable | Description | Example |
| --- | --- | --- |
| `AI_BASE_URL` | OpenAI-compatible endpoint (default Doubao Volcano Ark) | `https://ark.cn-beijing.volces.com/api/v3` / `https://api.deepseek.com/v1` |
| `AI_API_KEY` | API key | `sk-...` |
| `AI_MODEL` | Model name | `agnes-3.0-flash` / `deepseek-chat` |
| `AI_MODEL_FAST` | Fast-tier model (Q&A / polish / translate) | `agnes-3.0-flash` |
| `AI_MODEL_STRONG` | Strong-tier model (planning / long-text / review) | falls back to fast if unset |
| `AI_RPM_CAP` | Max AI calls per minute (token bucket, 429-safe) | `8` |

Without a key the app still works (project management, literature search); AI features show a clear configuration prompt — never fake data.

## 🧪 Testing

```bash
# Unit tests (citation formatting and other core pure logic)
pnpm --filter server test
```

## 🧭 2026 Cutting-edge Upgrades (gap-closing batch)

Compared against 2026 mainstream Agent frameworks (LangGraph 1.x / OpenAI Agents SDK / Claude Agent SDK / Microsoft Agent Framework), all implemented locally with zero extra runtime dependencies:

**Backend (5)**
- **LLM cost tracking**: `llm_call_log` table + `GET /api/usage/summary` — token usage / success rate / latency by caller type and 14-day trend.
- **Structured output validation**: zod schemas validate outline / section / review outputs; broken JSON auto-falls-back and retries.
- **Checkpoint resume**: on service restart, `interrupted` tasks auto-resume idempotently from the draft stage (LangGraph-style checkpointing).
- **Guardrails (basic)**: MCP tool params validated against JSON Schema dynamically (missing params rejected); third-party tool outputs wrapped with `untrustedContentHint` + instruction isolation (OWASP MCP Top10 input-check points).
- **RAG upgrade**: BM25 + TF-vector cosine hybrid scoring, contextual-retrieval-style prefixes, zero-dependency Chinese bigram tokenization.

**Frontend (4)**
- **Hash routing**: deep links like `#/settings` work directly (modern SPA shareable state).
- **Dark mode**: `.dark` variant + localStorage persistence + toggle from command palette / bottom bar.
- **Cmd+K command palette**: global search navigation / new project / theme toggle (Notion-style desktop UX).
- **Markdown live preview**: edit / preview / split three modes in the writing page (react-markdown + typography).

**UI rework**: big-tech left-nav grouping (Research Tools / Automation / Assist), Supervisor orchestration grouped role timelines, unified teal palette replacing AI purple.

**Full regression**: `scripts/full_regression.py` covers all 66 routes (39 core assertions all green; AI assertions auto-skip when the external gateway rate-limits; Guardrail rejection / hybrid RAG / cost stats each have dedicated cases).

## ⚡ Performance & Code Optimization (audit batch)

After a full code audit (no behavior change, regression green):

**Performance**
- **First-screen JS 2.4MB → 821KB**: ECharts switched from full import to on-demand (`echarts/core` + RadarChart only); the quality page is route-lazy-loaded (443KB echarts chunk downloads only when entering the page).
- **Intent N+1 fix**: `ruleMatch` per-iteration DB reads (17+ intents × per request) hoisted out of the loop.
- **Model-list TTL cache**: Settings no longer hits the gateway `/models` every entry — 5-minute cache.

**DRY / structure**
- **`CollapsibleCard` component**: Settings' 4 collapsible cards (intents / prompts / pipeline / weights) share one component — a new section needs only 3 lines.
- **`AiService.buildChatRequest`**: `complete` / `completeStream` / `testConnection` unified through one request builder.

**Verified — no change needed (avoid re-inventing wheels)**
- Literature search already uses `Promise.allSettled` multi-source parallel + dedup; frontend `request` already has unified 60s timeout + error extraction; zod already centralizes structured-output validation.

## 🛡 Quality Assurance (pipeline field-test iterations)

A 3S-level survey task (GNN × drug discovery) ran fully automatically with a strict 7-dimension reviewer driving multi-round iteration; all systemic defects fixed:

- **Citations made real**: after drafting, `[Ref:N]` placeholders render to `[author year]` + a GB/T 7714 reference list at the end (placeholders previously judged as "fabricated citations").
- **Academic-integrity constraints**: drafting prompts hard-forbid fabricating experimental data / performance numbers; experimental conclusions must come from the given literature and be cited (fixes "fabricated QM9 metrics in survey").
- **Reference-pool cleansing**: drafting only uses literature with complete metadata (authors + year); numbering matches rendering; title-only hits from Agentic RAG lookups no longer pollute the library.
- **Local literature search**: removed overseas online sources (OpenAlex / arXiv / Semantic Scholar / CrossRef); zero external network dependency, search runs against the local reference library.
- **Strict quality gate**: total score < 80 triggers Reflexion → rewrite (up to 3 rounds); 7-dimension scores + feedback are queryable.

> Field-test trajectory: first round 46/100 (citation placeholders + fabricated experiments) → 7 root causes located & fixed → final validation round had 47/47 references with complete metadata and a normal full survey. The reviewer is designed as a "strict peer review" standard — deliberately strict.

## 🐳 Docker Deployment

```bash
# 1. Configure env (AI gateway required)
cp .env.example .env   # fill AI_BASE_URL / AI_API_KEY / AI_MODEL per comments

# 2. One-command startup (frontend :8080 → backend :3000, SQLite data persisted to ./apps/server/data)
docker compose up -d --build
```

- Frontend served by nginx with `/api` reverse proxy; backend Node 22 + SQLite (WAL).
- The image does not contain `.env`; all AI config is injected via environment variables (`${AI_*}` refs in `docker-compose.yml`).
- CORS defaults to `localhost:5173` only; for container deployment set `CORS_ORIGIN=http://localhost:8080`.

## 🔒 Security Notes

- This is a **local/private single-machine research assistant** — the API has no built-in account system; do NOT expose it directly to the public internet; always put it behind a reverse proxy / intranet.
- `.env` is gitignored; CI verifies `.env` is never committed; never write secrets into code.
- Dependency security: `pnpm audit` is clean (drizzle-orm / esbuild / echarts vulnerabilities all upgraded).

## 🛠 Engineering Guarantees

| Item | Status |
| --- | --- |
| Type checking | server/web dual `tsc --noEmit` (enforced in CI) |
| Unit tests | server vitest (enforced in CI) |
| Dependency audit | `pnpm audit` 0 vulnerabilities (checked before CI) |
| Frontend chunking | echarts/react as separate vendor chunks, main bundle 84KB |
| Stability | global unhandledRejection/uncaughtException guards + SQLite busy_timeout + graceful shutdown |
| CI | GitHub Actions: Node 22 × typecheck × test × build × secret check |

## 📁 Directory Structure

```
sciflow/
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── main.ts            # entry (CORS, global /api prefix)
│   │       ├── app.module.ts      # module assembly
│   │       ├── db/                # Drizzle schema + SQLite connection & migration
│   │       ├── ai/                # unified LLM service + research prompt templates
│   │       ├── literature/        # local reference-library search (overseas sources removed)
│   │       ├── projects/          # project management
│   │       ├── documents/         # documents, polishing, translation, citations, versions
│   │       ├── references/        # reference library & reviews
│   │       ├── quality/           # 7-dimension quality scoring
│   │       ├── pipeline/          # 8-step pipeline state machine (quality gate + rewrite)
│   │       ├── chat/              # SSE streaming Q&A
│   │       └── submission/        # journal recommendation / cover letter / review reply
│   └── web/
│       └── src/
│           ├── api/client.ts      # API client + SSE
│           ├── components/        # shared UI
│           └── pages/             # dashboard/writing/literature/pipeline/quality/chat/submission
└── package.json                   # pnpm workspace root
```

## 🧩 Design References (open-source gems)

- **GPT-Academic**: 3-stage polishing "original + polished + reason"
- **Academic Research Skills (ARS)**: 0-100 multi-dimensional quality gate, verifiable citations (DOI)
- **OpenScholar**: survey citations bound to real literature, anti-hallucination
- **STORM**: outline-first writing
- **Agent Laboratory**: staged pipeline + human confirmation points (human-in-the-loop)
- **GPT Researcher**: multi-source retrieval synthesis
- **Claude Agent SDK / AutoGen**: Supervisor multi-agent orchestration, parallel subtasks, observable traces
- **OpenAI Deep Research**: iterative self-directed retrieval (Agentic RAG, search-while-writing)
- **Reflexion (Shinn et al.)**: distill semantic reflection instructions from review failures, inject into rewrites

## 📜 License

MIT
