# SciFlow · Fully Automatic AI Research Assistant

> **Local-First AI Research Workbench · single-user, single-machine**

[![CI](https://github.com/Morningstar202604/sciflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Morningstar202604/sciflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520%20(CI%2022)-339933.svg)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-f69220.svg)](package.json)
[![version](https://img.shields.io/badge/version-0.4.2-black.svg)](CHANGELOG.md)

> **🌐 Language / 语言：[English](README.en.md) · [中文](README.md)**

> **Repository mirrors (synced across 5 platforms)**
> [GitCode](https://gitcode.com/badhope/sciflow) · [Gitee](https://gitee.com/badhope/sciflow) · [GitHub · badhope](https://github.com/badhope/sciflow) · [GitHub · X33834](https://github.com/X33834/sciflow) · [GitHub · Morningstar202604](https://github.com/Morningstar202604/sciflow)
> The three GitHub mirrors run the same CI: lint · typecheck ×2 · vitest ×2 · build ×2 · full mock regression (165 checks) · promptfoo prompt-contract evals · Playwright smoke; GitCode and Gitee mirror the same release tree.

SciFlow is a **local-first, single-machine** AI research assistant: give it a research topic and it runs the whole academic lifecycle — **literature survey → research planning → outline generation (human confirmation) → section-wise drafting (Agentic RAG, search-while-writing) → 7-dimension quality gate (auto Reflexion rewrite below threshold) → polishing → citation formatting → submission assistance** — while accumulating process assets in a NotebookLM-style RAG knowledge base and a visual workbench.

- **No external AI SaaS dependency**: AI goes exclusively through the **OpenAI-compatible protocol** (Vercel AI SDK transport layer) against your own model key — works with Ollama / LM Studio local endpoints too.
- **Local-first**: SQLite single-file store, zero-config. Your literature, notes, memory and keys stay on your machine; no multi-tenancy, no third-party uploads.

## 📸 Screenshots

| Chat Workspace · default view | Pipeline · Agent Orchestration |
| --- | --- |
| ![Chat workspace](docs/screenshots/workspace.png) | ![Pipeline](docs/screenshots/pipeline.png) |

| Writing · Outline + AI assistant + math | Quality · 7-Dimension Radar + Feedback |
| --- | --- |
| ![Writing](docs/screenshots/writing.png) | ![Quality](docs/screenshots/quality.png) |

| Literature Library · screening & coding matrix | Knowledge Base RAG · grounded Q&A |
| --- | --- |
| ![Literature](docs/screenshots/literature.png) | ![Knowledge](docs/screenshots/knowledge.png) |

> Screenshots come from the real running UI (local deployment, verified against the built-in AI gateway).

## ✨ Features

### Writing & Finalization
- **Outline-first**: AI generates the research plan and section outline; the writing page has edit / preview / split modes.
- **Section-wise drafting + Agentic RAG**: every section looks things up in the local knowledge base while writing; in-text `[n]` anchors match the reference list one-to-one.
- **Academic polishing**: 3-stage polish (original + polished + reasoning), Chinese↔English translation, de-duplication rewriting; figures and the reference tail are protected from being washed out.
- **Multi-version history + version diff**: each finalization stores a snapshot; versions are compared with LCS text diff (`VersionDiffModal`).
- **One-click export**: Markdown / HTML / LaTeX (.tex) / Word (.docx).

### Citations & References
- **8 citation styles**: APA / IEEE / Vancouver / **GB/T 7714** / Nature / Chicago / Springer / ACS.
- **In-text anchor reordering**: numeric styles keep insertion order; author-year styles get automatic a/b suffix reordering by first appearance (`CiteReorderButton`).
- **BibTeX / RIS import & export**: metadata dedup fingerprints, `reading_status` state machine (unread / reading / read / cited).
- **PRISMA screening + coding matrix**: include/exclude criteria screening and structured extraction in the literature page.
- **Force-directed citation network**: sigma.js + graphology + ForceAtlas2 (WebGL) interactive graph of reference relationships.

### Knowledge Base RAG (NotebookLM-style)
- Local **sqlite-vec vector ANN + FTS5 trigram full-text** hybrid retrieval (falls back to full-text when the embedding model is unavailable; Chinese queries are expanded as 3-gram OR terms); knowledge documents and references are mutually bound, hits carry author/year source cards.

### Fully Automatic Pipeline
- **LangGraph-orchestrated pipeline with a human confirmation point**: topic verification → literature survey → outline generation → **outline confirmation (interrupt)** → section drafting (parallel, configurable concurrency) → **7-dimension quality gate** (<80 triggers a Reflexion rewrite, up to 3 rounds, best-scoring round wins) → polishing → citation formatting; confirm and resume right inside the chat workspace.
- **Checkpoint resume**: after a service restart, interrupted tasks resume idempotently from the drafting stage.
- **Model routing**: fast / strong tiers — Q&A and polishing use the fast model; planning, long-text drafting and review auto-switch to the strong model.

### Quality & Review
- **7-dimension quality scoring**: literature / logic / citation / language / novelty / figures / format (0–100), Recharts radar + historical comparison.
- **Review loop**: structured parsing of reviewer comments, per-comment response templates, revision deadline countdown.

### Submission Assistance
- Journal matching (by topic/scope), Cover Letter generation, submission status tracking (submitted → under review → revision → accepted/rejected → resubmission chain).

### Experiments & Memory
- **Experiment sandbox**: isolated `spawn` of Python scripts (`SANDBOX_PYTHON` / `SANDBOX_TIMEOUT_MS` configurable) with resource guards and clear fallbacks.
- **Memory center**: episodic memory (auto-accumulated per project) + procedural memory (writing-style instructions auto-injected into drafting).
- **Retro cards / mind maps**: pipeline retrospection points distilled into structured cards.

### Experience Details
- **⌘K command palette**: global navigation / new project / dark mode; deep links via `#/` hash routes.
- **MCP toolbench**: AI capabilities exposed as standard MCP tools (official SDK, Streamable HTTP + stdio transports), individually invocable from Settings with dynamic JSON-Schema parameter validation (guardrail rejects are surfaced as errors).
- Fully localized error copy, narrow-screen adaptation, branded gradient visual system.

## 🏗 Tech Stack

| Part | Stack |
| --- | --- |
| Backend `apps/server` | NestJS 11 · TypeScript (strict) · Drizzle ORM · better-sqlite3 (WAL) · Vercel AI SDK (OpenAI-compatible) · LangGraph (orchestration / checkpoint resume / interrupts) · official MCP SDK · zod · helmet + pino · in-process MSW mock gateway |
| Frontend `apps/web` | React 19 · Vite 6 · TypeScript · Tailwind CSS v4 · TanStack Query / Table · Recharts · sigma.js + graphology · streamdown (streaming Markdown) · CodeMirror 6 · react-markdown + KaTeX |
| Desktop `apps/desktop` | Electron 41 (embedded Node 24, native `require(ESM)`) · embedded backend (`ELECTRON_RUN_AS_NODE`) · local SQLite (userData-isolated, native modules auto-rebuilt for the Electron ABI when packaging) · electron-builder · electron-updater (opt-in) |
| Engineering | pnpm workspace · vitest (server 68 / web 50) · Playwright smoke · promptfoo prompt-contract evals · GitHub Actions with 3 jobs (types/unit/build · full regression · E2E+evals) · Python 3 regression script (165 checks) |

**Architecture overview**

```
apps/server/src/   backend modules (NestJS)
├── ai/            AI SDK model layer + prompt templates + MSW mock gateway + global token-bucket rate limit
├── projects/      project management   ├── documents/   docs / polish / translate / citations / versions / export
├── references/    reference library    ├── knowledge/   RAG knowledge base (vectors + FTS5 full-text)
├── pipeline/      LangGraph orchestration (interrupt / checkpointer)  ├── agent/  agent execution traces
├── research/      literature survey + quality scoring + submission assistance (controllers)
├── judgment/      review loop          ├── experiments/ experiment sandbox
├── chat/          SSE streaming Q&A    ├── memory/      episodic / procedural memory
├── mcp/           MCP toolbench        ├── settings/    settings / model connectivity self-check
├── dashboard/     workspace aggregation├── db/          Drizzle schema + SQLite
└── common/        shared utilities

apps/web/src/pages/  frontend pages
Workspace · Dashboard · Writing · Literature · Knowledge
Pipeline · Quality · Experiments · Memory · Submission · Settings
```

Data chain: `Project → Document (multi-version) → Citation → Reference (real, traceable)`; `PipelineTask` / `AgentExecution` / `ReflexionLog` / `MemoryLog` / `LlmCallLog` record pipeline state, agent traces, rewrite reflections, memory accumulation and token cost respectively.

## 🚀 Quick Start

Requirements: Node ≥ 20 (CI pins Node 22), pnpm ≥ 9 (this repo pins `pnpm@11.7.0`)

```bash
# 1. Clone and install
git clone <any mirror URL> sciflow && cd sciflow
pnpm install

# 2. Configure AI (copy the template and fill in your own key; all vars are documented)
cp apps/server/.env.example apps/server/.env
#    Edit apps/server/.env: at least AI_BASE_URL / AI_API_KEY / AI_MODEL

# 3. Build the backend
pnpm --filter @sciflow/server build

# 4. Run (two terminals)
#    backend :3000
node apps/server/dist/apps/server/src/main.js
#    frontend :5173
pnpm --filter @sciflow/web dev

# 5. Open in browser
#    http://localhost:5173
```

> SQLite tables are created automatically on first boot (default `apps/server/data/sciflow.db`) — zero config.
> The backend binds `127.0.0.1` only by default; set `HOST=0.0.0.0` explicitly to expose it on a LAN.

### 🖥 Desktop app (optional)

```bash
pnpm install && pnpm build          # build backend + frontend first
pnpm icons                          # generate app icons from the vector master (first time)
pnpm desktop:dev                    # dev mode (web dev server + desktop shell)
pnpm desktop:dist                   # package the installer for the current platform → apps/desktop/release/
```

Data lives in the platform-standard directory (Windows `%APPDATA%\SciFlow`), fully offline; see [`apps/desktop/README.md`](apps/desktop/README.md) and [`docs/BRAND.md`](docs/BRAND.md).

## 🔑 AI Configuration

SciFlow works with **any OpenAI-compatible endpoint** — just `base_url` + `model` + `key`:

| Variable | Description | Example (placeholder, not a real key) |
| --- | --- | --- |
| `AI_BASE_URL` | OpenAI-compatible endpoint | `https://api.deepseek.com/v1` |
| `AI_API_KEY` | Your API key | `sk-your-api-key-here` |
| `AI_MODEL` | Default model | `deepseek-chat` |
| `AI_MODEL_FAST` | Fast tier (Q&A / polish / translate / review JSON) | falls back to `AI_MODEL` if unset |
| `AI_MODEL_STRONG` | Strong tier (planning / long-text drafting) | falls back to `AI_MODEL` if unset |
| `AI_RPM_CAP` | Max AI calls per minute (token bucket, 429-safe) | `8` (use 100+ for long pipelines) |
| `AI_MOCK` | Set to `1` to enable the in-process mock gateway (MSW interception; full pipeline without a key / network) | `1` |
| `CORS_ORIGIN` | Allowed frontend origins (comma-separated) | `http://localhost:5173` |

Compatible endpoints (any of these, always `base_url` + model name): DeepSeek `https://api.deepseek.com/v1`, Volcano Ark `https://ark.cn-beijing.volces.com/api/v3`, Zhipu `https://open.bigmodel.cn/api/paas/v4`, Kimi `https://api.moonshot.cn/v1`, Ollama local `http://localhost:11434/v1`, etc.

> Without a key, local features (project management / reference library / RAG) keep working; AI features show a clear configuration prompt and **never return fake data**.

## 🧪 Testing & Regression

```bash
# Type checks (both ends, enforced in CI)
pnpm --filter @sciflow/server typecheck
pnpm --filter @sciflow/web typecheck

# Unit tests (vitest: server 68 + web 50)
pnpm --filter @sciflow/server test
pnpm --filter @sciflow/web test

# Builds (both ends)
pnpm --filter @sciflow/server build && pnpm --filter @sciflow/web build

# E2E smoke (Playwright; prerequisites: mock backend :3000 + web dev :5173 running)
pnpm exec playwright test e2e/workspace-smoke.spec.ts
# Real-model E2E (skipped by default; needs a real endpoint): E2E_REAL=1 pnpm exec playwright test e2e/real-chat.spec.ts

# Prompt-contract evals (promptfoo, offline; prerequisites: server build + mock HTTP gateway below)
pnpm exec promptfoo eval -c evals/promptfooconfig.yaml
```

### Built-in mock AI gateway (full pipeline without a key / network)

With `AI_MOCK=1`, **MSW intercepts all AI calls in-process** (no port, no network) and returns **deterministic** responses by prompt keyword (research plan / outline JSON, Chinese sections with `[Ref:N]`, a ≈87/100 7-dimension review that does not trigger a rewrite, 3-stage polish, RAG answers, journal matching, …), with SSE chunking.

```bash
# backend (mock mode, relaxed rate limit)
AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_regression.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js

# other terminal: full regression (all routes + one end-to-end pipeline with artifact assertions)
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 \
  python3 scripts/full_regression.py
```

> When an external tool (e.g. promptfoo) needs a real HTTP endpoint: `node apps/server/scripts/mock-openai-http.mjs` — it reuses the same route table and listens on `127.0.0.1:5099`.

Regression baseline (fresh database + mock gateway, see `scripts/full_regression.py`): **PASS 165 / FAIL 0 / KNOWN 0** (the KNOWN mechanism remains, currently empty — all 11 legacy gaps fixed). The mock gateway is for testing/demos only and does not represent real model capability.

## 📚 Documentation Index

| Document | Content |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Single source of truth: dependency map / anti-reinvention rules / phase progress & backlog |
| [`docs/product-roadmap.md`](docs/product-roadmap.md) | Product roadmap: capability matrix, design principles, gaps |
| [`docs/index.html`](docs/index.html) | Project homepage (static single page, opens in a browser) |
| [`docs/sciflow-code-tree.html`](docs/sciflow-code-tree.html) | Full-repo code tree visualization |
| [`docs/screenshots/`](docs/screenshots/) | Real screenshots (workspace / pipeline / writing / quality / literature / knowledge) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Dev environment, commit conventions, PR flow |
| [`SECURITY.md`](SECURITY.md) | Security design notes and vulnerability disclosure |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

## 🌱 Demo Data

- On first boot the demo project seeds **1 example reference + 1 knowledge document** so you can immediately try reference binding, RAG retrieval and the pipeline;
- All pipeline artifacts (documents / versions / citations / memory) live in the local SQLite file — delete the file at `DATABASE_PATH` to start clean.

## 🐳 Docker Deployment

```bash
cp apps/server/.env.example .env   # fill AI_BASE_URL / AI_API_KEY / AI_MODEL per the comments
docker compose up -d --build       # nginx-served frontend :8080 → backend :3000
# for container deployment set CORS_ORIGIN=http://localhost:8080
```

## 📜 License

[MIT](LICENSE) © 2026 SciFlow Contributors
