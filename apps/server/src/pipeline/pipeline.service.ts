import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, documents, references, polishRecords, qualityReports, reflexionLogs, memoryLogs , pipelineConfigs} from '../db/schema';
import { AiService } from '../ai/ai.service';
import { LiteratureService } from '../literature/literature.service';
import { ReferencesService } from '../references/references.service';
import { QualityService } from '../quality/quality.service';
import { AgentOrchestratorService } from '../orchestrator/orchestrator.service';

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

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private running = new Set<string>();

  constructor(
    private readonly ai: AiService,
    private readonly literature: LiteratureService,
    private readonly references: ReferencesService,
    private readonly quality: QualityService,
    private readonly orchestrator: AgentOrchestratorService,
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
        this.setStatus(t.id, 'interrupted', '', '服务重启中断，可点击重新运行');
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
    if (hits.length > 0) {
      this.references.import(task.projectId, hits);
    }
    const refs = this.references.list(task.projectId);
    const summary = refs.length
      ? await this.ai.summarizeLiterature(task.topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
      : '（未检索到文献，将按通用学术结构起草）';
    await this.advance(taskId, 'literature', 'done', `检索到 ${hits.length} 篇文献\n${summary.slice(0, 500)}`);

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
      const writerRes = await this.orchestrator.writerAgent(
        taskId,
        documentId,
        doc.title,
        outline,
        { refsPrompt: this.referencesForPrompt(task.projectId), styleHint, reflexion },
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
      const agenticHits = this.orchestrator.extractWriterHits(taskId);
      if (agenticHits.length > 0) {
        this.references.import(task.projectId, agenticHits);
      }
      // 引用渲染：占位符 [Ref:N] → 顺序编码制 [N] + 文末参考文献列表
      const rendered = this.renderCitations(task.projectId, writerRes.content, agenticHits.map((h) => h.title));
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
    // 润色只处理正文主体，图表/参考文献尾部原样保留（此前整体覆盖把图和文献列表洗掉）
    const content = finalDoc.content ?? '';
    const figIdx = content.indexOf('\n\n## 图表');
    const bodyPart = figIdx >= 0 ? content.slice(0, figIdx) : content;
    const tailPart = figIdx >= 0 ? content.slice(figIdx) : '';
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

  private referencesForPrompt(projectId: string): string {
    const refs = this.refsForDraft(projectId);
    return refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`)
      .join('\n');
  }

  /**
   * 引用渲染：把正文中的 [Ref:N] / [补充Ref:M] 占位符替换为真实文献（作者 年份），
   * 并在文末生成"参考文献"列表（GB/T 7714 顺序编码制）。
   * 修复：此前成文引用全是占位符，评审判定"引用造假"。
   */
  private renderCitations(projectId: string, content: string, supplementTitles: string[] = []): string {
    if (!content) return content;
    const refs = this.refsForDraft(projectId);
    // 第一遍：收集被引用的文献（正文与参考文献列表统一顺序编码制 [N]，消除"正文作者-年份 vs 列表数字"矛盾）
    const used = new Set<number>();
    content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      if (refs[idx]) used.add(idx);
      return '';
    });
    const order = [...used].sort((a, b) => a - b);
    const numOf = new Map(order.map((idx, k) => [idx, k + 1]));
    // 第二遍：替换 [Ref:N] → [N]；[补充Ref:M] 追加编号
    let out = content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      return numOf.has(idx) ? `[${numOf.get(idx)}]` : `[文献${n}]`;
    });
    const usedSet = new Set(order);
    out = out.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => {
      const idx = Number(n) - 1;
      const title = supplementTitles[idx];
      return title ? `[补充${usedSet.size + idx + 1}]` : '[补充文献]';
    });
    // 文末参考文献列表（顺序编码制，与正文 [N] 一一对应）
    if (order.length) {
      const list = order.map((i, k) => {
        const r = refs[i];
        const authors = (() => {
          try {
            return (JSON.parse(r.authors || '[]') as string[]).join(', ') || '佚名';
          } catch {
            return '佚名';
          }
        })();
        return `[${k + 1}] ${authors}. ${r.title}[J].${r.venue ? ` ${r.venue},` : ''} ${r.year ? `${r.year}.` : 'n.d.'}${r.doi ? ` https://doi.org/${r.doi.replace(/^https?:\/\//, '')}` : ''}`;
      });
      out += `\n\n## 参考文献\n\n${list.join('\n')}`;
    }
    return out;
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
