# SciFlow 开发续接指南（HANDOFF）
> 归档：2026-10-18 · 基线 tag `v0.5.0` · 本文件是**新环境/新会话接手的唯一入口**。
> 通读本文档 + `docs/master-plan.md`（唯一计划真理源）+ `ARCHITECTURE.md`（架构真理源）后即可无缝续接。

---

## 1. 项目是什么

**SciFlow** = 本地优先、单机部署的科研全流程 AI 助手（文献→规划→大纲→分章起草→质量门→润色→引用→投稿）。
- 技术栈：pnpm monorepo · NestJS+SQLite(better-sqlite3/drizzle/sqlite-vec) · React19+Vite+Tailwind4 · Electron 桌面端 · CLI · MCP（官方 SDK）
- 零内置原则：**产品不自带任何模型/Key/云服务**，全部用户自备（AI_BASE_URL/AI_API_KEY/AI_MODEL 三件套起步）
- 仓库拓扑：**GitHub/badhope = 唯一主仓**；Gitee/GitCode/X33834/Morningstar202604 四端为手动镜像（`git push <remote> main --force` 归一，镜像端**禁止本地提交**——会分叉）

## 2. 新环境 5 分钟起步

```bash
git clone https://github.com/badhope/sciflow.git && cd sciflow
pnpm install --frozen-lockfile
# 原生模块补齐（--ignore-scripts 主装后）：
#   better-sqlite3 → cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3 && npx prebuild-install
#   electron      → 进包目录 ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node install.js
cp apps/server/.env.example apps/server/.env   # 填 AI 三件套
pnpm build && pnpm start                        # 或 pnpm dev（前后端并行）
```

**验证**：`/api/health` 200 → `SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py` 应 **PASS 165 / FAIL 0**。

## 3. 当前完成度（截至 v0.5.0）

| 里程碑 | 状态 | 内容 |
|---|---|---|
| M1 正确性 | ✅ | 审计 H1-H8 全修：Reflexion 定向回炉/并发互斥/SQL LIMIT/注入 800 字/尾部正则/预算器 300k |
| M2 检索与引用 | ✅ | RRF 双路融合（ANN+FTS5）/ citation-audit 引用体检 / 网搜五 provider / LLM 重排开关(默认off) / DOI 核验(Crossref) |
| M3 模块化 | ✅ | packages/{core,db,ai,retrieval} 物理拆分 + ESLint 依赖红线 + 桶过渡（统一编译模式贯穿） |
| 可视化 | 部分 | DAG 实时图(回炉回边)/成本仪表盘(byModel+预算卡)/引用体检面板 ✅；语义地图/引用网络增强待做 |
| 深度调研 | 文档齐 | 幻觉引用闭环(F1)/反同质化(F2)/实验设计(F3) 等机会已论证未实施 → master-plan §9 |

## 4. 下一步待办（按优先级）

1. **F-2.2 知识库语义地图**：嵌入 PCA/UMAP 投影聚簇 + 点选看块（annSearch 已有向量，前端投影用 umap-js/wasm）
2. **B-5.3 arXiv 镜像聚合**：opt-in 用户触发式（合规红线：不做启动链路依赖/不自动轮询）
3. **F-2.4 引用网络增强**：ForceGraph 已有雏形，加社区着色/搜索定位/重复边样式
4. **B-3.3 前端开关**：retrieval_rerank 已后端就绪，设置页缺开关
5. **generateObject 迁移评估**：AI SDK 已标 deprecated（ai-transport.service.ts）
6. 全部细节见 `docs/master-plan.md` §14 需求追溯矩阵（22 项）与各施工项编号

## 5. 踩坑清单（前人血泪，必读）

1. **JS 正则 `\b` 对中文永不匹配**（\w 不含汉字）——中文文本禁用 \b
2. **tsconfig include 收录外部源码会撑大 rootDir**（dist 结构变化连锁断启动脚本）——用 paths 拉入 import 图即可，rootDir 显式固化 `../..`
3. **tsc 增量缓存会掩盖 dist 未更新**——验证构建必须 `rm -rf dist *.tsbuildinfo` 重建
4. **dist 入口 = `dist/apps/server/src/main.js`**（不是 dist/main.js！scripts/Dockerfile/desktop 已同步）
5. **better-sqlite3 无 postinstall 产物需手动 prebuild-install**；electron 走 npmmirror
6. **回归必须全新库**（脏库指纹去重类 7 case 必挂）；脚本是基线守门员：新失败一律 FAIL 不许进 KNOWN_GAPS
7. **镜像端禁止本地提交**（分叉后只能 force 归一）
8. **documents POST 契约只收 title**，content 走 PATCH
9. CI workflow 已整体移除（用户决定）；分支保护要求 **commit 签名**——新环境需配置签名（gpg.format=ssh）或经管理员调整规则

## 6. 关键文档地图

| 文档 | 用途 |
|---|---|
| `docs/master-plan.md` | 开发主计划 v2（七视角框架/施工项编号/需求追溯矩阵 22 项） |
| `ARCHITECTURE.md` | 架构真理源（§2.9 模块化布局/§7 禁止造轮子守则） |
| `docs/CONFIGURATION.md` | 场景化配置指南（用户向） |
| `docs/audit-report.md` | 深度审计报告（H1-H8/W 系列问题溯源） |
| `docs/audit-notes.md` | 76 项原始疑点笔记（审计过程全记录） |
| `docs/product-roadmap.md` | 产品定位与合规红线（2026-09-30 决策依据） |
| `docs/enterprise-transformation-plan.md` | 桌面端封装方案（已落地，含踩坑记录） |
| `CHANGELOG.md` | 版本历史（v0.5.0 起含本轮全部变更） |
| `SECURITY.md` / `CONTRIBUTING.md` | 安全披露 / 贡献流程 |

## 7. 提交纪律

- 提交信息引用 master-plan 编号：`feat(B-3.2): ...`
- 主分支 `main` 要求**签名提交**（新环境先配 `git config gpg.format ssh` + 签名 key 并登记 GitHub ssh_signing_keys）
- 推送顺序：主仓 → 四镜像 force 归一
- 每个里程碑结束：跑 §2 七视角自查 + 更新 master-plan §14
