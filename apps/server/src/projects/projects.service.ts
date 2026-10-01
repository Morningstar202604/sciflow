import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, documents, references, pipelineTasks, agentRuns, reflexionLogs, screeningQueue, extractionFields, extractionValues, reviewComments, experiments, submissions, submissionStatusEvents, citations, qualityReports, polishRecords, knowledgeDocs, knowledgeChunks, memoryLogs } from '../db/schema';

@Injectable()
export class ProjectsService {
  list() {
    return db.select().from(projects).orderBy(projects.updatedAt);
  }

  get(id: string) {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new NotFoundException('项目不存在');
    return row;
  }

  create(input: { name: string; description?: string }) {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description || '',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(projects).values(row).run();
    return row;
  }

  update(id: string, patch: { name?: string; description?: string; preface?: string }) {
    this.get(id);
    // preface（项目级系统提示，差距 #22）只接受字符串，其余字段维持既有透传行为
    if (patch.preface !== undefined && typeof patch.preface !== 'string') {
      throw new BadRequestException('preface 必须为字符串');
    }
    const clean: Record<string, unknown> = { ...patch, updatedAt: Date.now() };
    db.update(projects).set(clean).where(eq(projects.id, id)).run();
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    // 先捕获本项目文档 id（review_comment 按 document_id 关联，删文档前需级联清理）
    const docIds = db.select().from(documents).where(eq(documents.projectId, id)).all().map((d) => d.id);
    // 捕获本项目抽取字段 id（extraction_value 按 field_id 关联，删字段前需级联清理取值）
    const fieldIds = db.select().from(extractionFields).where(eq(extractionFields.projectId, id)).all().map((f) => f.id);
    // 级联清理：文档、文献、流水线任务及其子 Agent 轨迹、反思日志
    const tasks = db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, id)).all();
    for (const t of tasks) {
      db.delete(agentRuns).where(eq(agentRuns.taskId, t.id)).run();
      db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, t.id)).run();
    }
    // 科研高级功能级联清理：审稿意见（按文档）、筛选队列（按项目）、抽取取值与字段（按项目）
    for (const docId of docIds) {
      db.delete(reviewComments).where(eq(reviewComments.documentId, docId)).run();
      db.delete(citations).where(eq(citations.documentId, docId)).run();
      db.delete(qualityReports).where(eq(qualityReports.documentId, docId)).run();
      db.delete(polishRecords).where(eq(polishRecords.documentId, docId)).run();
    }
    db.delete(screeningQueue).where(eq(screeningQueue.projectId, id)).run();
    for (const fieldId of fieldIds) {
      db.delete(extractionValues).where(eq(extractionValues.fieldId, fieldId)).run();
    }
    db.delete(extractionFields).where(eq(extractionFields.projectId, id)).run();
    // 知识库级联清理：分块先于文档
    const kdIds = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, id)).all().map((k) => k.id);
    for (const kdId of kdIds) {
      db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, kdId)).run();
    }
    db.delete(knowledgeDocs).where(eq(knowledgeDocs.projectId, id)).run();
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, id)).run();
    // 投稿跟踪级联清理：状态流水先于投稿记录删除
    const subIds = db.select().from(submissions).where(eq(submissions.projectId, id)).all().map((s) => s.id);
    for (const sid of subIds) {
      db.delete(submissionStatusEvents).where(eq(submissionStatusEvents.submissionId, sid)).run();
    }
    db.delete(submissions).where(eq(submissions.projectId, id)).run();
    db.delete(documents).where(eq(documents.projectId, id)).run();
    db.delete(references).where(eq(references.projectId, id)).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, id)).run();
    db.delete(experiments).where(eq(experiments.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
    return { ok: true };
  }
}
