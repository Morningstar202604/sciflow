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
  /** 分章起草（服务层实现，内部并行；onProgress 用于逐节进度通知）。 */
  runDrafting(
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
        const draftContent = await deps.runDrafting(doc.title || task.topic, outline, refsPrompt, styleHint, reflexion, (done, total) => {
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
        await deps.notify(s.taskId, 'quality-gate', 'scored', `总分 ${report.totalScore}/100`);
        if (report.totalScore < QUALITY_THRESHOLD && retry < MAX_RETRY) {
          retry += 1;
          db.insert(reflexionLogs)
            .values({ id: randomUUID(), taskId: s.taskId, round: retry, note: report.feedback, instructions: '[]', createdAt: Date.now() })
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
      const refIdx = content.indexOf('\n\n## 参考文献');
      const figIdx = content.indexOf('\n\n## 图表');
      const cuts = [refIdx, figIdx].filter((i) => i >= 0);
      const cut = cuts.length ? Math.min(...cuts) : -1;
      const bodyPart = cut >= 0 ? content.slice(0, cut) : content;
      const tailPart = cut >= 0 ? content.slice(cut) : '';
      const polished = await deps.ai.polish(bodyPart);
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
