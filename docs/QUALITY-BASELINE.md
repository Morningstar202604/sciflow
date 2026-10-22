# 质量基线看板（Quality Baseline）

> 数据来源：本机 2026-10-22 实测（`@vitest/coverage-v8`）。**所有数字为原始输出，未四舍五入美化。**
> 红线来自项目自定的工程标准（覆盖率 ≥90%/核心 ≥80%、分支 ≥85%、变异 ≥80%、圈复杂度 ≤10）。

## 1. 当前实测值

| 指标 | server | web | 红线 | 判定 |
|---|---|---|---|---|
| 行覆盖率 | **27.65%** | **42.10%** | ≥80%（核心域）/ ≥90% | ❌ 不通过 |
| 分支覆盖率 | **13.70%** | **38.12%** | ≥85% | ❌ 不通过 |
| 函数覆盖率 | 29.90% | 23.16% | — | ❌ 不通过 |
| 用例数 | 88（13 文件） | 57（8 文件） | — | — |
| 圈复杂度 >10 的函数 | **36 处**（server） | **46 处**（web） | ≤10 | ❌ 不通过 |
| 技术债务 / 重复率 | [未确认] | [未确认] | ≤5% / <3% | 需 SonarQube 或等价工具 |
| Critical/High 漏洞数 | [未确认]（SCA 不可用） | 同 | 0 | 见 SECURITY.md §3 |
| 变异分数 | 61%（审计样本 23 例） | 未测 | ≥80% | ❌ 不通过（样本法） |

### 覆盖率的真实结构（不是「全都很低」，而是严重不均衡）

| 模块 | 行覆盖 | 说明 |
|---|---|---|
| `packages/ai`（mock 网关） | 100% | 测试充分 |
| `auth`（守卫 + 服务） | 94.44% | 本轮新增行为测试 |
| `chat`（会话摘要） | 96.29% | 良好 |
| `common`（fingerprint / json-guard / outbound-guard） | 83.33% | 良好 |
| `documents`（服务层） | **18.90%** | 558 行核心逻辑，仅测了导出/格式化的边角 |
| `pipeline`（编排图） | **27.98%** | `pipeline.graph.ts` 仅 8.6%（441 行核心编排） |
| `references`（服务层） | **11.81%** | 700+ 行，几乎未测 |

web 侧：`stream-accumulator` / `client` 100%，`core.ts` 83%（SSE 解析有测试），但 `platform.ts` / `research.ts` / `writing.ts` 均 <10%（薄封装，风险相对低），页面级 `WorkspacePage` 45.9%。

**结论**：覆盖率不达标集中在「业务编排层」（pipeline/documents/references），不是「全项目没测」。

## 2. 圈复杂度超限（Top 20，均为实测）

| 文件:行 | 函数 | 复杂度 |
|---|---|---|
| `apps/server/src/pipeline/pipeline.graph.ts:159` | 起草阶段箭头函数 | **41** |
| `apps/server/src/common/sse.helper.ts:35` | `forwardOpenAiSse` | **39** |
| `apps/server/src/chat/chat.service.ts:71` | `contextFor` | **38** |
| `apps/web/src/api/core.ts:203` | `streamChat` 解析 | **35** |
| `apps/web/src/api/core.ts:97` | `request` | **32** |
| `apps/web/src/pages/DashboardPage.tsx:12` | `DashboardPage` | **29** |
| `apps/web/src/App.tsx:167` | `AppInner` | 26 |
| `apps/web/src/pages/ChatPage.tsx:526` | 消息渲染箭头 | 26 |
| `apps/server/src/documents/documents.service.ts:158` | `renderCitations` | 22 |
| `apps/server/src/documents/documents.service.ts:420` | `citationAudit` | 21 |
| `apps/web/src/pages/ChatPage.tsx:63` | `ChatPage` | 21 |
| `apps/server/src/references/references.service.ts:81` | `verifyDoi` | 23 |
| `apps/server/src/pipeline/pipeline.service.ts:320` | `crossEnrichResearch` | 20 |
| `apps/web/src/pages/DocExporter.tsx:178` | `blockWalk` | 20 |
| 其余 22 处 | — | 11–19 |

**判定**：不通过。但这些函数多为「状态机式长函数」，拆分需谨慎（拆分本身会引入回归），因此列为 P2 技术债，不阻塞发布。

## 3. 测试有效性（比覆盖率更重要）

已验证有效的（突变测试实测捕获）：

| 突变 | 被哪条测试捕获 |
|---|---|
| `jwt-auth.guard` 恒 `return true` | `jwt-auth.guard.spec.ts` 4 条 |
| `exportMarkdown` 返回空串 | 回归「文档导出（内容非空且含标题）」 |
| `downsampleIndices` 只取前 N | `projection.spec.ts` 端点断言 |
| 删 `references` 级联 | `projects-cascade-full.spec.ts` |
| Donut 色槽位移 | `charts.test.tsx` `donutCellColors` |
| 引用回填只写 2 条 | `citation-renderer.spec.ts` 精确行数断言 |
| `listSummaries` 排序反转 | `chat-session.service.spec.ts` |
| 只认 `[n]` 锚点 | 回归 27.4 |

仍然存在的测试缺口（诚实清单）：

1. `pipeline.graph.ts`（441 行）无单测，只有 mock 端到端回归覆盖 happy path。
2. `references.service.ts` / `documents.service.ts` 服务层大量分支未测。
3. 前端 11 个页面中 10 个无组件测试（只有 WorkspacePage）。
4. `evals/promptfooconfig.yaml` 是 mock 自证（provider 指向本地 mock 网关），无法证明真实模型质量。
5. 无变异测试工具接入（当前变异结论来自人工抽样 23 例）。

## 4. 复现命令

```bash
# 覆盖率（需先 pnpm add -D -w @vitest/coverage-v8）
pnpm --filter @sciflow/server exec vitest run --coverage
pnpm --filter @sciflow/web exec vitest run --coverage

# 圈复杂度
npx eslint apps/server/src --rule '{"complexity":["error",10]}'
npx eslint apps/web/src --rule '{"complexity":["error",10]}'

# 技术债务/重复率（未接入，需 SonarQube）
```
