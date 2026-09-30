import { Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/database';
import {
  pipelineTasks,
  submissions,
  reviewComments,
  qualityReports,
  documents,
  references,
  experiments,
  journals,
} from '../db/schema';

/** 投稿终态：不再做超期推断（与 submission.service 保持一致） */
const TERMINAL_STATUSES = new Set(['rejected', 'withdrawn', 'accepted', 'in_production', 'transferred']);
const DAY_MS = 24 * 3600 * 1000;
/** 低分阈值：最近一次质量总分低于该值即列入待办 */
const LOW_SCORE_THRESHOLD = 60;

/**
 * Dashboard 全链路总览聚合（B7-1 后端打通）。
 * 不新建表，只在既有 pipelineTask / submission / review_comment / quality_report / document / experiment / reference 上做读时聚合。
 * 任一子查询失败都降级为空数组/0，保证 Dashboard 永不因单表异常而整页崩。
 */
@Injectable()
export class DashboardService {
  overview() {
    try {
      const pendingOutline = this.pendingOutlineCount();
      const openReviewComments = this.openReviewCommentCount();
      const experimentCount = this.countRows(experiments);
      const docCount = this.countRows(documents);
      const refCount = this.countRows(references);
      const overdueSubmissions = this.overdueSubmissions();
      const lowQualityDocs = this.lowQualityDocs();
      return {
        pendingOutline,
        overdueSubmissions,
        openReviewComments,
        lowQualityDocs,
        experimentCount,
        docCount,
        refCount,
      };
    } catch (e: any) {
      return {
        pendingOutline: 0,
        overdueSubmissions: [],
        openReviewComments: 0,
        lowQualityDocs: [],
        experimentCount: 0,
        docCount: 0,
        refCount: 0,
      };
    }
  }

  /** 状态为「大纲待确认」的流水线任务数（Human-in-the-loop 卡点） */
  private pendingOutlineCount(): number {
    return db.select().from(pipelineTasks).where(eq(pipelineTasks.status, 'awaiting_confirmation')).all().length;
  }

  /** open 状态审稿意见总数 */
  private openReviewCommentCount(): number {
    return db.select().from(reviewComments).where(eq(reviewComments.status, 'open')).all().length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private countRows(table: any): number {
    return db.select().from(table).all().length;
  }

  /**
   * 活跃投稿中超期的列表：超「一审周期」(submittedAt + journal.firstDecisionWeeks) 或超「修回截止日」(revisionDeadline)。
   * 终态投稿不计。overdueDays 取两者较大者。
   */
  private overdueSubmissions() {
    const now = Date.now();
    const rows = db.select().from(submissions).all();
    const out: { id: string; journalName: string; title: string; status: string; overdueDays: number }[] = [];
    for (const s of rows) {
      if (TERMINAL_STATUSES.has(s.currentStatus || '')) continue;
      let overdueDays = 0;
      // 修回截止日超期
      if (typeof s.revisionDeadline === 'number' && s.revisionDeadline && now > s.revisionDeadline) {
        overdueDays = Math.max(overdueDays, Math.floor((now - s.revisionDeadline) / DAY_MS));
      }
      // 一审周期超期（需关联期刊的 firstDecisionWeeks）
      if (s.journalId && s.submittedAt) {
        const journal = db.select().from(journals).where(eq(journals.id, s.journalId)).get();
        const fdw = journal?.firstDecisionWeeks;
        if (fdw) {
          const dueAt = s.submittedAt + fdw * 7 * DAY_MS;
          if (now > dueAt) overdueDays = Math.max(overdueDays, Math.floor((now - dueAt) / DAY_MS));
        }
      }
      if (overdueDays > 0) {
        out.push({ id: s.id, journalName: s.journalName, title: s.title || '', status: s.currentStatus || 'submitted', overdueDays });
      }
    }
    return out.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 20);
  }

  /** 最近一次质量总分低于阈值的文档列表（id/title/score/date） */
  private lowQualityDocs() {
    const docs = db.select().from(documents).all();
    const out: { id: string; title: string; score: number; date: number }[] = [];
    for (const d of docs) {
      const latest = db
        .select()
        .from(qualityReports)
        .where(eq(qualityReports.documentId, d.id))
        .orderBy(desc(qualityReports.createdAt))
        .get();
      if (latest && latest.totalScore < LOW_SCORE_THRESHOLD) {
        out.push({ id: d.id, title: d.title, score: latest.totalScore, date: latest.createdAt });
      }
    }
    return out.sort((a, b) => b.date - a.date).slice(0, 20);
  }
}
