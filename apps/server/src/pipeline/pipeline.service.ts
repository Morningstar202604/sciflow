import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, documents, references, polishRecords, reflexionLogs, memoryLogs, pipelineConfigs, citations } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { ReferencesService, PaperHit } from '../references/references.service';
import { AgentOrchestratorService, ResearchPlan } from '../orchestrator/orchestrator.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { PipelineStep as DagPipelineStep, PipelineContext, AWAITING_CONFIRMATION, StepNotification, executeDAG } from './pipeline-steps';

const STEP_REGISTRY: Record<string, string> = { 'topic-verify': '主题验证', 'literature': '文献调研', 'outline': '大纲生成', 'drafting': '分章起草', 'quality-gate': '质量门评分', 'polish': '润色定稿', 'citation-format': '引用格式化', 'complete': '完成' };

export interface PipelineStepState {
  key: string; label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'retry' | 'failed' | 'skipped';
  output?: string; retryCount: number;
}

const STEPS: { key: string; label: string }[] = [
  { key: 'topic-verify', label: '主题验证' },
  { key: 'literature', label: '文献调研' },
  { key: 'outline', label: '大纲生成' },
  { key: 'quality-gate', label: '分章起草+质量门+回炉' },
  { key: 'polish', label: '润色定稿' },
  { key: 'citation-format', label: '引用格式化' },
  { key: 'complete', label: '完成' },
];

const MAX_RETRY = 2;
const QUALITY_THRESHOLD = 80;
const ZERO_HIT_NOTICE = '研究阶段未在本地文献库/知识库检索到相关条目，已依赖模型知识完成起草；建议到「文献调研」页添加相关文献（粘贴 DOI/导入 BibTeX）、检查关键词拼写，或在知识库上传资料后重新运行。';

interface ResearchMeta { lib: { title: string; score: number }[]; kn: PaperHit[]; }

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private running = new Set<string>();

  constructor(
    private readonly ai: AiService,
    private readonly references: ReferencesService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ─── 公开 API（controller 调用） ──────────────────────────────
  create(projectId: string, topic: string) {
    if (!topic.trim()) throw new BadRequestException('请先输入研究主题');
    if (!this.ai.configured) throw new BadRequestException('AI 服务未配置：请在 apps/server/.env 设置 AI_API_KEY 后再运行流水线');
    const now = Date.now();
    const task = {
      id: randomUUID(), projectId, documentId: null as string | null, topic: topic.trim(),
      currentStep: 'topic-verify', status: 'running',
      steps: JSON.stringify(STEPS.map((s) => ({ key: s.key, label: s.label, status: 'pending' as const, retryCount: 0 }))),
      retryCount: 0, lastError: '', createdAt: now, updatedAt: now,
    };
    db.insert(pipelineTasks).values(task).run();
    void this.runPreConfirmation(task.id);
    return this.get(task.id);
  }

  get(id: string) {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!row) throw new NotFoundException('流水线任务不存在');
    return { ...row, steps: JSON.parse(row.steps ?? '[]') as PipelineStepState[] };
  }

  listByProject(projectId: string) {
    return db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, projectId)).orderBy(pipelineTasks.createdAt);
  }

  remove(id: string) {
    this.get(id);
    db.delete(pipelineTasks).where(eq(pipelineTasks.id, id)).run();
    return { ok: true };
  }

  agentRuns(id: string) {
    this.get(id);
    return this.orchestrator.listRuns(id);
  }

  resumeInterrupted() {
    const rows = db.select().from(pipelineTasks).where(eq(pipelineTasks.status, 'running')).all();
    for (const t of rows) {
      if (t.documentId) {
        const steps = JSON.parse(t.steps || '[]') as PipelineStepState[];
        let resumed = false;
        for (const s of steps) {
          if (s.key === 'quality-gate') { s.status = 'running'; s.output = '服务重启后续跑（checkpoint 恢复）'; resumed = true; }
          else if (resumed) s.status = 'pending';
        }
        db.update(pipelineTasks).set({ steps: JSON.stringify(steps), status: 'running', currentStep: 'quality-gate', lastError: '', updatedAt: Date.now() }).where(eq(pipelineTasks.id, t.id)).run();
        this.logger.log(`[checkpoint] 任务 ${t.id} 断点续跑（从 drafting 恢复）`);
        void this.runPostConfirmation(t.id, t.documentId);
      } else {
        this.logger.warn(`[checkpoint] 任务 ${t.id} 中断于前半段（无产物文档），标记 interrupted`);
        this.setStatus(t.id, 'interrupted', '', '服务重启中断，前半段任务请删除后重新启动');
      }
    }
    return rows.length;
  }

  async confirmOutline(taskId: string, editedOutline?: { title: string; sections: { title: string; subsections: string[] }[] }) {
    const task = this.get(taskId);
    if (task.status !== 'awaiting_confirmation') throw new BadRequestException('当前不在大纲确认节点');
    const steps = task.steps;
    const outlineStep = steps.find((s) => s.key === 'outline')!;
    const outline = editedOutline || JSON.parse(outlineStep.output || '{}');
    const now = Date.now();
    const doc = { id: randomUUID(), projectId: task.projectId, title: outline.title || task.topic, content: '', outline: JSON.stringify(outline), version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now };
    db.insert(documents).values(doc).run();
    db.update(pipelineTasks).set({ documentId: doc.id, updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
    this.setStatus(taskId, 'running', 'quality-gate');
    void this.runPostConfirmation(taskId, doc.id);
    return this.get(taskId);
  }

  // ─── 状态机 ────────────────────────────────────────────────────
  private loadSteps(id: string): PipelineStepState[] {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    return JSON.parse(row?.steps || '[]') as PipelineStepState[];
  }

  private saveSteps(id: string, steps: PipelineStepState[]) {
    db.update(pipelineTasks).set({ steps: JSON.stringify(steps), updatedAt: Date.now() }).where(eq(pipelineTasks.id, id)).run();
  }

  private setStatus(id: string, status: string, currentStep = '', lastError = '') {
    db.update(pipelineTasks).set({ status, currentStep: currentStep || undefined, lastError: lastError || '', updatedAt: Date.now() }).where(eq(pipelineTasks.id, id)).run();
  }

  /** 由 DAG 调用的统一持久化回调 */
  private async notify(taskId: string, steps: PipelineStepState[], step: PipelineStep, n: StepNotification) {
    const s = steps.find((x) => x.key === step.key);
    if (!s) return;
    if (n.status === 'running') { s.status = 'running'; this.setStatus(taskId, 'running', step.key); }
    else if (n.status === 'done') { s.status = 'done'; 'output' in n && n.output !== undefined && (s.output = n.output); }
    else if (n.status === 'skipped') { s.status = 'skipped'; 'output' in n && n.output !== undefined && (s.output = n.output); }
    else if (n.status === 'failed') { s.status = 'failed'; 'error' in n && (s.output = n.error); this.setStatus(taskId, 'failed', step.key, n.error || ''); }
    else if (n.status === 'awaiting_confirmation') { s.status = 'awaiting_confirmation'; 'output' in n && n.output !== undefined && (s.output = n.output); this.setStatus(taskId, 'awaiting_confirmation', step.key); }
    this.saveSteps(taskId, steps);
  }

  private stepEnabled(key: string): boolean {
    try { const r = db.select().from(pipelineConfigs).where(eq(pipelineConfigs.stepKey, key)).get(); return !r || (r.enabled ?? 1) === 1; }
    catch { return true; }
  }

  // ─── DAG 定义 ──────────────────────────────────────────────────
  private buildPreConfirmationSteps(taskId: string): PipelineStep[] {
    const self = this;
    const notify = (step: PipelineStep, n: StepNotification) => {
      const steps = self.loadSteps(taskId);
      return self.notify(taskId, steps, step, n);
    };
    return [
      {
        key: 'topic-verify', label: '主题验证',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const { verifiedTopic, plan } = await self.orchestrator.plannerAgent(taskId, ctx.task.topic);
          return { verifiedTopic, plan };
        },
      },
      {
        key: 'literature', label: '文献调研',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('literature')) {
            db.update(pipelineTasks).set({ trace: '[]', updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
            return { researchNotice: ZERO_HIT_NOTICE, literatureSummary: '（用户已禁用文献调研，按通用学术结构起草）' };
          }
          const { hits, trace } = await self.orchestrator.researchAgents(taskId, ctx.task.topic, ctx.plan!);
          db.update(pipelineTasks).set({ trace: JSON.stringify(trace), updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
          const enriched = await self.crossEnrichResearch(ctx.task.projectId, ctx.task.topic, ctx.plan!, hits);
          db.update(pipelineTasks).set({ researchNotice: enriched.notice, researchMeta: JSON.stringify(enriched.meta), updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
          if (enriched.libraryHits.length > 0) self.references.importPipelineHits(ctx.task.projectId, enriched.libraryHits);
          const refs = self.references.list(ctx.task.projectId);
          const summary = refs.length
            ? await self.ai.summarizeLiterature(ctx.task.topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
            : '（未检索到文献，将按通用学术结构起草）';
          const totalFound = enriched.libraryHits.length + enriched.knowledgeHits.length;
          return { enrichedLibHits: enriched.libraryHits, enrichedKnHits: enriched.knowledgeHits, researchNotice: enriched.notice, literatureSummary: `跨库检索到 ${totalFound} 条（文献库 ${enriched.libraryHits.length} / 知识库 ${enriched.knowledgeHits.length}）\n${summary.slice(0, 500)}` };
        },
      },
      {
        key: 'outline', label: '大纲生成',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('outline')) {
            const outline = await self.ai.writeOutline(ctx.verifiedTopic!, ctx.literatureSummary!);
            return { outline };
          }
          const outline = await self.ai.writeOutline(ctx.verifiedTopic!, ctx.literatureSummary!);
          // human-in-the-loop flag: 抛出让 DAG 中断的错误，触发 awaiting_confirmation 持久化
          const err = new Error('awaiting confirmation') as any;
          err.cause = AWAITING_CONFIRMATION;
          (err as any)._outline = outline;
          throw err;
        },
      },
    ];
  }

  private buildPostConfirmationSteps(taskId: string): PipelineStep[] {
    const self = this;
    const notify = (step: PipelineStep, n: StepNotification) => {
      const steps = self.loadSteps(taskId);
      return self.notify(taskId, steps, step, n);
    };
    return [
      {
        key: 'quality-gate', label: '分章起草+质量门+回炉',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const task = self.get(taskId);
          const doc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get()!;
          const outline = JSON.parse(doc.outline || '[]') as { title: string; sections: { title: string; subsections: string[] }[] };
          const researchMeta = self.parseResearchMeta(task.researchMeta);
          const researchNotice = task.researchNotice?.trim() || null;
          const libScore = new Map(researchMeta.lib.map((l) => [l.title, l.score]));
          let retry = 0;
          const maxRetry = MAX_RETRY;
          let report: { totalScore: number; feedback: string } | undefined;
          let best: { score: number; content: string } = { score: -1, content: '' };

          while (true) {
            await self.advance(taskId, 'quality-gate', 'running', retry > 0 ? `第 ${retry} 次回炉起草` : undefined);
            const reflexion = self.reflexionNote(taskId);
            const procedural = self.proceduralMemory(task.projectId);
            const styleHint = procedural ? `\n写作风格参考（来自记忆库）：${procedural}` : '';
            const refPool = self.refsForDraft(task.projectId);
            const writerRes = await self.orchestrator.writerAgent(taskId, ctx.documentId!, doc.title, outline, { refsPrompt: self.referencesForPrompt(task.projectId, refPool), styleHint, reflexion }, { skipAgenticSearch: retry > 0 });
            let prevFigures = '';
            if (retry > 0) { const prev = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get(); const m = (prev?.content || '').match(/## 图表[\s\S]*?$/); if (m) prevFigures = `\n\n---\n\n${m[0]}`; }
            db.update(documents).set({ content: writerRes.content, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
            const agenticHits = self.orchestrator.extractWriterHits(taskId);
            const suppRefIds: (string | null)[] = agenticHits.map((h) => { try { const row = self.references.create(task.projectId, h); return row ? row.id : null; } catch { return null; } });
            const rendered = self.renderCitations(task.projectId, ctx.documentId!, writerRes.content, refPool, agenticHits, suppRefIds, libScore, researchMeta.kn);
            let finalContent = rendered + prevFigures;
            if (retry === 0 && self.stepEnabled('figures')) {
              try { const figs = await self.ai.generateFigures(task.topic, JSON.stringify(outline), rendered); if (figs.length > 0) { const figBlock = figs.map((f) => `### ${f.title}\n\n> ${f.caption}\n\n\n\`\`\`mermaid\n${f.mermaid}\n\`\`\``).join('\n\n'); finalContent = `${rendered}\n\n---\n\n## 图表\n\n${figBlock}`; } }
              catch (e: any) { self.logger.warn(`自动配图失败: ${e.message}`); }
            }
            db.update(documents).set({ content: finalContent, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
            await self.advance(taskId, 'quality-gate', draftStatus(retry), writerRes.output);

            if (!self.stepEnabled('quality-gate')) { report = { totalScore: 85, feedback: '质量门已禁用，跳过评分' }; break; }
            const latestDoc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get()!;
            const review = await self.orchestrator.reviewerAgent(taskId, ctx.documentId!, doc.title, latestDoc.content ?? '', task.topic, self.reflexionLogs(taskId));
            report = review.report;
            const scored = Number(report.totalScore);
            if (scored > best.score) best = { score: scored, content: latestDoc.content ?? '' };
            await self.advance(taskId, 'quality-gate', 'scored', `总分 ${report.totalScore}/100`);
            if (report.totalScore < QUALITY_THRESHOLD && retry < maxRetry) {
              retry += 1;
              if (review.reflexion) { db.insert(reflexionLogs).values({ id: randomUUID(), taskId, round: retry, note: review.reflexion.note, instructions: JSON.stringify(review.reflexion.instructions), createdAt: Date.now() }).run(); }
              const q = self.loadSteps(taskId);
              const qs = q.find((s) => s.key === 'quality-gate')!;
              qs.status = 'retry'; qs.retryCount = retry; qs.output = `第 ${retry} 次回炉（评分 ${report.totalScore} < ${QUALITY_THRESHOLD}）`;
              self.saveSteps(taskId, q);
              continue;
            }
            break;
          }
          return { report, researchNotice };
        },
      },
      {
        key: 'polish', label: '润色定稿',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('polish')) { db.update(documents).set({ status: 'polished', updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run(); return {}; }
          const task = self.get(taskId);
          const bestScore = ctx.report?.totalScore ?? 80;
          if (bestScore >= 0 && bestScore > 0) { /* best content already saved from quality-gate loop */ }
          const finalDoc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get()!;
          const content = finalDoc.content ?? '';
          const refIdx = content.indexOf('\n\n## 参考文献');
          const figIdx = content.indexOf('\n\n## 图表');
          const cuts = [refIdx, figIdx].filter((i) => i >= 0);
          const cut = cuts.length ? Math.min(...cuts) : -1;
          const bodyPart = cut >= 0 ? content.slice(0, cut) : content;
          const tailPart = cut >= 0 ? content.slice(cut) : '';
          const polished = await self.orchestrator.polisherAgent(taskId, bodyPart);
          db.insert(polishRecords).values({ id: randomUUID(), documentId: ctx.documentId!, type: 'polish', original: polished.original, polished: polished.polished, reason: polished.reason, createdAt: Date.now() }).run();
          const polishedText = String(polished.polished ?? '');
          const jsonLike = (polishedText.includes('"original"') && polishedText.includes('"polished"')) || polishedText.includes('```json') || (polishedText.trim().startsWith('{') && (polishedText.includes('"reason"') || polishedText.includes('"original"') || polishedText.includes('"polished"') || polishedText.includes('"content"')));
          const fallbackText = (jsonLike ? finalDoc.content : polishedText) + tailPart;
          db.update(documents).set({ content: fallbackText, status: 'polished', updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          return {};
        },
      },
      {
        key: 'citation-format', label: '引用格式化',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('citation-format')) return {};
          const task = self.get(taskId);
          const citationRows = db.select().from(references).where(eq(references.projectId, task.projectId)).all();
          return {} as any;
        },
      },
      {
        key: 'complete', label: '完成',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const task = self.get(taskId);
          db.update(documents).set({ status: 'final', updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          if (ctx.researchNotice) {
            const cur = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
            const body = cur?.content ?? '';
            if (!body.includes('研究阶段未在本地文献库')) {
              db.update(documents).set({ content: body + `\n\n---\n\n## 研究说明\n\n> ${ctx.researchNotice}\n`, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
            }
          }
          try {
            const finalMem = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
            const mem = await self.ai.extractEpisodic(task.topic, finalMem?.title || task.topic, finalMem?.outline || '[]', ctx.report?.totalScore ?? 80);
            if (mem.content) { db.insert(memoryLogs).values({ id: randomUUID(), type: 'episodic', projectId: task.projectId, content: mem.content, keywords: JSON.stringify(mem.keywords), createdAt: Date.now() }).run(); }
          } catch (e: any) { self.logger.warn(`情景记忆沉淀失败: ${e.message}`); }
          self.setStatus(taskId, 'completed', 'complete');
          return {};
        },
      },
    ];
  }

  private async notify(taskId: string, steps: PipelineStepState[], step: PipelineStep, n: StepNotification) {
    const s = steps.find((x) => x.key === step.key);
    if (!s) return;
    if (n.status === 'awaiting_confirmation') { s.status = 'awaiting_confirmation'; if ('output' in n && n.output) s.output = n.output; this.saveSteps(taskId, steps); this.setStatus(taskId, 'awaiting_confirmation', step.key); return; }
    if (n.status === 'running') s.status = 'running';
    else if (n.status === 'done') { s.status = 'done'; if ('output' in n && n.output) s.output = n.output; }
    else if (n.status === 'skipped') { s.status = 'skipped'; if ('output' in n && n.output) s.output = n.output; }
    else if (n.status === 'failed') { s.status = 'failed'; s.output = ('error' in n ? n.error : 'failed'); }
    if (n.status === 'running') this.setStatus(taskId, 'running', step.key);
    this.saveSteps(taskId, steps);
  }

  // ─── Pre-Confirmation 步骤注册表（主题验证 + 文献 + 大纲）────────
  private buildPreConfirmationSteps(taskId: string): PipelineStep[] {
    const self = this;
    const SR = STEP_REGISTRY;
    return [
      { key: 'topic-verify', label: SR['topic-verify'],
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const task = self.get(taskId);
          const { verifiedTopic, plan } = await self.orchestrator.plannerAgent(taskId, task.topic);
          return { verifiedTopic, plan };
        },
      },
      { key: 'literature', label: SR['literature'],
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('literature')) return { researchNotice: '用户已禁用文献调研' };
          const task = self.get(taskId);
          const { hits, trace } = await self.orchestrator.researchAgents(taskId, task.topic, ctx.plan!);
          const enriched = await self.crossEnrichResearch(task.projectId, task.topic, ctx.plan!, hits);
          db.update(pipelineTasks).set({ researchNotice: enriched.notice, researchMeta: JSON.stringify(enriched.meta), updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
          if (enriched.libraryHits.length > 0) self.references.importPipelineHits(task.projectId, enriched.libraryHits);
          const refs = self.references.list(task.projectId);
          const summary = refs.length ? await self.ai.summarizeLiterature(task.topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n')) : '（未检索到文献，将按通用学术结构起草）';
          const totalFound = enriched.libraryHits.length + enriched.knowledgeHits.length;
          return { researchTrace: trace, enrichedLibHits: enriched.libraryHits, enrichedKnHits: enriched.knowledgeHits, researchNotice: enriched.notice, literatureSummary: `检索到 ${totalFound} 条（文献 ${enriched.libraryHits.length} / 知识 ${enriched.knowledgeHits.length}）\n${summary.slice(0, 500)}` };
        },
      },
      { key: 'outline', label: SR['outline'],
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          if (!self.stepEnabled('outline')) {
            const outline = await self.ai.writeOutline(ctx.verifiedTopic!, ctx.literatureSummary || '');
            return { outline };
          }
          const outline = await self.ai.writeOutline(ctx.verifiedTopic!, ctx.literatureSummary || '');
          const err: any = new Error('awaiting_confirmation');
          err.cause = AWAITING_CONFIRMATION;
          (err as any)._outline = outline;
          throw err;
        },
        onError: async (_ctx, err) => { if (err?.cause === AWAITING_CONFIRMATION) return 'abort' as const; return 'abort' as const; },
      },
    ];
  }

  // ─── Post-Confirmation 步骤注册表（起草 + 质量门 + 回炉 + 润色 + 引用 + 完成）──
  private buildPostConfirmationSteps(taskId: string): PipelineStep[] {
    const self = this;
    return [
      { key: 'drafting', label: '分章起草',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const task = self.get(taskId);
          const refs = self.refsForDraft(task.projectId);
          const refStr = self.referencesForPrompt(task.projectId, refs);
          const procedural = self.proceduralMemory(task.projectId);
          const { content: draft, agentRuns } = await self.orchestrator.draftingAgent(taskId, ctx.verifiedTopic!, ctx.outline!, ctx.literatureSummary || '', refStr, procedural);
          const doc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
          const existingOutline = doc?.outline ? JSON.parse(doc.outline) : ctx.outline;
          const content = await self.renderCitations(task.projectId, ctx.documentId!, draft, refs, [], [], new Map(), ctx.enrichedKnHits || []);
          db.update(documents).set({ content, outline: JSON.stringify(existingOutline), version: (doc?.version || 1) + 1, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          return { content };
        },
      },
      { key: 'quality-gate', label: '质量门评分',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const doc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
          const { scores, feedback, totalScore } = await self.ai.reviewPaper(doc?.content || ctx.content || '');
          const report = { scores, feedback, totalScore };
          db.insert(reflexionLogs).values({ id: randomUUID(), taskId, round: (ctx.qualityRetryCount || 0) + 1, note: feedback, instructions: JSON.stringify([]), createdAt: Date.now() }).run();
          return { report, qualityRetryCount: (ctx.qualityRetryCount || 0) + 1 };
        },
        onError: async (ctx, err) => {
          if ((ctx.qualityRetryCount || 0) >= 3) return 'abort' as const;
          return 'retry' as const;
        },
      },
      { key: 'polish', label: '润色定稿',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const doc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
          const polished = await self.ai.polish(doc?.content || ctx.content || '');
          db.update(documents).set({ content: polished, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          try { db.insert(polishRecords).values({ id: randomUUID(), documentId: ctx.documentId!, original: doc?.content || '', polished, changesSummary: 'AI 全文润色', createdAt: Date.now() }).run(); } catch {}
          return { content: polished };
        },
      },
      { key: 'citation-format', label: '引用格式化',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const doc = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
          const content = doc?.content || '';
          const refs = self.refsForDraft(self.get(taskId).projectId);
          const reformatted = await self.renderCitations(self.get(taskId).projectId, ctx.documentId!, content, refs, ctx.enrichedLibHits || [], [], new Map(), ctx.enrichedKnHits || []);
          db.update(documents).set({ content: reformatted, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          return { content: reformatted };
        },
      },
      { key: 'complete', label: '完成',
        run: async (ctx: PipelineContext): Promise<Partial<PipelineContext>> => {
          const task = self.get(taskId);
          db.update(documents).set({ status: 'final', updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          if (ctx.researchNotice) {
            const cur = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
            const body = cur?.content ?? '';
            if (!body.includes('研究阶段未在本地文献库')) db.update(documents).set({ content: body + `\n\n---\n\n## 研究说明\n\n> ${ctx.researchNotice}\n`, updatedAt: Date.now() }).where(eq(documents.id, ctx.documentId!)).run();
          }
          try {
            const finalMem = db.select().from(documents).where(eq(documents.id, ctx.documentId!)).get();
            const mem = await self.ai.extractEpisodic(task.topic, finalMem?.title || task.topic, finalMem?.outline || '[]', ctx.report?.totalScore ?? 80);
            if (mem.content) db.insert(memoryLogs).values({ id: randomUUID(), type: 'episodic', projectId: task.projectId, content: mem.content, keywords: JSON.stringify(mem.keywords), createdAt: Date.now() }).run();
          } catch (e: any) { self.logger.warn(`情景记忆沉淀失败: ${e.message}`); }
          self.setStatus(taskId, 'completed', 'complete');
          return {};
        },
      },
    ];
  }

  // ─── DAG 运行器 ────────────────────────────────────────────────
  private async runPreConfirmation(taskId: string) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    try {
      const task = this.get(taskId);
      const steps = this.buildPreConfirmationSteps(taskId);
      const ctx: PipelineContext = { task, qualityRetryCount: 0 };
      const run = this.runPreConfirmation.bind(this);
      try {
        const result = await executeDAG(steps, ctx,
          async (step, n) => { const s = this.loadSteps(taskId); await this.notify(taskId, s, step, n); },
          (msg) => this.logger.warn(msg));
        // 全部完成 = outline 被禁用，自动创建 document 并切到后段
        const doc = await this.createDocumentAndProceed(taskId, result.outline!);
        if (doc) void this.runPostConfirmation(taskId, doc);
      } catch (err: any) {
        if (err?.cause === AWAITING_CONFIRMATION || err === AWAITING_CONFIRMATION) return;
        throw err;
      }
    } catch (e: any) {
      this.logger.error(`流水线 ${taskId} 前段执行失败: ${e.message}`);
      const steps = this.loadSteps(taskId);
      const cur = steps.find((s) => s.status === 'running');
      if (cur) cur.status = 'failed';
      this.saveSteps(taskId, steps);
      this.setStatus(taskId, 'failed', cur?.key || '', e.message || String(e));
    } finally {
      this.running.delete(taskId);
    }
  }

  private async createDocumentAndProceed(taskId: string, outline: any): Promise<string | null> {
    const task = this.get(taskId);
    if (task.documentId) return null;
    const now = Date.now();
    const doc = { id: randomUUID(), projectId: task.projectId, title: outline.title || task.topic, content: '', outline: JSON.stringify(outline), version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now };
    db.insert(documents).values(doc).run();
    db.update(pipelineTasks).set({ documentId: doc.id, updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
    return doc.id;
  }

  private async runPostConfirmation(taskId: string, documentId: string) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    try {
      const task = this.get(taskId);
      const steps = this.buildPostConfirmationSteps(taskId);
      const stepsState = this.loadSteps(taskId);
      // 后段第一步（outline 之后的步骤）之前的全部标记 done（前段已完成）
      for (const s of stepsState) {
        if (s.key === 'quality-gate') break;
        if (s.status === 'pending' || s.status === 'awaiting_confirmation') s.status = 'done';
      }
      this.saveSteps(taskId, stepsState);
      const ctx: PipelineContext = { task, documentId, qualityRetryCount: 0 };
      await executeDAG(steps, ctx,
        async (step, n) => { const s = this.loadSteps(taskId); await this.notify(taskId, s, step, n); },
        (msg) => this.logger.warn(msg));
    } catch (e: any) {
      this.logger.error(`流水线 ${taskId} 后段执行失败: ${e.message}`);
      const steps = this.loadSteps(taskId);
      const cur = steps.find((s) => s.status === 'running');
      if (cur) cur.status = 'failed';
      this.saveSteps(taskId, steps);
      this.setStatus(taskId, 'failed', cur?.key || '', e.message || String(e));
    } finally {
      this.running.delete(taskId);
    }
  }

  // ─── 辅助方法：跨库检索增强 ────────────────────────────────────
  private static tokenize(text: string): string[] {
    const t = (text || '').toLowerCase();
    const toks: string[] = [];
    for (const m of t.matchAll(/[a-z][a-z0-9_-]{1,}/g)) toks.push(m[0]);
    const cn = t.replace(/[^一-龥]/g, '');
    for (let i = 0; i < cn.length - 1; i++) toks.push(cn.slice(i, i + 2));
    return toks;
  }

  private static scoreLibraryHit(query: string, hit: PaperHit): number {
    const qt = new Set(PipelineService.tokenize(query));
    if (qt.size === 0) return 0.5;
    const titleT = PipelineService.tokenize(hit.title);
    const abT = PipelineService.tokenize(hit.abstract || '');
    let hitCount = 0, titleHits = 0;
    for (const t of qt) { if (titleT.includes(t)) { hitCount++; titleHits++; } else if (abT.includes(t)) hitCount++; }
    const ratio = hitCount / qt.size;
    return Math.min(1, Math.round((ratio * 0.7 + Math.min(1, titleHits / qt.size) * 0.3) * 100) / 100);
  }

  private static normalizeKnScore(score: number): number {
    return Math.min(1, Math.round(Math.max(0, score) / 8 * 100) / 100);
  }

  private async crossEnrichResearch(projectId: string, topic: string, plan: ResearchPlan, libraryHits: PaperHit[]): Promise<{ libraryHits: PaperHit[]; knowledgeHits: PaperHit[]; notice: string | null; meta: ResearchMeta }> {
    const queryBag = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).join(' ');
    const lib: PaperHit[] = libraryHits.map((h) => ({ ...h, origin: 'library' as const, matchScore: PipelineService.scoreLibraryHit(queryBag, h) }));
    const knQueries = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).slice(0, 4);
    const knSeen = new Set<string>();
    const knAll: PaperHit[] = [];
    for (const q of knQueries) {
      try {
        const chunks = await this.knowledge.search(projectId, q, 3);
        for (const c of chunks) {
          const key = `${c.docId || c.id}:${c.id}`;
          if (knSeen.has(key)) continue;
          knSeen.add(key);
          knAll.push({ title: c.docName || '未命名资料', authors: [], year: null, venue: '知识库', doi: '', url: '', abstract: (c.content || '').replace(/\s+/g, ' ').trim().slice(0, 300), source: 'manual', citationCount: 0, origin: 'knowledge' as const, matchScore: PipelineService.normalizeKnScore(c.score) });
        }
      } catch (e: any) { this.logger.warn(`知识库跨库检索失败 [${q}]: ${e?.message || e}`); }
    }
    const knByDoc = new Map<string, PaperHit>();
    for (const h of knAll) { const ex = knByDoc.get(h.title); if (!ex || (h.matchScore || 0) > (ex.matchScore || 0)) knByDoc.set(h.title, h); }
    const kn = [...knByDoc.values()].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 5);
    const total = lib.length + kn.length;
    return { libraryHits: lib, knowledgeHits: kn, notice: total === 0 ? ZERO_HIT_NOTICE : null, meta: { lib: lib.map((h) => ({ title: h.title, score: h.matchScore ?? 0 })), kn } };
  }

  private parseResearchMeta(raw: string | null | undefined): ResearchMeta {
    if (!raw) return { lib: [], kn: [] };
    try { const o = JSON.parse(raw) as ResearchMeta; return { lib: Array.isArray(o.lib) ? o.lib : [], kn: Array.isArray(o.kn) ? o.kn : [] }; }
    catch { return { lib: [], kn: [] }; }
  }

  private static readonly DOMAIN_KW = ['graph neural', 'gnn', 'molecular', 'molecule', 'drug', 'protein', 'ligand', 'chemical', 'pharmaco', 'biomed', 'bioinform', 'deep learning', 'machine learning', 'neural network', 'geometric', 'equivariant', 'graph', 'neural', 'chem', '图神经', '分子', '药物', '蛋白', '几何', '深度学习', '消息传递', '药'];

  private refsForDraft(projectId: string) {
    const all = this.references.list(projectId);
    const meta = all.filter((r) => { try { const a = JSON.parse(r.authors || '[]') as string[]; return a.length > 0 && !!r.year; } catch { return false; } });
    const rel = meta.filter((r) => { const t = (r.title || '').toLowerCase(); const ab = (r.abstract || '').toLowerCase(); return PipelineService.DOMAIN_KW.some((k) => t.includes(k) || ab.includes(k)); });
    return (rel.length >= 6 ? rel : meta).sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0)).slice(0, 20);
  }

  private referencesForPrompt(projectId: string, refs?: ReturnType<PipelineService['refsForDraft']>): string {
    const pool = refs ?? this.refsForDraft(projectId);
    return pool.map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`).join('\n');
  }

  private renderCitations(projectId: string, documentId: string, content: string, refPool: ReturnType<PipelineService['refsForDraft']>, supplementHits: PaperHit[] = [], suppRefIds: (string | null)[] = [], libScore: Map<string, number> = new Map(), knowledgeHits: PaperHit[] = []): string {
    if (!content) return content;
    const refs = refPool;
    const { poolSpot, suppSpot } = this.scanCitationSpots(content, refs.length, supplementHits.length);
    const used = new Set<number>();
    content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (refs[idx]) used.add(idx); return ''; });
    const order = [...used].sort((a, b) => a - b);
    const numOf = new Map(order.map((idx, k) => [idx, k + 1]));
    const usedSupp = new Set<number>();
    content.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (supplementHits[idx]) usedSupp.add(idx); return ''; });
    const suppOrder = [...usedSupp].sort((a, b) => a - b);
    const base = order.length;
    const suppNum = new Map(suppOrder.map((idx, k) => [idx, base + k + 1]));
    let out = content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return numOf.has(idx) ? `[${numOf.get(idx)}]` : `[文献${n}]`; });
    out = out.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return suppNum.has(idx) ? `[${suppNum.get(idx)}]` : '[补充文献]'; });
    const list: string[] = [];
    for (const idx of order) { const r = refs[idx]; const authors = (() => { try { return (JSON.parse(r.authors || '[]') as string[]).join(', ') || '佚名'; } catch { return '佚名'; } })(); const score = libScore.get(r.title); const tag = typeof score === 'number' ? `（文献库 · 匹配 ${score.toFixed(2)}）` : ''; list.push(`[${list.length + 1}] ${authors}. ${r.title}[J].${r.venue ? ` ${r.venue},` : ''} ${r.year ? `${r.year}.` : 'n.d.'}${r.doi ? ` https://doi.org/${r.doi.replace(/^https?:\/\//, '')}` : ''}${tag}`); }
    for (const idx of suppOrder) { const h = supplementHits[idx]; const authors = (h.authors || []).join(', ') || '佚名'; list.push(`[${list.length + 1}] ${authors}. ${h.title}[J].${h.venue ? ` ${h.venue},` : ''} ${h.year ? `${h.year}.` : 'n.d.'}${h.doi ? ` https://doi.org/${h.doi.replace(/^https?:\/\//, '')}` : ''}`); }
    const blocks: string[] = [];
    if (list.length) blocks.push(list.join('\n'));
    if (knowledgeHits.length) { const knLines = knowledgeHits.map((k) => `- 《${k.title}》（知识库 · 匹配 ${(k.matchScore ?? 0).toFixed(2)}）：${(k.abstract || '').slice(0, 100).trim()}`).join('\n'); blocks.push(`### 知识库参考（研究阶段本地检索）\n\n${knLines}`); }
    if (blocks.length) out += `\n\n## 参考文献\n\n${blocks.join('\n\n')}`;
    this.backfillCitations(documentId, refs, order, suppOrder, suppRefIds, poolSpot, suppSpot);
    return out;
  }

  private scanCitationSpots(content: string, poolSize: number, suppSize: number) {
    const poolSpot = new Map<number, { location: string; context: string }>();
    const suppSpot = new Map<number, { location: string; context: string }>();
    const tokenRe = /(#{1,6}\s+[^\n]+)|\[Ref:(\d+)\]|\[补充Ref:(\d+)\]/g;
    let m: RegExpExecArray | null; let section = '';
    while ((m = tokenRe.exec(content)) !== null) {
      if (m[1] !== undefined) section = m[1].replace(/^#{1,6}\s+/, '').trim();
      else if (m[2] !== undefined) { const idx = Number(m[2]) - 1; if (idx >= 0 && idx < poolSize && !poolSpot.has(idx)) poolSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
      else if (m[3] !== undefined) { const idx = Number(m[3]) - 1; if (idx >= 0 && idx < suppSize && !suppSpot.has(idx)) suppSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
    }
    return { poolSpot, suppSpot };
  }

  private contextAround(text: string, at: number, len: number): string {
    return text.slice(Math.max(0, at - 40), Math.min(text.length, at + len + 40)).replace(/\s+/g, ' ').trim();
  }

  private backfillCitations(documentId: string, refs: ReturnType<PipelineService['refsForDraft']>, order: number[], suppOrder: number[], suppRefIds: (string | null)[], poolSpot: Map<number, { location: string; context: string }>, suppSpot: Map<number, { location: string; context: string }>) {
    try {
      const existing = db.select().from(citations).where(eq(citations.documentId, documentId)).all();
      const have = new Set(existing.map((c) => c.referenceId));
      const now = Date.now();
      const insertOne = (referenceId: string, spot: { location: string; context: string } | undefined, doi: string) => {
        if (!referenceId || have.has(referenceId)) return;
        db.insert(citations).values({ id: randomUUID(), documentId, referenceId, location: spot?.location || '', context: spot?.context || '', format: 'pipeline', verified: doi ? 1 : 0, createdAt: now }).run();
        have.add(referenceId);
      };
      for (const idx of order) { const r = refs[idx]; if (!r) continue; insertOne(r.id, poolSpot.get(idx), r.doi || ''); }
      for (const idx of suppOrder) { const refId = suppRefIds[idx]; if (!refId) continue; const ref = db.select().from(references).where(eq(references.id, refId)).get(); insertOne(refId, suppSpot.get(idx), ref?.doi || ''); }
    } catch (e: any) { this.logger.warn(`citations 回填失败（不影响流水线产物）: ${e?.message || e}`); }
  }

  private reflexionNote(taskId: string): string {
    const rows = db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, taskId)).orderBy(reflexionLogs.createdAt).all();
    if (rows.length === 0) return '';
    const last = rows[rows.length - 1];
    let instructions: string[] = [];
    try { instructions = JSON.parse(last.instructions || '[]'); } catch { /* ignore */ }
    return `${last.note}${instructions.length ? '\n具体指令：' + instructions.join('；') : ''}`;
  }

  private reflexionLogs(taskId: string): string[] {
    return db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, taskId)).orderBy(reflexionLogs.createdAt).all().map((r) => `第${r.round}轮：${r.note}`);
  }

  private proceduralMemory(projectId: string): string {
    const rows = db.select().from(memoryLogs).where(and(eq(memoryLogs.type, 'procedural'), eq(memoryLogs.projectId, projectId))).orderBy(memoryLogs.createdAt).all();
    return rows.slice(-1).map((r) => r.content).join('');
  }

  /** 内部持久化辅助：DAG notify 之外的细粒度阶段状态写入 */
  private advance(taskId: string, key: string, status: PipelineStepState['status'], output?: string) {
    const steps = this.loadSteps(taskId);
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    step.status = status;
    if (output !== undefined) step.output = output;
    this.saveSteps(taskId, steps);
    if (status === 'running') this.setStatus(taskId, 'running', key);
  }
}

/** 将 retry 次数映射到 quality-gate 状态 */
function draftStatus(retry: number): 'done' | 'running' {
  return retry > 0 ? 'running' : 'done';
}
