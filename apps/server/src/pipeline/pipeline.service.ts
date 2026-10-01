import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, documents, references, polishRecords, reflexionLogs, memoryLogs , pipelineConfigs, citations } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { ReferencesService, PaperHit } from '../references/references.service';
import { AgentOrchestratorService, ResearchPlan } from '../orchestrator/orchestrator.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

export interface PipelineStepState {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'retry' | 'failed' | 'skipped';
  output?: string;
  retryCount: number;
}

const STEPS: { key: string; label: string }[] = [
  { key: 'topic-verify', label: '主题验证' },
  { key: 'literature', label: '文献调研' },
  { key: 'outline', label: '大纲生成' },
  { key: 'drafting', label: '分章起草' },
  { key: 'quality-gate', label: '质量门评分' },
  { key: 'polish', label: '润色定稿' },
  { key: 'citation-format', label: '引用格式化' },
  { key: 'complete', label: '完成' },
];

const MAX_RETRY = 2;
const QUALITY_THRESHOLD = 80;

/** 跨库检索命中摘要（持久化到 pipeline_task.research_meta，供产物参考文献块回标来源/匹配度） */
interface ResearchMeta {
  /** 文献库命中：title → 匹配度 */
  lib: { title: string; score: number }[];
  /** 知识库命中（资料片段，不进 references 表） */
  kn: PaperHit[];
}

/** 跨库（文献库+知识库）命中 0 时写入产物文档与 pipeline_task.researchNotice 的结构化引导 */
const ZERO_HIT_NOTICE =
  '研究阶段未在本地文献库/知识库检索到相关条目，已依赖模型知识完成起草；建议到「文献调研」页添加相关文献（粘贴 DOI/导入 BibTeX）、检查关键词拼写，或在知识库上传资料后重新运行。';

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

  /** 步骤启停：用户可在设置页自定义（pipeline_config 表），默认全部启用 */
  private stepEnabled(key: string): boolean {
    try {
      const r = db.select().from(pipelineConfigs).where(eq(pipelineConfigs.stepKey, key)).get();
      return !r || (r.enabled ?? 1) === 1;
    } catch {
      return true;
    }
  }

  /** 创建流水线任务并立即后台执行（借鉴 Agent Laboratory 三阶段流水线） */
  create(projectId: string, topic: string) {
    if (!topic.trim()) throw new BadRequestException('请先输入研究主题');
    if (!this.ai.configured) {
      throw new BadRequestException('AI 服务未配置：请在 apps/server/.env 设置 AI_API_KEY 后再运行流水线');
    }
    const now = Date.now();
    const task = {
      id: randomUUID(),
      projectId,
      documentId: null as string | null,
      topic: topic.trim(),
      currentStep: 'topic-verify',
      status: 'running',
      steps: JSON.stringify(
        STEPS.map((s) => ({ key: s.key, label: s.label, status: 'pending' as const, retryCount: 0 })),
      ),
      retryCount: 0,
      lastError: '',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(pipelineTasks).values(task).run();
    void this.run(task.id);
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

  /** Phase 3：该流水线的子 Agent 执行轨迹 */
  agentRuns(id: string) {
    this.get(id);
    return this.orchestrator.listRuns(id);
  }

  /**
   * Checkpoint 断点续跑：服务重启后恢复中断任务（对标 LangGraph checkpointer）
   * - 已有产物文档（后半段）：从 drafting 起断点续跑（drafting 全量重写幂等，安全）
   * - 无文档（前半段）：标记 interrupted，前端可一键重新运行（重跑成本低）
   */
  resumeInterrupted() {
    const rows = db
      .select()
      .from(pipelineTasks)
      .where(eq(pipelineTasks.status, 'running'))
      .all();
    for (const t of rows) {
      if (t.documentId) {
        const steps = JSON.parse(t.steps || '[]') as PipelineStepState[];
        let resumed = false;
        for (const s of steps) {
          if (s.key === 'drafting') {
            s.status = 'running';
            s.output = '服务重启后续跑（checkpoint 恢复）';
            resumed = true;
          } else if (resumed) {
            s.status = 'pending';
          }
        }
        db.update(pipelineTasks)
          .set({ steps: JSON.stringify(steps), status: 'running', currentStep: 'drafting', lastError: '', updatedAt: Date.now() })
          .where(eq(pipelineTasks.id, t.id))
          .run();
        this.logger.log(`[checkpoint] 任务 ${t.id} 断点续跑（从 drafting 恢复）`);
        void this.runAfterConfirmation(t.id, t.documentId);
      } else {
        this.logger.warn(`[checkpoint] 任务 ${t.id} 中断于前半段（无产物文档），标记 interrupted`);
        this.setStatus(t.id, 'interrupted', '', '服务重启中断，前半段任务请删除后重新启动');
      }
    }
    return rows.length;
  }

  // ---------- 状态机 ----------

  private loadSteps(id: string): PipelineStepState[] {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    return JSON.parse(row?.steps || '[]') as PipelineStepState[];
  }

  private saveSteps(id: string, steps: PipelineStepState[]) {
    db.update(pipelineTasks)
      .set({ steps: JSON.stringify(steps), updatedAt: Date.now() })
      .where(eq(pipelineTasks.id, id))
      .run();
  }

  private setStatus(id: string, status: string, currentStep = '', lastError = '') {
    db.update(pipelineTasks)
      .set({ status, currentStep: currentStep || undefined, lastError: lastError || '', updatedAt: Date.now() })
      .where(eq(pipelineTasks.id, id))
      .run();
  }

  private async run(taskId: string) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    try {
      await this.execute(taskId);
    } catch (e: any) {
      this.logger.error(`流水线 ${taskId} 执行失败: ${e.message}`);
      const steps = this.loadSteps(taskId);
      const cur = steps.find((s) => s.status === 'running');
      if (cur) cur.status = 'failed';
      this.saveSteps(taskId, steps);
      this.setStatus(taskId, 'failed', cur?.key || '', e.message || String(e));
    } finally {
      this.running.delete(taskId);
    }
  }

  private async execute(taskId: string) {
    const task = this.get(taskId);
    const steps = task.steps;

    // ① Supervisor：Planner Agent 生成研究计划（Phase 1a + Phase 3 编排）
    await this.advance(taskId, 'topic-verify', 'running');
    const { verifiedTopic, plan } = await this.orchestrator.plannerAgent(taskId, task.topic);
    await this.advance(
      taskId,
      'topic-verify',
      'done',
      JSON.stringify({
        topic: verifiedTopic,
        objective: plan.objective,
        researchQuestions: plan.researchQuestions,
        searchStrategy: plan.searchStrategy,
        draftingPlan: plan.draftingPlan,
        risks: plan.risks,
      }),
    );

    // ② Supervisor：3 路 ResearchAgent 并行 ReAct（Phase 1b + Phase 3 编排）
    if (!this.stepEnabled('literature')) {
      // 用户禁用文献调研：跳过检索，用通用结构起草
      await this.advance(taskId, 'literature', 'skipped', '用户已禁用文献调研');
      const trace = '[]';
      db.update(pipelineTasks).set({ trace, updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
      await this.continueFromOutline(taskId, verifiedTopic, '（用户已禁用文献调研，按通用学术结构起草）');
      return;
    }
    await this.advance(taskId, 'literature', 'running');
    const { hits, trace } = await this.orchestrator.researchAgents(taskId, task.topic, plan);
    db.update(pipelineTasks).set({ trace: JSON.stringify(trace), updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();

    // 跨库检索增强：文献库（ReAct 已按项目级 LIKE 命中）+ 知识库（复用本地 BM25），汇总排序、回标来源/匹配度。
    // 命中 0 时写 researchNotice（API 可读）+ 产物文档引导段；命中>0 时持久化命中摘要供参考文献块回标。
    const enriched = await this.crossEnrichResearch(task.projectId, task.topic, plan, hits);
    db.update(pipelineTasks)
      .set({ researchNotice: enriched.notice, researchMeta: JSON.stringify(enriched.meta), updatedAt: Date.now() })
      .where(eq(pipelineTasks.id, taskId))
      .run();

    if (enriched.libraryHits.length > 0) {
      // 差距 #6：ResearchAgent hits 自动入库（source='pipeline-research'，标题指纹命中同项目则跳过，多轮重跑幂等）
      this.references.importPipelineHits(task.projectId, enriched.libraryHits);
    }
    const refs = this.references.list(task.projectId);
    const summary = refs.length
      ? await this.ai.summarizeLiterature(task.topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
      : '（未检索到文献，将按通用学术结构起草）';
    const totalFound = enriched.libraryHits.length + enriched.knowledgeHits.length;
    await this.advance(
      taskId,
      'literature',
      'done',
      `跨库检索到 ${totalFound} 条（文献库 ${enriched.libraryHits.length} / 知识库 ${enriched.knowledgeHits.length}）\n${summary.slice(0, 500)}`,
    );

    await this.continueFromOutline(taskId, verifiedTopic, summary);
    return;
  }

  /** ③ 大纲生成：禁用时自动生成不暂停，启用时等待人工确认（Human-in-the-loop） */
  private async continueFromOutline(taskId: string, verifiedTopic: string, summary: string) {
    if (!this.stepEnabled('outline')) {
      // 用户禁用大纲确认：自动生成大纲直接进入起草
      await this.advance(taskId, 'outline', 'running');
      const outline = await this.ai.writeOutline(verifiedTopic, summary);
      await this.advance(taskId, 'outline', 'done', JSON.stringify(outline));
      this.setStatus(taskId, 'running', 'drafting');
      const task = this.get(taskId);
      const now = Date.now();
      const doc = {
        id: randomUUID(),
        projectId: task.projectId,
        title: outline.title || verifiedTopic,
        content: '',
        outline: JSON.stringify(outline),
        version: 1,
        versions: '[]',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      db.insert(documents).values(doc).run();
      db.update(pipelineTasks).set({ documentId: doc.id, updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
      void this.runAfterConfirmation(taskId, doc.id);
      return;
    }
    await this.advance(taskId, 'outline', 'running');
    const outline = await this.ai.writeOutline(verifiedTopic, summary);
    await this.advance(taskId, 'outline', 'awaiting_confirmation', JSON.stringify(outline));
    this.setStatus(taskId, 'awaiting_confirmation', 'outline');
  }

  /** 人工确认大纲后：创建文档并继续起草 → 质量门 → 回炉 → 润色 → 引用 → 完成 */
  async confirmOutline(taskId: string, editedOutline?: { title: string; sections: { title: string; subsections: string[] }[] }) {
    const task = this.get(taskId);
    if (task.status !== 'awaiting_confirmation') throw new BadRequestException('当前不在大纲确认节点');

    const steps = task.steps;
    const outlineStep = steps.find((s) => s.key === 'outline')!;
    const outline = editedOutline || JSON.parse(outlineStep.output || '{}');

    // 创建产物文档
    const now = Date.now();
    const doc = {
      id: randomUUID(),
      projectId: task.projectId,
      title: outline.title || task.topic,
      content: '',
      outline: JSON.stringify(outline),
      version: 1,
      versions: '[]',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(documents).values(doc).run();
    db.update(pipelineTasks).set({ documentId: doc.id, updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();

    this.setStatus(taskId, 'running', 'drafting');
    void this.runAfterConfirmation(taskId, doc.id);
    return this.get(taskId);
  }

  private async runAfterConfirmation(taskId: string, documentId: string) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    try {
      await this.executeAfterConfirmation(taskId, documentId);
    } catch (e: any) {
      this.logger.error(`流水线 ${taskId} 确认后执行失败: ${e.message}`);
      const steps = this.loadSteps(taskId);
      const cur = steps.find((s) => s.status === 'running');
      if (cur) cur.status = 'failed';
      this.saveSteps(taskId, steps);
      this.setStatus(taskId, 'failed', cur?.key || '', e.message || String(e));
    } finally {
      this.running.delete(taskId);
    }
  }

  private async executeAfterConfirmation(taskId: string, documentId: string) {
    const task = this.get(taskId);
    const steps = task.steps;
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get()!;
    const outline = JSON.parse(doc.outline || '[]') as { title: string; sections: { title: string; subsections: string[] }[] };

    // Research 阶段跨库命中摘要（持久化）：产物参考文献块回标来源/匹配度；命中 0 时据 notice 写引导段
    const researchMeta = this.parseResearchMeta(task.researchMeta);
    const researchNotice = task.researchNotice?.trim() || null;
    const libScore = new Map(researchMeta.lib.map((l) => [l.title, l.score]));

    let retry = 0;
    const maxRetry = MAX_RETRY;
    let report: { totalScore: number; feedback: string } | undefined;
    // 最优轮次快照：回炉可能使分数波动，最终定稿取所有轮次中最高分版本
    let best: { score: number; content: string } = { score: -1, content: '' };

    while (true) {
      // ④ Supervisor：Writer Agent 分章起草（注入 Reflexion + 程序记忆）
      await this.advance(taskId, 'drafting', 'running', retry > 0 ? `第 ${retry} 次回炉起草（依据反思指令重写）` : undefined);
      const reflexion = this.reflexionNote(taskId);
      const procedural = this.proceduralMemory(task.projectId);
      const styleHint = procedural ? `\n写作风格参考（来自记忆库）：${procedural}` : '';
      // 引用池在起草前固定取一次：prompt 注入与渲染用同一份（避免 Agentic RAG 回填文献后池排序变化导致编号错位）
      const refPool = this.refsForDraft(task.projectId);
      const writerRes = await this.orchestrator.writerAgent(
        taskId,
        documentId,
        doc.title,
        outline,
        { refsPrompt: this.referencesForPrompt(task.projectId, refPool), styleHint, reflexion },
        { skipAgenticSearch: retry > 0 },
      );
      // 回炉时保留上一版文档的图表章节（必须在写入新正文之前提取，否则被覆盖）
      let prevFigures = '';
      if (retry > 0) {
        const prev = db.select().from(documents).where(eq(documents.id, documentId)).get();
        const m = (prev?.content || '').match(/## 图表[\s\S]*?$/);
        if (m) prevFigures = `\n\n---\n\n${m[0]}`;
      }
      db.update(documents).set({ content: writerRes.content, updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
      // Phase 4：Writer Agent 补充检索到的文献回填文献库（Agentic RAG 闭环，带完整元数据）
      // 保留命中下标 → 入库文献 id 的对齐（create 空元数据守卫会跳过该条，返回 null），供引用回填 references.id
      const agenticHits = this.orchestrator.extractWriterHits(taskId);
      const suppRefIds: (string | null)[] = agenticHits.map((h) => {
        try {
          const row = this.references.create(task.projectId, h);
          return row ? row.id : null;
        } catch {
          return null;
        }
      });
      // 引用渲染：占位符 [Ref:N] → 顺序编码制 [N] + 文末参考文献列表（含补充文献），并幂等回填 citations 表
      // 命中>0：文献库条目回标「（文献库 · 匹配 x.xx）」，知识库命中单列「知识库参考」小节
      const rendered = this.renderCitations(task.projectId, documentId, writerRes.content, refPool, agenticHits, suppRefIds, libScore, researchMeta.kn);
      // 自动配图：生成 2-3 个 mermaid 学术图表（仅首次起草，回炉复用省额度）
      let finalContent = rendered + prevFigures;
      if (retry === 0 && this.stepEnabled('figures')) {
        try {
          const figs = await this.ai.generateFigures(task.topic, JSON.stringify(outline), rendered);
          if (figs.length > 0) {
            const figBlock = figs.map((f) => `### ${f.title}\n\n> ${f.caption}\n\n\n\`\`\`mermaid\n${f.mermaid}\n\`\`\``).join('\n\n');
            finalContent = `${rendered}\n\n---\n\n## 图表\n\n${figBlock}`;
          }
        } catch (e: any) {
          this.logger.warn(`自动配图失败: ${e.message}`);
        }
      }
      db.update(documents).set({ content: finalContent, updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
      await this.advance(taskId, 'drafting', 'done', writerRes.output);

      // ⑤ Supervisor：Reviewer Agent 质量门评分 + Reflexion 提炼
      if (!this.stepEnabled('quality-gate')) {
        await this.advance(taskId, 'quality-gate', 'skipped', '用户已禁用质量门评分');
        report = { totalScore: 85, feedback: '质量门已禁用，跳过评分' };
        break;
      }
      await this.advance(taskId, 'quality-gate', 'running');
      const latestDoc = db.select().from(documents).where(eq(documents.id, documentId)).get()!;
      const review = await this.orchestrator.reviewerAgent(taskId, documentId, doc.title, latestDoc.content ?? '', task.topic, this.reflexionLogs(taskId));
      report = review.report;
      const scored = Number(report.totalScore);
      if (scored > best.score) best = { score: scored, content: latestDoc.content ?? '' };
      await this.advance(taskId, 'quality-gate', 'done', `总分 ${report.totalScore}/100`);

      if (report.totalScore < QUALITY_THRESHOLD && retry < maxRetry) {
        retry += 1;
        // Reflexion 落库（语义梯度，最多保留 3 轮）
        if (review.reflexion) {
          db.insert(reflexionLogs)
            .values({
              id: randomUUID(),
              taskId,
              round: retry,
              note: review.reflexion.note,
              instructions: JSON.stringify(review.reflexion.instructions),
              createdAt: Date.now(),
            })
            .run();
        }
        const q = this.loadSteps(taskId);
        q.find((s) => s.key === 'drafting')!.status = 'retry';
        q.find((s) => s.key === 'drafting')!.retryCount = retry;
        q.find((s) => s.key === 'drafting')!.output = `第 ${retry} 次回炉（评分 ${report.totalScore} < ${QUALITY_THRESHOLD}）`;
        q.find((s) => s.key === 'quality-gate')!.status = 'retry';
        this.saveSteps(taskId, q);
        this.setStatus(taskId, 'running', 'drafting');
        continue; // 回炉重写
      }
      break;
    }

    // ⑥ Supervisor：Polisher Agent 润色定稿（三段式，借鉴 GPT-Academic）
    if (!this.stepEnabled('polish')) {
      await this.advance(taskId, 'polish', 'skipped', '用户已禁用润色');
      db.update(documents).set({ status: 'polished', updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
    } else {
    await this.advance(taskId, 'polish', 'running');
    if (best.score >= 0 && best.content) {
      db.update(documents).set({ content: best.content, updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
    }
    const finalDoc = db.select().from(documents).where(eq(documents.id, documentId)).get()!;
    // 润色只处理正文主体，图表/参考文献尾部原样保留（参考文献被当章节润色会洗掉）
    const content = finalDoc.content ?? '';
    const refIdx = content.indexOf('\n\n## 参考文献');
    const figIdx = content.indexOf('\n\n## 图表');
    const cuts = [refIdx, figIdx].filter((i) => i >= 0);
    const cut = cuts.length ? Math.min(...cuts) : -1;
    const bodyPart = cut >= 0 ? content.slice(0, cut) : content;
    const tailPart = cut >= 0 ? content.slice(cut) : '';
    const polished = await this.orchestrator.polisherAgent(taskId, bodyPart);
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId,
        type: 'polish',
        original: polished.original,
        polished: polished.polished,
        reason: polished.reason,
        createdAt: Date.now(),
      })
      .run();
    // 写库保险：若润色结果仍像未解析的 JSON，保留原文，避免污染正文
    const polishedText = String(polished.polished ?? '');
    // 未解析的 JSON 兜底（含 ```json 围栏 / 三字段串 / 嵌套转义）：判定为未解析即保留原文
    const jsonLike =
      (polishedText.includes('"original"') && polishedText.includes('"polished"')) ||
      polishedText.includes('```json') ||
      (polishedText.trim().startsWith('{') && (polishedText.includes('"reason"') || polishedText.includes('"original"') || polishedText.includes('"polished"') || polishedText.includes('"content"')));
    const fallbackText = (jsonLike ? finalDoc.content : polishedText) + tailPart;
    db.update(documents)
      .set({ content: fallbackText, status: 'polished', updatedAt: Date.now() })
      .where(eq(documents.id, documentId))
      .run();
    await this.advance(taskId, 'polish', 'done', '润色完成（原文+润色文+理由已存档）');
    }

    // ⑦ 引用格式化
    if (!this.stepEnabled('citation-format')) {
      await this.advance(taskId, 'citation-format', 'skipped', '用户已禁用引用格式化');
    } else {
    await this.advance(taskId, 'citation-format', 'running');
    const citationRows = db
      .select()
      .from(references)
      .where(eq(references.projectId, task.projectId))
      .all();
    await this.advance(
      taskId,
      'citation-format',
      'done',
      `已就绪 ${citationRows.length} 条文献（可到论文编辑页按 APA/IEEE/Vancouver 导出）`,
    );
    }

    // ⑧ 完成 + Phase 2a：先沉淀情景记忆，再置 completed（保证完成即记忆可查）
    await this.advance(taskId, 'complete', 'done');
    db.update(documents).set({ status: 'final', updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();

    // 命中 0 结构化引导：仅在跨库命中 0 时，把引导段写入产物文档正文（幂等，避免回炉重复追加）
    if (researchNotice) {
      const cur = db.select().from(documents).where(eq(documents.id, documentId)).get();
      const body = cur?.content ?? '';
      if (!body.includes('研究阶段未在本地文献库')) {
        db.update(documents)
          .set({ content: body + `\n\n---\n\n## 研究说明\n\n> ${researchNotice}\n`, updatedAt: Date.now() })
          .where(eq(documents.id, documentId))
          .run();
      }
    }
    try {
      const finalMem = db.select().from(documents).where(eq(documents.id, documentId)).get();
      const mem = await this.ai.extractEpisodic(
        task.topic,
        finalMem?.title || task.topic,
        finalMem?.outline || '[]',
        report?.totalScore ?? 80,
      );
      if (mem.content) {
        db.insert(memoryLogs)
          .values({
            id: randomUUID(),
            type: 'episodic',
            projectId: task.projectId,
            content: mem.content,
            keywords: JSON.stringify(mem.keywords),
            createdAt: Date.now(),
          })
          .run();
      }
    } catch (e: any) {
      this.logger.warn(`情景记忆沉淀失败: ${e.message}`);
    }
    this.setStatus(taskId, 'completed', 'complete');
  }

  // ---------- Research 阶段跨库检索增强（文献库 LIKE + 知识库本地 BM25，零外部 API） ----------

  /** 轻量分词：英文按词、中文按 bigram（与 knowledge 检索同口径，零依赖） */
  private static tokenize(text: string): string[] {
    const t = (text || '').toLowerCase();
    const toks: string[] = [];
    for (const m of t.matchAll(/[a-z][a-z0-9_-]{1,}/g)) toks.push(m[0]);
    const cn = t.replace(/[^一-龥]/g, '');
    for (let i = 0; i < cn.length - 1; i++) toks.push(cn.slice(i, i + 2));
    return toks;
  }

  /** 文献库命中匹配度（0~1）：查询词在标题/摘要的命中比例，标题命中额外加权 */
  private static scoreLibraryHit(query: string, hit: PaperHit): number {
    const qt = new Set(PipelineService.tokenize(query));
    if (qt.size === 0) return 0.5;
    const titleT = PipelineService.tokenize(hit.title);
    const abT = PipelineService.tokenize(hit.abstract || '');
    let hitCount = 0;
    let titleHits = 0;
    for (const t of qt) {
      if (titleT.includes(t)) {
        hitCount++;
        titleHits++;
      } else if (abT.includes(t)) {
        hitCount++;
      }
    }
    const ratio = hitCount / qt.size;
    const titleBonus = Math.min(1, titleHits / qt.size);
    return Math.min(1, Math.round((ratio * 0.7 + titleBonus * 0.3) * 100) / 100);
  }

  /** BM25/余弦混合分压缩到 0~1（知识库 search 返回分无界，展示用） */
  private static normalizeKnScore(score: number): number {
    return Math.min(1, Math.round(Math.max(0, score) / 8 * 100) / 100);
  }

  /**
   * 跨库检索汇总：
   * - libraryHits：ReAct 已按项目级 LIKE 命中的文献库条目，补匹配度分数（来源=文献库）；
   * - knowledgeHits：复用 KnowledgeService 本地 BM25，按主题/关键词检索项目知识库，映射为资料片段（来源=知识库）；
   * - 命中总数为 0 时 notice 给出结构化引导，否则 notice=null；
   * - meta 持久化命中摘要，供产物参考文献块回标「（文献库 · 匹配 x）/（知识库 · 匹配 x）」。
   */
  private async crossEnrichResearch(
    projectId: string,
    topic: string,
    plan: ResearchPlan,
    libraryHits: PaperHit[],
  ): Promise<{ libraryHits: PaperHit[]; knowledgeHits: PaperHit[]; notice: string | null; meta: ResearchMeta }> {
    const queryBag = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).join(' ');
    const lib: PaperHit[] = libraryHits.map((h) => ({
      ...h,
      origin: 'library' as const,
      matchScore: PipelineService.scoreLibraryHit(queryBag, h),
    }));

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
          knAll.push({
            title: c.docName || '未命名资料',
            authors: [],
            year: null,
            venue: '知识库',
            doi: '',
            url: '',
            abstract: (c.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            source: 'manual',
            citationCount: 0,
            origin: 'knowledge' as const,
            matchScore: PipelineService.normalizeKnScore(c.score),
          });
        }
      } catch (e: any) {
        this.logger.warn(`知识库跨库检索失败 [${q}]: ${e?.message || e}`);
      }
    }
    // 同文档去重保留最高分，按匹配度降序，最多 5 条
    const knByDoc = new Map<string, PaperHit>();
    for (const h of knAll) {
      const ex = knByDoc.get(h.title);
      if (!ex || (h.matchScore || 0) > (ex.matchScore || 0)) knByDoc.set(h.title, h);
    }
    const kn = [...knByDoc.values()].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 5);

    const total = lib.length + kn.length;
    const notice = total === 0 ? ZERO_HIT_NOTICE : null;
    const meta: ResearchMeta = {
      lib: lib.map((h) => ({ title: h.title, score: h.matchScore ?? 0 })),
      kn,
    };
    return { libraryHits: lib, knowledgeHits: kn, notice, meta };
  }

  /** 解析持久化的 researchMeta（容错：损坏/空串返回空） */
  private parseResearchMeta(raw: string | null | undefined): ResearchMeta {
    if (!raw) return { lib: [], kn: [] };
    try {
      const o = JSON.parse(raw) as ResearchMeta;
      return { lib: Array.isArray(o.lib) ? o.lib : [], kn: Array.isArray(o.kn) ? o.kn : [] };
    } catch {
      return { lib: [], kn: [] };
    }
  }

  /** 供起草引用的文献池：只取元数据完整（有作者或年份）的文献，避免模型引用 [Unknown n.d.] */
  /** 科研综述领域关键词：标题/摘要命中任一才进入引用池（过滤检索噪音如 MapReduce/物种起源/语言研究类） */
  private static readonly DOMAIN_KW = [
    'graph neural', 'gnn', 'molecular', 'molecule', 'drug', 'protein', 'ligand', 'chemical',
    'pharmaco', 'biomed', 'bioinform', 'deep learning', 'machine learning', 'neural network',
    'geometric', 'equivariant', 'graph', 'neural', 'chem',
    '图神经', '分子', '药物', '蛋白', '几何', '深度学习', '消息传递', '药',
  ];

  private refsForDraft(projectId: string) {
    const all = this.references.list(projectId);
    const meta = all.filter((r) => {
      try {
        const a = JSON.parse(r.authors || '[]') as string[];
        return a.length > 0 && !!r.year;
      } catch {
        return false;
      }
    });
    const rel = meta.filter((r) => {
      const t = (r.title || '').toLowerCase();
      const ab = (r.abstract || '').toLowerCase();
      return PipelineService.DOMAIN_KW.some((k) => t.includes(k) || ab.includes(k));
    });
    // 相关文献不足 6 条时放宽为全部有元数据文献；按被引量降序（高被引里程碑优先），池子 20 条保证覆盖广度
    return (rel.length >= 6 ? rel : meta)
      .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
      .slice(0, 20);
  }

  private referencesForPrompt(projectId: string, refs?: ReturnType<PipelineService['refsForDraft']>): string {
    const pool = refs ?? this.refsForDraft(projectId);
    return pool
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`)
      .join('\n');
  }

  /**
   * 引用渲染：把正文中的 [Ref:N] / [补充Ref:M] 占位符替换为真实文献（作者 年份），
   * 并在文末生成"参考文献"列表（GB/T 7714 顺序编码制）。
   * 修复：① 两次取池排序不同导致编号错位——改用调用方传入的同一池；② 补充引用按正文实际引用续编并纳入文末列表。
   */
  private renderCitations(
    projectId: string,
    documentId: string,
    content: string,
    refPool: ReturnType<PipelineService['refsForDraft']>,
    supplementHits: PaperHit[] = [],
    suppRefIds: (string | null)[] = [],
    libScore: Map<string, number> = new Map(),
    knowledgeHits: PaperHit[] = [],
  ): string {
    if (!content) return content;
    const refs = refPool;
    // 先在原文上扫描每个被引文献首次出现的章节位置与上下文（须在占位符被替换前做），供 citations 回填
    const { poolSpot, suppSpot } = this.scanCitationSpots(content, refs.length, supplementHits.length);
    // 第一遍：收集正文被引用的 [Ref:N]（顺序编码制按出现先后统一编号）
    const used = new Set<number>();
    content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      if (refs[idx]) used.add(idx);
      return '';
    });
    const order = [...used].sort((a, b) => a - b);
    const numOf = new Map(order.map((idx, k) => [idx, k + 1]));
    // 补充引用：收集正文 [补充Ref:M]（全局序号，与 writerAgent 生成顺序一致）
    const usedSupp = new Set<number>();
    content.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      if (supplementHits[idx]) usedSupp.add(idx);
      return '';
    });
    const suppOrder = [...usedSupp].sort((a, b) => a - b);
    const base = order.length;
    const suppNum = new Map(suppOrder.map((idx, k) => [idx, base + k + 1]));
    // 第二遍：替换 [Ref:N] → [N]；[补充Ref:M] → 续编号 [N]
    let out = content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      return numOf.has(idx) ? `[${numOf.get(idx)}]` : `[文献${n}]`;
    });
    out = out.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      return suppNum.has(idx) ? `[${suppNum.get(idx)}]` : '[补充文献]';
    });
    // 文末参考文献列表（顺序编码制，正文 [N] 与列表一一对应：正文引用的池文献 + 补充文献）
    const list: string[] = [];
    for (const idx of order) {
      const r = refs[idx];
      const authors = (() => {
        try {
          return (JSON.parse(r.authors || '[]') as string[]).join(', ') || '佚名';
        } catch {
          return '佚名';
        }
      })();
      // Research 阶段跨库命中回标：仅在标题命中持久化匹配表时追加后缀，不改变既有 a/b 顺序编码契约
      const score = libScore.get(r.title);
      const tag = typeof score === 'number' ? `（文献库 · 匹配 ${score.toFixed(2)}）` : '';
      list.push(`[${list.length + 1}] ${authors}. ${r.title}[J].${r.venue ? ` ${r.venue},` : ''} ${r.year ? `${r.year}.` : 'n.d.'}${r.doi ? ` https://doi.org/${r.doi.replace(/^https?:\/\//, '')}` : ''}${tag}`);
    }
    for (const idx of suppOrder) {
      const h = supplementHits[idx];
      const authors = (h.authors || []).join(', ') || '佚名';
      list.push(`[${list.length + 1}] ${authors}. ${h.title}[J].${h.venue ? ` ${h.venue},` : ''} ${h.year ? `${h.year}.` : 'n.d.'}${h.doi ? ` https://doi.org/${h.doi.replace(/^https?:\/\//, '')}` : ''}`);
    }
    // 参考文献块：顺序编码列表 + 知识库参考小节（资料片段不参与顺序编码，单列以便用户看到「从哪来」）
    const blocks: string[] = [];
    if (list.length) blocks.push(list.join('\n'));
    if (knowledgeHits.length) {
      const knLines = knowledgeHits
        .map((k) => `- 《${k.title}》（知识库 · 匹配 ${(k.matchScore ?? 0).toFixed(2)}）：${(k.abstract || '').slice(0, 100).trim()}`)
        .join('\n');
      blocks.push(`### 知识库参考（研究阶段本地检索）\n\n${knLines}`);
    }
    if (blocks.length) {
      out += `\n\n## 参考文献\n\n${blocks.join('\n\n')}`;
    }
    // 把正文实际引用到的文献幂等写入 citations 表（同一 document+reference 只留一条），
    // 让写作页引用管理 / 核验率 / 共引网络图 / 结构化导出一次性点亮，无需手工重新 addCitation。
    this.backfillCitations(documentId, refs, order, suppOrder, suppRefIds, poolSpot, suppSpot);
    return out;
  }

  /**
   * 扫描原文，记录每个被引文献（池文献 [Ref:N] / 补充文献 [补充Ref:M]）首次出现的章节与上下文。
   * 用一个交替正则同时识别章节标题（## ）与引用占位符，边扫描边维护「当前章节」。
   */
  private scanCitationSpots(content: string, poolSize: number, suppSize: number) {
    const poolSpot = new Map<number, { location: string; context: string }>();
    const suppSpot = new Map<number, { location: string; context: string }>();
    const tokenRe = /(#{1,6}\s+[^\n]+)|\[Ref:(\d+)\]|\[补充Ref:(\d+)\]/g;
    let m: RegExpExecArray | null;
    let section = '';
    while ((m = tokenRe.exec(content)) !== null) {
      if (m[1] !== undefined) {
        section = m[1].replace(/^#{1,6}\s+/, '').trim();
      } else if (m[2] !== undefined) {
        const idx = Number(m[2]) - 1;
        if (idx >= 0 && idx < poolSize && !poolSpot.has(idx)) {
          poolSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) });
        }
      } else if (m[3] !== undefined) {
        const idx = Number(m[3]) - 1;
        if (idx >= 0 && idx < suppSize && !suppSpot.has(idx)) {
          suppSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) });
        }
      }
    }
    return { poolSpot, suppSpot };
  }

  /** 取引用占位符前后各 ~40 字作为上下文片段（压成单行） */
  private contextAround(text: string, at: number, len: number): string {
    const start = Math.max(0, at - 40);
    const end = Math.min(text.length, at + len + 40);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
  }

  /**
   * 流水线引用回填 citations 表（幂等）：
   * - 池文献：refs[idx].id 直接可用；补充文献：经 suppRefIds[idx] 取入库后的 references.id。
   * - 同一 (documentId, referenceId) 已存在则跳过——回炉重写多轮也不会产生重复行。
   * - verified：有 DOI 记 1；format='pipeline' 标记来源，便于与手工 apa/ieee 区分。
   */
  private backfillCitations(
    documentId: string,
    refs: ReturnType<PipelineService['refsForDraft']>,
    order: number[],
    suppOrder: number[],
    suppRefIds: (string | null)[],
    poolSpot: Map<number, { location: string; context: string }>,
    suppSpot: Map<number, { location: string; context: string }>,
  ) {
    try {
      const existing = db.select().from(citations).where(eq(citations.documentId, documentId)).all();
      const have = new Set(existing.map((c) => c.referenceId));
      const now = Date.now();
      const insertOne = (referenceId: string, spot: { location: string; context: string } | undefined, doi: string) => {
        if (!referenceId || have.has(referenceId)) return;
        db.insert(citations)
          .values({
            id: randomUUID(),
            documentId,
            referenceId,
            location: spot?.location || '',
            context: spot?.context || '',
            format: 'pipeline',
            verified: doi ? 1 : 0,
            createdAt: now,
          })
          .run();
        have.add(referenceId);
      };
      for (const idx of order) {
        const r = refs[idx];
        if (!r) continue;
        insertOne(r.id, poolSpot.get(idx), r.doi || '');
      }
      for (const idx of suppOrder) {
        const refId = suppRefIds[idx];
        if (!refId) continue;
        const ref = db.select().from(references).where(eq(references.id, refId)).get();
        insertOne(refId, suppSpot.get(idx), ref?.doi || '');
      }
    } catch (e: any) {
      // 回填失败不阻断流水线主流程（正文已渲染好）
      this.logger.warn(`citations 回填失败（不影响流水线产物）: ${e?.message || e}`);
    }
  }

  /** Reflexion 指令（最新一条）：回炉起草时注入 */
  private reflexionNote(taskId: string): string {
    const rows = db
      .select()
      .from(reflexionLogs)
      .where(eq(reflexionLogs.taskId, taskId))
      .orderBy(reflexionLogs.createdAt)
      .all();
    if (rows.length === 0) return '';
    const last = rows[rows.length - 1];
    let instructions: string[] = [];
    try {
      instructions = JSON.parse(last.instructions || '[]');
    } catch {
      /* ignore */
    }
    return `${last.note}${instructions.length ? '\n具体指令：' + instructions.join('；') : ''}`;
  }

  /** 全部反思日志文本（供下一轮 Reflexion 去重参考） */
  private reflexionLogs(taskId: string): string[] {
    return db
      .select()
      .from(reflexionLogs)
      .where(eq(reflexionLogs.taskId, taskId))
      .orderBy(reflexionLogs.createdAt)
      .all()
      .map((r) => `第${r.round}轮：${r.note}`);
  }

  /** Phase 2b：程序记忆（写作风格指令，供起草注入） */
  private proceduralMemory(projectId: string): string {
    const rows = db
      .select()
      .from(memoryLogs)
      .where(and(eq(memoryLogs.type, 'procedural'), eq(memoryLogs.projectId, projectId)))
      .orderBy(memoryLogs.createdAt)
      .all();
    return rows.slice(-1).map((r) => r.content).join('');
  }

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
