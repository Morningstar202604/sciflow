import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { qualityReports } from '../db/schema';
import { AiService, ReviewResult } from '../ai/ai.service';

@Injectable()
export class QualityService {
  constructor(private readonly ai: AiService) {}

  /** 对文档执行 7 维质量评分并落库（借鉴 ARS 0-100 质量关卡） */
  async review(documentId: string, title: string, content: string) {
    if (!content || content.length < 50) {
      throw new BadRequestException('文档内容过短，暂无法评分（至少 50 字）');
    }
    const result: ReviewResult & { totalScore: number } = await this.ai.reviewPaper(title, content);
    const row = {
      id: randomUUID(),
      documentId,
      totalScore: result.totalScore,
      scores: JSON.stringify(result.scores),
      feedback: result.feedback,
      createdAt: Date.now(),
    };
    db.insert(qualityReports).values(row).run();
    return row;
  }

  /** 某文档的历史评分（可对比） */
  history(documentId: string) {
    return db.select().from(qualityReports).where(eq(qualityReports.documentId, documentId)).orderBy(desc(qualityReports.createdAt));
  }

  /** 某文档最新一次评分（写作页侧边栏/写作现场展示用）；无记录返回 null，不 404 */
  latest(documentId: string) {
    if (!documentId) return null;
    const row = db
      .select()
      .from(qualityReports)
      .where(eq(qualityReports.documentId, documentId))
      .orderBy(desc(qualityReports.createdAt))
      .get();
    if (!row) return null;
    return { ...row, scores: JSON.parse(row.scores || '{}') };
  }

  get(id: string) {
    const row = db.select().from(qualityReports).where(eq(qualityReports.id, id)).get();
    if (!row) throw new NotFoundException('评分报告不存在');
    return { ...row, scores: JSON.parse(row.scores) };
  }
}
