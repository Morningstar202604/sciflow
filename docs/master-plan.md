# SciFlow 开发主计划（Master Plan v1）
> 制定：2026-10-17 · 基线 v0.4.2 (ae36734) · 主仓 GitHub/badhope · 4 只读镜像自动同步
> 本文档是**唯一开发计划真理源**：所有路线调整必须回写本文档，与 ARCHITECTURE.md（架构真理源）平行生效。

---

## 0. 执行摘要

**一句话**：把 SciFlow 从「流程能跑的科研流水线」升级为「AI 做不了的那部分科研工作的放大器」。

三个战略判断（依据见 §1）：
1. **不打文献图谱仗**——Elicit/SciSpace 用亿美元级数据壁垒打不动，开源界也没有第二个 OpenAlex。我们用「开源接口聚合 + 用户自建库」取巧。
2. **不打本地隐私仗**——人人都能接 API、人人都有本地化方案，这张牌没有信息差。放弃。
3. **只打「AI 失效模式」仗**——幻觉引用污染文献（Nature 2026 实锤）、研究同质化（monocultures of knowing）、实验设计粗糙、同行评议错位。这些是 AI 结构性做不了的事，做成功能就是护城河。

---

## 1. 调研总结

### 1.1 竞品能力矩阵（2026-10 实测/公开资料）

| 能力 | Elicit ($49/mo) | SciSpace ($20-70/mo) | Consensus | STORM(开源) | **SciFlow 现状** |
|---|---|---|---|---|---|
| 文献发现（在线图谱） | ★★★ 1.25亿+ | ★★★ | ★★ | ✗ | ✗（合规决策）→ §6.1 开源聚合 |
| 全文 PDF 理解 | ★★ | ★★★ | ★ | ✗ | ★★（unpdf+RAG 有底子） |
| 系统综述筛选/编码 | ★★★ PRISMA | ★★ | ✗ | ✗ | ★★（筛选队列+编码矩阵已有） |
| 证据综合（支持/矛盾） | ★★ | ★ | ★★★ | ✗ | ★（evidence 合成有，无强度分级） |
| 自动论文写作 | ★ | ★★ | ✗ | ★★★ 多视角 | ★★★（唯一全流程闭环） |
| 质量门/自反思 | ✗ | ✗ | ✗ | ✗ | ★★（7 维+Reflexion，唯一） |
| 引用核验 | 部分 | ✗ | ✗ | ✗ | ★★（本地池锚定，→§6.3 升级闭环） |
| 数据/实验沙箱 | ✗ | ✗ | ✗ | ✗ | ★★★（Python 沙箱，唯一） |
| 本地化部署 | ✗ | ✗ | ✗ | ★ | ★★★（唯一单机版） |
| MCP 生态接入 | ✗ | ✗ | ✗ | ✗ | ★★★（server+client，唯一） |

**结论**：全自动写作+质量门+沙箱+MCP 是独有组合；文献获取是最大短板（有解，见 §6.1）。

### 1.2 AI 结构性失效模式 → SciFlow 机会映射

| # | AI 做不了/做不好的（2025-2026 文献共识） | 机会功能 | 优先级 |
|---|---|---|---|
| F1 | **幻觉引用**：数万篇 2025 论文含无效引用（Nature 分析） | 引用闭环核验（§6.3）：每个 `[Ref:N]` 必须绑定库内真实文献，池外引用红牌警示，DOI 自动核验（Crossref 用户自配） | P0 |
| F2 | **研究同质化**：AI 生成大纲/表述趋同（monocultures of knowing） | 多样性引擎（§6.4）：强制反共识检索轮、对立观点标注、跨学科视角注入 | P1 |
| F3 | **实验设计粗糙**：AI 不能替代 power analysis/对照设计 | 实验设计助手（§6.5）：样本量计算、随机化方案、预注册模板生成 | P1 |
| F4 | **同行评议错位**：AI 审稿易被愚弄，会议禁 AI 审稿 | 模拟审稿降级为「预审参考」+ 明确免责标注；意见分类准确性作为 promptfoo 契约 | P2 |
| F5 | **数据造假风险**：AI 编造实验数据 | 诚信硬约束已有（DRAFT_SECTION 禁虚构）+ 数据溯源：沙箱实验自动生成可复现记录（§6.5 已有雏形） | P1 |
| F6 | **领域深度不足**：通用模型不熟垂直领域 | 项目 preface 已有；升级为「领域知识包」（用户导入的领域综述自动构建术语表注入） | P2 |

---

## 2. 产品能力地图（v0.5 → v1.0）

```
科研全生命周期（已有✅ / 计划🔨）
├── 选题     ✅ 研究缺口分析    🔨 选题热度雷达(开源数据聚合 §6.1)
├── 文献     ✅ 本地库+导入     🔨 arXiv镜像/S2/OpenAlex 聚合(用户自开) · DOI核验
├── 检索     ✅ BM25+ANN混合    🔨 重排序 · HyDE · 块级上下文补全 · 批量嵌入
├── 阅读     ✅ 深读/表格抽取   🔨 批量矩阵(已有)升级多文档对比视图
├── 规划     ✅ 检索规划        🔨 researchQuestions 全链路贯通(修H7)
├── 写作     ✅ 大纲→分章→润色  🔨 Reflexion定向回炉(修H1) · 多样性引擎
├── 质量门   ✅ 7维+best-of-N   🔨 逐章评分 · 修复指令结构化
├── 引用     ✅ 编号+CSL        🔨 正文锚定闭环 · 两套渲染并轨 · a/b消歧
├── 实验     ✅ Python沙箱      🔨 实验设计助手 · 数据集挂载 · 可复现档案
├── 投稿     ✅ 期刊匹配+回复信 🔨 投稿材料包一键导出
├── 桌面     ✅ Electron封装    🔨 自动更新(channel) · 托盘常驻
├── CLI      ✅ commander       🔨 headless流水线 · 输出格式化 · fetch重构(修W76)
└── MCP      ✅ server+client   🔨 工具面扩到 web.search/experiments(只读)
```

---

## 3. 模块化重构（可维护性第一）

**现状痛点**：跨模块直连（pipeline 直接 new CitationRenderer、db 全局单例四处 import、schema 与手写 DDL 双轨），新功能都往 apps/server 塞，包边界模糊。

**目标包结构**（pnpm workspace 渐进迁移，每包一个 PR，不搞大爆炸）：

```
packages/
├── core/          # 领域类型 + 纯逻辑（零 IO）：Outline/PaperHit/质量维度/引用渲染算法
├── db/            # drizzle schema + 迁移 + 连接（唯一 DDL 真理源，消灭双轨 W10）
├── ai/            # transport(service+prompts+mock) + 成本账本 + provider 路由
├── retrieval/     # 分块/嵌入/混合检索/重排序（knowledge 逻辑整体迁入）
├── integrations/  # websearch providers / 学术源聚合 / MCP client /沙箱执行器
apps/
├── server/        # Nest 编排层：controller + service 组装，只做粘合不做逻辑
├── web/           # React：pages/ 按域拆组件（Writing/Literature/... 每页≤400行）
├── desktop/       # Electron：main/preload/server-manager/auto-updater
└── cli/           # commander：命令注册 + 输出渲染，经 HTTP 不直连 DB
```

**迁移纪律**：新代码先入 packages/；旧代码按「改哪个迁哪个」节奏，禁止专门的大迁移 PR。每包独立 vitest，`pnpm -r test` 全绿才可合并。

---

## 4. 分端详细计划

### 4.1 Server（NestJS）

| 项 | 方案 | 验收 |
|---|---|---|
| H1 Reflexion 定向回炉 | quality-gate 评审输出升级为 `{scores, perSectionFeedback[{section, issues[], fixInstruction}]}`；runDrafting 只重写低分章节（score<阈值），携带对应 fixInstruction 进 prompt；`reflexionLogs.instructions` 真正写入 | 一轮回炉只重起草 ≤2 章节；修复后分数提升有据可查 |
| H2 并发互斥 | 同 projectId 的 running 任务数 >0 时 `create()` 抛 409「已有任务运行」；前端引导查看现有任务 | 连点两次开始按钮只有一个任务 |
| H4/H3 检索链 | `references.search` SQL 加 `LIMIT`；`likeSearch` 补 `LIMIT topK`；likeSearch 注释错误更正（FTS5 trigram 对 CJK 按 3 字符分词，2 字中文关键词用 LIKE）；chat 注入从 320 字提升到 800（=CHUNK_SIZE） | 中文两字词可命中 FTS；大库 search O(log n) |
| H5 嵌入批量化 | `upload`/`addFromReference` 嵌入改 `p-limit(2)` 队列 + 进度事件（SSE 推 chunk x/y）；分块 overlap 15%（120 字） | 500 块文档上传不爆内存、有进度条 |
| H8 全文深读 | deepDive 前置：文献若绑定 knowledge_doc（指纹匹配）→ 取全文分块做 map-reduce 摘要，无全文才降级摘要 800 字 | 「深度精读」有全文时输出含章节级分析 |
| EMBEDDING 维度迁移 | database.ts 读 `EMBEDDING_DIM`（默认384）建 vec0 表；维度变更时检测不匹配→建新表+后台重嵌入任务 | 换 768 维模型自动迁移不丢检索 |
| Runner 隔离 | experiments 沙箱增加并发上限(1)+磁盘配额检查 | 连续 10 次 run 无资源泄漏 |

### 4.2 Web（React 19 + Vite）

| 项 | 方案 | 验收 |
|---|---|---|
| 懒加载纵深 | 路由级已有；组件级补：ForceGraph/Streamdown/表格虚拟化全部 `React.lazy`+Suspense；KnowledgePage 图谱进页面才加载 d3-force | 首屏 JS ≤ 当前值 -30% |
| 大表虚拟化 | LiteratureTable 1000+ 行接 `@tanstack/react-virtual`；抽取矩阵动态列渲染 memo 化 | 5000 文献滚动 60fps |
| 对话持久化 | 线程落 server（新表 `chat_thread`：projectId/messages JSON/updatedAt）；localStorage 降级为草稿缓存 | 换设备登录后线程不丢 |
| 网搜设置页 | SettingsPage 加 WebSearch 区块：provider 单选 + SearXNG URL + 三个 Key 输入（掩码回显）+ chat 开关；调用 §4.1 的 GET/PUT /api/web/config | 配置即存即生效无重启 |
| 错误显式化 | 治理 `.catch(() => setX([]))`：空态与错误态分离，统一 `<ErrorBox retry>` 组件 | 任一接口 500 用户能看到重试按钮 |
| 编辑器升级 | WritingPage 拆分（1312 行→ WritingEditor/Panel/Toolbar 四组件）；表格 md→docx 导出（docx Table API 替代 mdToPlain 删表行为） | docx 导出保留表格 |

### 4.3 Desktop（Electron）

| 项 | 方案 | 验收 |
|---|---|---|
| 自动更新 | electron-updater + GitHub Releases channel（stable/beta）；差分更新 | 断网可跳过，更新后版本号正确 |
| 托盘常驻 | Tray + 后台流水线通知（完成/回炉时系统通知） | 最小化到托盘不丢任务 |
| 打包瘦身 | asar + 独占 exclude devDeps；双格式 NSIS/deb | 安装包 ≤ 180MB |

### 4.4 CLI

| 项 | 方案 | 验收 |
|---|---|---|
| fetch 重构（修W76） | 删 spawnSync node -e，改原生 `fetch`（Node≥20 内置）；错误透出 HTTP 状态码 | `sciflow health` 冷启动 <500ms |
| headless 流水线 | `sciflow pipeline run --topic "..." --watch`：SSE 转发步骤事件到 stdout，完成自动导出 md | 脚本可无人值守出稿 |
| 输出格式 | 全命令支持 `--json`（机器可读）/人读双模式 | jq 可直接消费 |

### 4.5 MCP

工具面扩容：`web.search`（当前 provider）、`experiments.list/read`（只读）、`literature.import`（BibTeX 字符串入参）。Guardrail 沿用：外部内容 untrusted hint。

---

## 5. 横切优化策略（全端适用）

| 策略 | 落点 | 预期收益 |
|---|---|---|
| **懒加载三层** | 路由级(已有)/组件级/数据级（React Query select 惰性派生） | 首屏 -30% JS |
| **虚拟滚动** | 文献表/知识库列表/对话线程(>200条) | 万级数据 60fps |
| **嵌入批处理+去重** | fingerprint 命中跳过重嵌入；p-limit(2) 队列 | 重复上传 0 成本 |
| **LLM 成本预算器** | llm_call_log 聚合 → 项目/日预算阈值告警（80%/100%） | 账单可控可预期 |
| **模型分级路由** | fast/strong 已有；补「strong 调用白名单」防误用 | 成本 -40% |
| **缓存三件套** | 网搜 2h(已有)/模型列表 5min(已有)/嵌入向量永久(已有) | 重复查询零成本 |
| **SSE 心跳** | 流式响应 15s 心跳帧防代理断连 | 长任务不再假死 |
| **SQLite 调优** | busy_timeout(已有)+定期 `PRAGMA optimize`+journal_size 上限 | GB 级库不劣化 |
| **镜像端零构建** | 4 镜像仓只存源码，CI 产物(文档站/dist)仅主仓 | 镜像 push <10s |

---

## 6. 数据与检索深度改造

### 6.1 文献获取：开源聚合（合规姿势）
**原则：不内置任何国外云服务；用户自开、自填、自管。** 提供 `integrations/scholar/` 适配层：
- `arxiv`（arXiv API，用户填邮箱即合规）、`openalex`（CC0 零门槛）、`semantic-scholar`（免费档 100 req/5min）、`crossref`（DOI 元数据核验）
- 设置页逐源开关（默认全关），开启即显示来源标签与限流额度
- 抓取结果**只进本地库**，带 `source` 字段可溯源可删除

### 6.2 检索质量升级
- **重排序**：混合召回(ANN top50 + BM25 top50) → 轻量重排（TF-IDF 共现 + 标题精确命中加权，零外部依赖版 bge-reranker 可选）
- **HyDE**：无命中查询先让 fast 模型生成假设性文档再检索（开关默认关）
- **块级上下文**：`context` 前缀从文档名升级为「文档名 + 所属章节标题 + 前200字摘要」（对齐 Anthropic Contextual Retrieval 的轻量版）
- **query 扩展**：中文查询自动拼英文同义词（fast 模型一次性生成，缓存）

### 6.3 引用闭环（对 F1 幻觉引用的正面回答）
1. 起草 prompt 硬约束 `[Ref:N]` 只能引用 prompt 提供的池（已有）
2. **渲染期核验**：CitationRenderer 逐条校验 referenceId 存在性；池外引用渲染为 `⚠️[未核验: 原文]` 并写入 reviewComments
3. **DOI 核验**（可选开关）：Crossref API 批量验证 DOI 真实性，不匹配标红
4. 导出前「引用体检」面板：总数/池内/池外/无 DOI 四色统计

### 6.4 多样性引擎（对 F2 同质化的正面回答）
- 大纲生成强制三视角：主流范式 / 反共识观点 / 跨学科方法（prompt 三个并行调用，fast 模型，成本可控）
- 章节起草时检索池按「引用数最少但高相关」补 20% 名额（反头部偏向）
- 输出「同质化体检」：与库内已有文档的 n-gram 重合度报告

### 6.5 实验设计助手（对 F3/F5）
- `experiments` 新增 design 模式：样本量计算（statsmodels 预置模板）、对照组随机化表生成、预注册格式导出（OSF 模板 md）
- 沙箱挂载用户数据集（`--data path`，只读 bind），AI 分析真实数据时自动在结论标注「基于用户数据，非模型生成」

---

## 7. 多平台工程与 CI/CD

- **主仓/镜像定案**：GitHub/badhope 唯一开发主仓；Gitee/GitCode/X33834/Morningstar 全部只读镜像（force push 同步）
- **镜像自动化**：`.github/workflows/mirror.yml`（已落地）——push main/tags → 4 端 force push，secrets 四枚（MIRROR_GITEE_TOKEN / MIRROR_GITCODE_TOKEN / MIRROR_X33834_TOKEN / MIRROR_MORNINGSTAR_TOKEN），未配置自动跳过、单端失败不影响他端
- **发布流**：tag → ci.yml 构建 → GitHub Release 挂桌面安装包 + 文档站 pages；镜像仓零构建零产物
- **主干纪律**：main 保护（CI 绿才合）；feature 分支 ≤2 天合入；CHANGELOG 每版必更

## 8. 文档体系

| 文档 | 定位 | 状态 |
|---|---|---|
| README.md | 30 秒看懂 + 5 分钟跑通 + 界面实拍 | 保持 |
| docs/CONFIGURATION.md | 场景化配置指南（按意图组织非参数罗列） | ✅ 本轮落地 |
| docs/master-plan.md | 本文档：唯一计划真理源 | ✅ 本轮落地 |
| ARCHITECTURE.md | 架构决策（唯一架构真理源） | 保持，模块化迁移时回写 |
| CONTRIBUTING.md | 重写：模块化包结构 + 迁移纪律 + PR 模板 | 🔨 |
| docs/TUTORIAL.md | 15 分钟全流程教程（真实案例走一遍） | 🔨 v0.6 前 |

## 9. 风险登记册

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 国外学术源 API 政策变动/墙 | 高 | §6.1 功能不可用 | 全源可关；缓存落本地；镜像源可配 |
| token 泄露/误提交 | 中 | 高 | .env 不入库(已)；GitHub secret 扫描；泄露即吊销 |
| SQLite 并发写锁（流水线+用户同时写） | 中 | 中 | WAL 已开；写操作包事务；长事务拆分 |
| node-llama-cpp 平台兼容 | 中 | 低 | 降级链完整（本轮加固）；CI 覆盖 win/linux |
| 成本失控（回炉循环+并发） | 中 | 中 | H5 互斥 + 预算器 + RPM cap 三层闸 |
| 模块化迁移引入回归 | 中 | 高 | 每包独立 vitest + 黑盒回归 161 项兜底 + 小步 PR |
| Electron 签名/公证被拒 | 低 | 低 | 先发未签名+文档说明，mac 公证后置 |
| 上游依赖 breaking（pnpm/AI SDK/LangGraph） | 高 | 中 | pnpm-lock 冻结 + minimumReleaseAge + dependabot 跨 major 阻断（已有） |

## 10. 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| **M1 正确性**（~1 周） | H1-H8 全修 + 网搜 provider(✅本轮) + 零内置改造(✅本轮) | 黑盒回归 161 项全绿 + typecheck/build 绿 |
| **M2 检索与引用**（~2 周） | §6.2 重排序/HyDE + §6.3 引用闭环 + §6.1 学术源聚合 | 引用体检面板 0 红牌；三种源可开关 |
| **M3 模块化**（~3 周） | packages/core+db+ai+retrieval 迁移完成 | 每包独立测试绿；server 瘦身 40% |
| **M4 全端体验**（~2 周） | 前端懒加载/虚拟化/持久化 + desktop 自动更新 + CLI headless | 首屏 -30%；换设备线程不丢；无人值守出稿 |

## 11. 本轮已落地（2026-10-17）

- ✅ **零内置原则**：嵌入模型自动下载移除（`EMBEDDING_MODEL_PATH` 用户自备，不配自动降级 BM25）；默认模型名/占位模型列表清空
- ✅ **网搜可插拔**：duckduckgo/searxng/tavily/serper/brave 五 provider + 配置 API（掩码回显）+ chat 兜底接入（默认关）+ 缓存复用
- ✅ **镜像自动化**：mirror.yml 四端同步工作流（secrets 就绪即生效）
- ✅ **配置文档**：docs/CONFIGURATION.md 场景化重写
