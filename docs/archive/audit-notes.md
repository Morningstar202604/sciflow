# SciFlow 深度审计工作笔记（2026-10-17）

> 逐文件阅读记录 + 问题清单。最终报告汇总处：#汇总报告。

## 阅读进度

- [ ] server 入口 main.ts / app.module.ts
- [ ] db/（schema 475L + database 578L）
- [ ] ai/（transport 408 + service 423 + prompts 394 + mock-gateway 239）
- [ ] pipeline/（graph 344 + service 357 + state + citation-renderer 138）
- [ ] research/（service 217 + submission 369 + quality 128）
- [ ] knowledge/（service 412 + embedding 125）
- [ ] chat/ memory/ websearch/ experiments/ references/ documents/ judgment/ dashboard/ settings/ mcp/ auth/ agent/ common/ cli
- [ ] apps/web 全部（60 文件）
- [ ] apps/desktop（11 文件）
- [ ] scripts/ e2e/ evals/ docker/ CI
- [ ] 竞品调研
- [ ] 商业分析

## 发现的问题（随时追加）

### ⚠️ 重大工具教训（非项目问题）
- 显示层吃字符：Bash 输出经会话显示层时可能丢失 `[x` 等字符模式（观测：`[history`→`istory`、`[mobilePanel`→`[obilePanel`），导致误判 WritingPage.tsx 有语法错误。**用 md5/node 进程内 AST/lexer 判定，勿信显示层**。WritingPage.tsx 实际完好，CI 全绿属实。

## 架构理解笔记

（待填）

## server 深读

### main.ts (92L) ✅
- 启动闸：非回环 HOST 必须 AUTH_MODE=jwt（或 ALLOW_INSECURE_BIND=1 显式冒险）
- dotenv 显式加载 apps/server/.env（修过根目录启动漏读坑）
- unhandledRejection/uncaughtException 兜底不退出；优雅关闭 SIGTERM/SIGINT
- 启动后 resumeInterrupted() 恢复 running 任务；helmet(CSP off)；CORS 白名单 5173；Swagger /api/docs
### app.module.ts (65L) ✅
- pino 日志；Throttler 60 req/min 全局；18 业务模块

### db/schema.ts (475L, 24表) ✅
- 广度覆盖科研全生命周期：project/document/reference/citation/quality_report/pipeline_task/polish_record/knowledge_doc+chunk/reflexion_log/memory_log/model_provider/mcp_server/custom_intent/pipeline_config/app_setting/custom_prompt/llm_call_log/screening_queue/extraction_field+value/review_comment/journal/submission+status_event/experiment/user/agent_execution+step/web_search_cache/chat_session
- 好的实践：期刊指标 NULL 不编造；append-only 状态流水+缓存冗余；agent 执行轨迹逐步骤记录

### 疑点（数据层）
- W4(中)：全部关联为裸 text id，无 FK 约束，级联删除靠 service 手写 → 孤儿行风险（待验证 database.ts cascade）
- W5(中)：document.versions 存 JSON 全量快照，无 pruning → 长文多版本 DB 膨胀
- W6(架构)：JSON 字符串字段遍布（steps/trace/versions/scores...）——SQLite 单文件可接受但不可 SQL 查询
- W7(定位)：单用户产品却有 user/role/admin/企业认证——本地单用户 vs 企业多用户定位摇摆（商业分析要点）
- W8(核心差距)：references.source 注释"已移除国外在线源"——无 Semantic Scholar/OpenAlex/CrossRef 集成，citationCount 永远 0；文献导入只能手动。科研工具核心能力缺失（对竞品 Elicit/Consensus 是立身之本）
- W9(待验证)：FTS5 虚拟表在 database.ts 原生 SQL 建（drizzle 不管），待确认；knowledgeChunks.vector 是自造 TF JSON + embedding sqlite-vec 双轨

### 疑点
- W1(低)：main.ts 用 console.*，自家守则禁裸 console（启动期可辩护）
- W2(中)：uncaughtException 兜底后继续跑，Node 建议退出——状态损坏风险
- W3(待验证)：全局 60 req/min vs 前端轮询/SSE 并发，本地单人可能被自家限流卡？
