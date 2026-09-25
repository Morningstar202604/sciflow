import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, documents, references, polishRecords, qualityReports } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { LiteratureService } from '../literature/literature.service';
import { ReferencesService } from '../references/references.service';
import { QualityService } from '../quality/quality.service';

export interface PipelineStepState {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'retry' | 'failed';
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
  ) {}

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
    let retryCount = task.retryCount;

    // ① 主题验证
    await this.advance(taskId, 'topic-verify', 'running');
    const verifiedTopic = await this.ai.chat(
      `请把以下研究主题提炼为一句可执行的研究题目（直接输出题目本身，不要解释）：\n${task.topic}`,
    );
    await this.advance(taskId, 'topic-verify', 'done', verifiedTopic);

    // ② 文献调研：真实多源检索 + 入库 + AI 综述
    await this.advance(taskId, 'literature', 'running');
    const hits = await this.literature.search(task.topic, 8);
    if (hits.length > 0) {
      this.references.import(task.projectId, hits);
    }
    const refs = this.references.list(task.projectId);
    const summary = refs.length
      ? await this.ai.summarizeLiterature(task.topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
      : '（未检索到文献，将按通用学术结构起草）';
    await this.advance(taskId, 'literature', 'done', `检索到 ${hits.length} 篇文献\n${summary.slice(0, 500)}`);

    // ③ 大纲生成 → 等待人工确认（Human-in-the-loop）
    await this.advance(taskId, 'outline', 'running');
    const outline = await this.ai.writeOutline(verifiedTopic, summary);
    await this.advance(taskId, 'outline', 'awaiting_confirmation', JSON.stringify(outline));
    this.setStatus(taskId, 'awaiting_confirmation', 'outline');
    return; // 停下等人工确认
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

    while (true) {
      // ④ 分章起草（回炉时注入上次评分反馈）
      await this.advance(taskId, 'drafting', 'running', retry > 0 ? `第 ${retry} 次回炉起草（依据上次评分反馈重写）` : undefined);
      const feedback = this.lastQualityFeedback(taskId);
      let content = '';
      for (const section of outline.sections) {
        const refsPrompt = this.referencesForPrompt(task.projectId);
        const sectionText = await this.ai.draftSection(
          section.title,
          JSON.stringify(outline),
          `${refsPrompt}\n质量评审反馈（如为回炉重写则需针对性改进）：${feedback || '无'}`,
        );
        content += `## ${section.title}\n\n${sectionText}\n\n`;
      }
      db.update(documents).set({ content, updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
      await this.advance(taskId, 'drafting', 'done', `已起草 ${outline.sections.length} 个章节`);

      // ⑤ 质量门评分
      await this.advance(taskId, 'quality-gate', 'running');
      const report = await this.quality.review(documentId, doc.title, content);
      await this.advance(taskId, 'quality-gate', 'done', `总分 ${report.totalScore}/100`);

      if (report.totalScore < QUALITY_THRESHOLD && retry < maxRetry) {
        retry += 1;
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

    // ⑥ 润色定稿（三段式，借鉴 GPT-Academic）
    await this.advance(taskId, 'polish', 'running');
    const finalDoc = db.select().from(documents).where(eq(documents.id, documentId)).get()!;
    const polished = await this.ai.polish(finalDoc.content ?? '', 'polish');
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
    db.update(documents).set({ content: polished.polished, status: 'polished', updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
    await this.advance(taskId, 'polish', 'done', '润色完成（原文+润色文+理由已存档）');

    // ⑦ 引用格式化
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

    // ⑧ 完成
    await this.advance(taskId, 'complete', 'done');
    db.update(documents).set({ status: 'final', updatedAt: Date.now() }).where(eq(documents.id, documentId)).run();
    this.setStatus(taskId, 'completed', 'complete');
  }

  private referencesForPrompt(projectId: string): string {
    const refs = this.references.list(projectId);
    return refs
      .slice(0, 12)
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`)
      .join('\n');
  }

  private lastQualityFeedback(taskId: string): string {
    const task = this.get(taskId);
    const q = task.steps.find((s) => s.key === 'quality-gate');
    if (q && q.output) {
      const id = db
        .select({ id: qualityReports.id })
        .from(qualityReports)
        .where(eq(qualityReports.documentId, task.documentId || ''))
        .orderBy(qualityReports.createdAt)
        .all()
        .pop();
      if (id) {
        const report = db.select().from(qualityReports).where(eq(qualityReports.id, id.id)).get();
        if (report) return report.feedback ?? '';
      }
    }
    return '';
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
