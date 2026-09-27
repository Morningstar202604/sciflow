import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, desc, like, and, SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { memoryLogs } from '../db/schema';

/**
 * 记忆服务（Phase 2：Agentic Memory）
 * - episodic 情景记忆：流水线完成时自动沉淀（主题/结构/评分）
 * - procedural 程序记忆：用户可维护的写作风格指令，起草时自动注入
 */
@Injectable()
export class MemoryService {
  /** 新增记忆（主要供程序记忆：写作风格指令） */
  add(type: 'episodic' | 'procedural', content: string, projectId?: string, keywords: string[] = []) {
    if (!content.trim()) throw new BadRequestException('记忆内容不能为空');
    const row = {
      id: randomUUID(),
      type,
      projectId: projectId || null,
      content: content.trim(),
      keywords: JSON.stringify(keywords.slice(0, 10)),
      createdAt: Date.now(),
    };
    db.insert(memoryLogs).values(row).run();
    return { ...row, keywords };
  }

  /** 记忆列表（按类型 + 项目 + 关键词过滤） */
  list(type?: 'episodic' | 'procedural', q?: string, projectId?: string) {
    const conds: SQL[] = [];
    if (type) conds.push(eq(memoryLogs.type, type));
    if (projectId) conds.push(eq(memoryLogs.projectId, projectId));
    if (q && q.trim()) conds.push(like(memoryLogs.keywords, `%${q.trim()}%`));
    const where = conds.length ? and(...conds) : undefined;
    const rows = where
      ? db.select().from(memoryLogs).where(where).orderBy(desc(memoryLogs.createdAt)).all()
      : db.select().from(memoryLogs).orderBy(desc(memoryLogs.createdAt)).all();
    return rows.map((r) => {
      let keywords: string[] = [];
      try {
        keywords = JSON.parse(r.keywords || '[]');
      } catch {
        /* ignore */
      }
      return { ...r, keywords };
    });
  }

  remove(id: string) {
    const row = db.select().from(memoryLogs).where(eq(memoryLogs.id, id)).get();
    if (!row) throw new NotFoundException('记忆不存在');
    db.delete(memoryLogs).where(eq(memoryLogs.id, id)).run();
    return { ok: true };
  }
}
