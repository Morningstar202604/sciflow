import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, documents, references, pipelineTasks, agentRuns, reflexionLogs } from '../db/schema';

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

  update(id: string, patch: { name?: string; description?: string }) {
    const existing = this.get(id);
    const row = { ...existing, ...patch, updatedAt: Date.now() };
    db.update(projects).set(row).where(eq(projects.id, id)).run();
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    // 级联清理：文档、文献、流水线任务及其子 Agent 轨迹、反思日志
    const tasks = db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, id)).all();
    for (const t of tasks) {
      db.delete(agentRuns).where(eq(agentRuns.taskId, t.id)).run();
      db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, t.id)).run();
    }
    db.delete(documents).where(eq(documents.projectId, id)).run();
    db.delete(references).where(eq(references.projectId, id)).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
    return { ok: true };
  }
}
