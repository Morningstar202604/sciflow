import { Annotation, START, END, StateGraph, interrupt } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, sqlite } from '../db/database';
import { pipelineTasks, documents, reflexionLogs, memoryLogs, polishRecords, qualityReports } from '../db/schema';
import type { Outline, PaperHit, QualityReport, ResearchPlan, ResearchTraceEntry, PipelineTaskRow } from './pipeline-state';

/**
 * 主流水线图（LangGraph）：
 *   topic-verify → literature → outline → outline-gate(interrupt 人工确认) → doc-create
 *   → quality-gate(Reflexion 回炉循环) → polish → citation-format → complete
 *
 * 设计要点：
 * - 人工确认 = LangGraph `interrupt()`（checkpoint 持久化）；恢复用 `Command({ resume })`。
 *   outline 节点在 interrupt 前完成生成与状态通知；gate 节点体仅 interrupt() 调用，
 *   resume 重放零副作用、零重复 LLM 调用。
 * - 断点续跑 = checkpointer 重放；服务层 `resumeInterrupted` 用 `invoke(null, cfg)` 续跑。
 * - 起草并行 = 服务层 `runDrafting` 内 p-limit 并行（节点内并发，避免 Send 的整图编排复杂度）。
 */

export const PipelineAnnotation = Annotation.Root({
  taskId: Annotation<string>,
  task: Annotation<PipelineTaskRow>,
  verifiedTopic: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  plan: Annotation<ResearchPlan>({ reducer: (_a, b) => b, default: () => ({}) }),
  researchTrace: Annotation<ResearchTraceEntry[]>({ reducer: (_a, b) => b, default: () => [] }),
  enrichedLibHits: Annotation<PaperHit[]>({ reducer: (_a, b) => b, default: () => [] }),
  enrichedKnHits: Annotation<PaperHit[]>({ reducer: (_a, b) => b, default: () => [] }),
  researchNotice: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  literatureSummary: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  outline: Annotation<Outline | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  documentId: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  report: Annotation<QualityReport | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
});

export type PipelineGraphState = typeof PipelineAnnotation.State;

export type StepStatusWire = 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'scored' | 'retry' | 'failed' | 'skipped';

export interface PipelineGraphDeps {
  ai: {
    summarizeLiterature(topic: string, papers: string): Promise<string>;
    writeOutline(topic: string, summary: string): Promise<Outline>;
    /** Planner：产出多语检索关键词（失败时由实现方兜底 [topic]） */
    planResearch(topic: string): Promise<{ keywords: string[] }>;
    reviewPaper(title: string, content: string): Promise<{ totalScore: number; feedback: string; scores?: Record<string, number> }>;
    polish(text: string): Promise<{ original: string; polished: string; reason: string }>;
    extractEpisodic(p: string, t: string, o: string, s: number): Promise<{ content: string; keywords: string[] }>;
    generateFigures(topic: string, outline: string, content: string): Promise<{ title: string; caption: string; mermaid: string }[]>;
  };
  /** H2 预算器：LLM 调用后累计该任务 token，超限抛错终止流水线 */
  trackBudget(taskId: string): void;
  /** 分章起草（服务层实现，内部并行；onProgress 用于逐节进度通知）。 */
  runDrafting(
    taskId: string,
    title: string,
    outline: Outline,
    refsPrompt: string,
    styleHint: string,
    reflexion: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string>;
  /** 文献库 → prompt 引用串。 */
  buildRefsPrompt(projectId: string): string;
  /** 引用锚点渲染（citation-js CSL）：正文 [n] 锚点 + 文末参考文献块。 */
  renderCitations(projectId: string, docId: string, content: string, meta: { lib: { title: string; score: number }[]; kn: PaperHit[] }): string;
  /** 跨库检索增强（文献 + 知识库）。 */
  crossEnrich(
    projectId: string,
    topic: string,
    plan: ResearchPlan,
  ): Promise<{ libraryHits: PaperHit[]; knowledgeHits: PaperHit[]; notice: string | null; meta: { lib: { title: string; score: number }[]; kn: PaperHit[] }; summary: string }>;
  /** 每步状态落库（保持 pipeline_task.steps JSON 前端契约不变）。 */
  notify(taskId: string, key: string, status: StepStatusWire, output?: string, retryCount?: number): Promise<void>;
  /** 步骤开关。 */
  stepEnabled(key: string): boolean;
  logger: { log(m: string): void; warn(m: string): void; error(m: string): void };
}

const MAX_RETRY = 2;
const QUALITY_THRESHOLD = 80;

export function buildPipelineGraph(deps: PipelineGraphDeps) {
  const graph = new StateGraph(PipelineAnnotation)
    .addNode('topic-verify', async (s: PipelineGraphState) => {
      await deps.notify(s.taskId, 'topic-verify', 'running');
      const planned = await deps.ai.planResearch(s.task.topic);
      const keywords = planned.keywords.length ? planned.keywords : [s.task.topic];
      await deps.notify(s.taskId, 'topic-verify', 'done', `检索词：${keywords.slice(0, 4).join(' / ')}`);
      return { verifiedTopic: s.task.topic, plan: { searchStrategy: { keywords } } };
    })
    .addNode('literature', async (s: PipelineGraphState) => {
      if (!deps.stepEnabled('literature')) {
        await deps.notify(s.taskId, 'literature', 'running');
        await deps.notify(s.taskId, 'literature', 'skipped', '用户已禁用文献调研');
        return { researchNotice: '用户已禁用文献调研' };
      }
      await deps.notify(s.taskId, 'literature', 'running');
      const enriched = await deps.crossEnrich(s.task.projectId, s.task.topic, s.plan);
      db.update(pipelineTasks)
        .set({ researchNotice: enriched.notice, researchMeta: JSON.stringify(enriched.meta), updatedAt: Date.now() })
        .where(eq(pipelineTasks.id, s.taskId))
        .run();
      await deps.notify(s.taskId, 'literature', 'done', enriched.summary.split('\n')[0]);
      return {
        enrichedLibHits: enriched.libraryHits,
        enrichedKnHits: enriched.knowledgeHits,
        researchNotice: enriched.notice ?? undefined,
        literatureSummary: enriched.summary,
      };
    })
    .addNode('outline-gen', async (s: PipelineGraphState) => {
      await deps.notify(s.taskId, 'outline', 'running');
      const outline = await deps.ai.writeOutline(s.verifiedTopic || s.task.topic, s.literatureSummary);
      const wire = JSON.stringify(outline);
      if (!deps.stepEnabled('outline')) {
        await deps.notify(s.taskId, 'outline', 'done', wire);
      } else {
        await deps.notify(s.taskId, 'outline', 'awaiting_confirmation', wire);
      }
      return { outline };
    })
    .addNode('outline-gate', async (s: PipelineGraphState) => {
      // 节点体只有 interrupt：resume 重放零副作用
      if (!deps.stepEnabled('outline')) return {};
      const resume = interrupt({ outline: JSON.stringify(s.outline ?? {}) }) as { edited?: Outline } | undefined;
      return resume?.edited ? { outline: resume.edited } : {};
    })
    .addNode('doc-create', async (s: PipelineGraphState) => {
      const live = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, s.taskId)).get();
      let docId = live?.documentId || undefined;
      if (!docId) {
        const outline = s.outline ?? { title: s.task.topic, sections: [] };
        const now = Date.now();
        const doc = {
          id: randomUUID(),
          projectId: s.task.projectId,
          title: outline.title || s.task.topic,
          content: '',
          outline: JSON.stringify(outline),
          version: 1,
          versions: '[]',
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };
        db.insert(documents).values(doc).run();
        db.update(pipelineTasks).set({ documentId: doc.id, updatedAt: now }).where(eq(pipelineTasks.id, s.taskId)).run();
        docId = doc.id;
      }
      await deps.notify(s.taskId, 'outline', 'done', JSON.stringify(s.outline ?? {}));
      return { documentId: docId };
    })
    .addNode('quality-gate', async (s: PipelineGraphState) => {
      const docId = s.documentId!;
      // 重读活行：researchMeta/researchNotice 由 literature 节点在本次调用中写入，
      // 图状态里的 task 是最初快照（无这些字段），必须取库内最新值
      const task = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, s.taskId)).get() ?? s.task;
      const doc = db.select().from(documents).where(eq(documents.id, docId)).get()!;
      const outline = JSON.parse(doc.outline || '{}') as Outline;
      const researchMeta = parseResearchMeta(task.researchMeta);
      let retry = 0;
      let report: QualityReport | undefined;
      let best: { score: number; content: string; feedback: string } = { score: -1, content: '', feedback: '' };

      while (true) {
        await deps.notify(s.taskId, 'quality-gate', 'running', retry > 0 ? `第 ${retry} 次回炉起草` : undefined, retry);
        const reflexion = reflexionNote(s.taskId);
        const procedural = proceduralMemory(task.projectId);
        const styleHint = procedural ? `\n写作风格参考（来自记忆库）：${procedural}` : '';
        const refsPrompt = deps.buildRefsPrompt(task.projectId);
        if (retry === 0) snapshotBeforeOverwrite(docId, '流水线起草前自动快照');
        const totalSections = outline.sections?.length || 0;
        const draftContent = await deps.runDrafting(s.taskId, doc.title || task.topic, outline, refsPrompt, styleHint, reflexion, (done, total) => {
          void deps.notify(s.taskId, 'quality-gate', 'running', `起草进度 ${done}/${total} 节${retry > 0 ? `（第 ${retry} 次回炉）` : ''}`, retry);
        });
        void totalSections;
        let prevFigures = '';
        if (retry > 0) {
          const prev = db.select().from(documents).where(eq(documents.id, docId)).get();
          const m = (prev?.content || '').match(/## 图表[\s\S]*?$/);
          if (m) prevFigures = `\n\n---\n\n${m[0]}`;
        }
        const rendered = deps.renderCitations(task.projectId, docId, draftContent, researchMeta);
        let finalContent = rendered + prevFigures;
        if (retry === 0 && deps.stepEnabled('figures')) {
          try {
            const figs = await deps.ai.generateFigures(task.topic, JSON.stringify(outline), rendered);
            if (figs.length > 0) {
              const figBlock = figs.map((f) => `### ${f.title}\n\n> ${f.caption}\n\n\n\`\`\`mermaid\n${f.mermaid}\n\`\`\``).join('\n\n');
              finalContent = `${rendered}\n\n---\n\n## 图表\n\n${figBlock}`;
            }
          } catch (e: any) {
            deps.logger.warn(`自动配图失败: ${e.message}`);
          }
        }
        db.update(documents).set({ content: finalContent, updatedAt: Date.now() }).where(eq(documents.id, docId)).run();

        if (!deps.stepEnabled('quality-gate')) {
          report = { totalScore: 85, feedback: '质量门已禁用，跳过评分' };
          break;
        }
        const latest = db.select().from(documents).where(eq(documents.id, docId)).get();
        const reviewResult = await deps.ai.reviewPaper(doc.title || task.topic, latest?.content ?? '');
        report = { totalScore: reviewResult.totalScore, feedback: reviewResult.feedback };
        // 质量报告落库（每轮评分一行；GET /api/quality?documentId 历史可查）
        db.insert(qualityReports)
          .values({
            id: randomUUID(),
            documentId: docId,
            totalScore: report.totalScore,
            scores: JSON.stringify(reviewResult.scores ?? {}),
            feedback: report.feedback,
            createdAt: Date.now(),
          })
          .run();
        const scored = Number(report.totalScore);
        if (scored > best.score) best = { score: scored, content: latest?.content ?? '', feedback: report.feedback };
        deps.trackBudget(s.taskId); // H2：评审成本打点
        await deps.notify(s.taskId, 'quality-gate', 'scored', `总分 ${report.totalScore}/100`);
        if (report.totalScore < QUALITY_THRESHOLD && retry < MAX_RETRY) {
          retry += 1;
          const reflex = buildReflexionText(reviewResult.scores, report.feedback);
          db.insert(reflexionLogs)
            .values({ id: randomUUID(), taskId: s.taskId, round: retry, note: reflex.note, instructions: JSON.stringify(reflex.instructions), createdAt: Date.now() })
            .run();
          await deps.notify(s.taskId, 'quality-gate', 'retry', `第 ${retry} 次回炉（评分 ${report.totalScore} < ${QUALITY_THRESHOLD}）`, retry);
          continue;
        }
        break;
      }
      if (best.score >= 0 && best.content && (report?.totalScore ?? 0) < best.score) {
        db.update(documents).set({ content: best.content, updatedAt: Date.now() }).where(eq(documents.id, docId)).run();
        deps.logger.log(`[质量门] 采用最高分轮次 ${best.score} 分（末轮 ${report?.totalScore ?? '-'} 分）`);
        report = { totalScore: best.score, feedback: best.feedback };
      }
      await deps.notify(s.taskId, 'quality-gate', 'done', `总分 ${report.totalScore}/100`);
      return { report };
    })
    .addNode('polish', async (s: PipelineGraphState) => {
      await deps.notify(s.taskId, 'polish', 'running');
      const docId = s.documentId!;
      const finalDoc = db.select().from(documents).where(eq(documents.id, docId)).get();
      const content = finalDoc?.content ?? '';
      // H8 修复：尾部块（参考文献/图表）用正则匹配任意标题层级与换行变体，
      // 不再依赖字面量 '\n\n## 参考文献'（模型输出 '\n## 参考文献' 或 '## 参考文献列表' 时旧逻辑切不到，
      // 会导致参考文献被当作正文送润色，AI 有机会改写引文内容——学术诚信红线）。
      const tailRegex = /\n+#{1,3}\s*(参考文献|引用文献|图表|references)(?=[\s（(:：\-—]|$)[^\n]*/gi;
      let cut = -1;
      for (const m of content.matchAll(tailRegex)) {
        const idx = m.index ?? -1;
        if (idx >= 0 && (cut === -1 || idx < cut)) cut = idx; // 取最早出现的尾部标题
      }
      const bodyPart = cut >= 0 ? content.slice(0, cut) : content;
      const tailPart = cut >= 0 ? content.slice(cut) : '';
      const polished = await deps.ai.polish(bodyPart);
      deps.trackBudget(s.taskId); // H2：润色成本打点
      db.insert(polishRecords)
        .values({ id: randomUUID(), documentId: docId, type: 'polish', original: polished.original, polished: polished.polished, reason: polished.reason, createdAt: Date.now() })
        .run();
      const polishedText = String(polished.polished ?? '');
      const jsonLike =
        (polishedText.includes('"original"') && polishedText.includes('"polished"')) ||
        polishedText.includes('```json') ||
        (polishedText.trim().startsWith('{') && (polishedText.includes('"reason"') || polishedText.includes('"original"') || polishedText.includes('"polished"') || polishedText.includes('"content"')));
      const fallbackText = (jsonLike ? finalDoc?.content || '' : polishedText) + tailPart;
      db.update(documents).set({ content: fallbackText, status: 'polished', updatedAt: Date.now() }).where(eq(documents.id, docId)).run();
      await deps.notify(s.taskId, 'polish', 'done');
      return {};
    })
    .addNode('citation-format', async (s: PipelineGraphState) => {
      await deps.notify(s.taskId, 'citation-format', 'running');
      // 引用已在 quality-gate 渲染进正文；此处仅推进文档状态
      db.update(documents).set({ status: 'formatted', updatedAt: Date.now() }).where(eq(documents.id, s.documentId!)).run();
      await deps.notify(s.taskId, 'citation-format', 'done');
      return {};
    })
    .addNode('complete', async (s: PipelineGraphState) => {
      await deps.notify(s.taskId, 'complete', 'running');
      const docId = s.documentId!;
      db.update(documents).set({ status: 'final', updatedAt: Date.now() }).where(eq(documents.id, docId)).run();
      if (s.researchNotice) {
        const cur = db.select().from(documents).where(eq(documents.id, docId)).get();
        const body = cur?.content ?? '';
        if (!body.includes('研究阶段未在本地文献库')) {
          db.update(documents).set({ content: body + `\n\n---\n\n## 研究说明\n\n> ${s.researchNotice}\n`, updatedAt: Date.now() }).where(eq(documents.id, docId)).run();
        }
      }
      try {
        const finalMem = db.select().from(documents).where(eq(documents.id, docId)).get();
        const mem = await deps.ai.extractEpisodic(s.task.projectId, finalMem?.title || s.task.topic, finalMem?.outline || '[]', s.report?.totalScore ?? 80);
        if (mem.content) {
          db.insert(memoryLogs)
            .values({ id: randomUUID(), type: 'episodic', projectId: s.task.projectId, content: mem.content, keywords: JSON.stringify(mem.keywords), createdAt: Date.now() })
            .run();
        }
      } catch (e: any) {
        deps.logger.warn(`情景记忆沉淀失败: ${e.message}`);
      }
      await deps.notify(s.taskId, 'complete', 'done');
      return {};
    })
    .addEdge(START, 'topic-verify')
    .addEdge('topic-verify', 'literature')
    .addEdge('literature', 'outline-gen')
    .addEdge('outline-gen', 'outline-gate')
    .addEdge('outline-gate', 'doc-create')
    .addEdge('doc-create', 'quality-gate')
    .addEdge('quality-gate', 'polish')
    .addEdge('polish', 'citation-format')
    .addEdge('citation-format', 'complete')
    .addEdge('complete', END)
    .compile({ checkpointer: new SqliteSaver(sqlite as never) });

  return graph;
}

// ─── node 内部辅助（纯函数 / 直连 db 的域内工具） ─────────────

interface ResearchMeta { lib: { title: string; score: number }[]; kn: PaperHit[]; }

function parseResearchMeta(raw: string | null | undefined): ResearchMeta {
  try {
    const o = JSON.parse(raw || '{}') as ResearchMeta;
    return { lib: Array.isArray(o.lib) ? o.lib : [], kn: Array.isArray(o.kn) ? o.kn : [] };
  } catch {
    return { lib: [], kn: [] };
  }
}

/**
 * H1 修复：Reflexion 定向化——把评审结果转成「可执行的章节级修订指令」。
 * 旧实现只把 feedback 原文塞回下一轮（模型自查自改，改进信号弱）；
 * 现在按最低分维度从 REFLEXION_PLAYBOOK 取针对性动作 + feedback 摘要，
 * 写入 reflexionLogs.note 供下一轮起草 prompt 直接消费，instructions 字段同步落结构化 JSON。
 */
const REFLEXION_DIM_CN: Record<string, string> = {
  literature: '文献', logic: '逻辑', citation: '引用', language: '语言',
  novelty: '创新性', figures: '图表', format: '格式',
};
const REFLEXION_PLAYBOOK: Record<string, string> = {
  literature: '补强文献支撑：每个论点旁必须挂 [Ref:N] 锚点引用文献池中的真实文献，禁止凭空断言与编造引文',
  logic: '修复论证链：检查章节间承接与因果，消除逻辑跳跃，段落间补过渡句，结论不得超出论据范围',
  citation: '强化引用规范：事实性论断逐条挂 [Ref:N] 锚点，同一观点多源互证，消除孤证段落',
  language: '提升语言质量：删除冗余与口语化表达，统一术语译名，句式学术化，避免长句堆叠',
  novelty: '突出创新贡献：在引言与讨论中显式对比已有工作，明确本文差异点与增量贡献',
  figures: '改进图表：每个图表必须在正文被引用并解读，图题/轴标签/图例完整，内容与论述一致',
  format: '规范格式：统一标题层级、段落长度、公式编号、单位与缩写写法，段落首行不得孤句',
};
function buildReflexionText(scores: Record<string, number> | undefined, feedback: string): { note: string; instructions: string[] } {
  if (!scores || Object.keys(scores).length === 0) {
    return { note: `评审意见（本轮必须针对性改进）：${feedback.slice(0, 600)}`, instructions: [feedback.slice(0, 600)] };
  }
  const dims = Object.entries(scores)
    .filter(([, v]) => typeof v === 'number')
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2); // 最低分两维：改进信号最强
  const instructions = dims.map(([k, v]) => `【${REFLEXION_DIM_CN[k] || k} ${v}分】${REFLEXION_PLAYBOOK[k] || '按评审意见针对性修改'}`);
  const note = `针对性修订指令（本轮起草必须逐条落实）：\n${instructions.join('\n')}\n\n评审意见摘要：${feedback.slice(0, 400)}`;
  return { note, instructions };
}

function reflexionNote(taskId: string): string {
  const rows = db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, taskId)).all();
  if (rows.length === 0) return '';
  return rows[rows.length - 1].note;
}

function proceduralMemory(projectId: string): string {
  const rows = db.select().from(memoryLogs).where(eq(memoryLogs.type, 'procedural')).all();
  return rows.filter((r) => r.projectId === projectId).slice(-1).map((r) => r.content).join('');
}

/** 覆盖式写入前保存快照：自动流水线永不静默吃掉用户正文（版本历史上限 20） */
function snapshotBeforeOverwrite(docId: string, reason: string): void {
  const doc = db.select().from(documents).where(eq(documents.id, docId)).get();
  const body = doc?.content ?? '';
  if (!body.trim()) return;
  const versions = JSON.parse(doc?.versions || '[]') as { version: number; content: string; updatedAt: number; commitMessage?: string }[];
  const latest = versions[versions.length - 1];
  if (latest && latest.content === body) return;
  versions.push({ version: doc?.version ?? 1, content: body, updatedAt: Date.now(), commitMessage: `${reason} · ${new Date().toLocaleString('zh-CN')}` });
  db.update(documents).set({ versions: JSON.stringify(versions.slice(-20)), updatedAt: doc?.updatedAt ?? Date.now() }).where(eq(documents.id, docId)).run();
}

export { interrupt };
