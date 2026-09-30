import { Controller, Post, Get, Delete, Patch, Body, Param, Query } from '@nestjs/common';
import { SubmissionService } from './submission.service';

@Controller('submission')
export class SubmissionController {
  constructor(private readonly submission: SubmissionService) {}

  @Post('journals')
  recommend(@Body() body: { title?: string; abstract?: string; field?: string }) {
    return this.submission.recommendJournals(body.title || '', body.abstract || '', body.field || '');
  }

  /** 期刊库列表 */
  @Get('journals')
  listJournals() {
    return this.submission.listJournals();
  }

  @Post('cover-letter')
  coverLetter(@Body() body: { title?: string; abstract?: string; journal: string }) {
    return this.submission.coverLetter(body.title || '', body.abstract || '', body.journal);
  }

  @Post('reply-review')
  replyReview(@Body() body: { reviewComments: string; response?: string }) {
    return this.submission.replyReview(body.reviewComments, body.response || '');
  }

  /* —— 自建期刊库管理 —— */

  /** 新增期刊 */
  @Post('journals-lib')
  addJournal(@Body() body: Record<string, any>) {
    return this.submission.addJournal({
      name: body.name,
      issn: body.issn,
      publisher: body.publisher,
      scopeText: body.scopeText,
      if2024: body.if2024 ?? null,
      quartile: body.quartile,
      firstDecisionWeeks: body.firstDecisionWeeks ?? null,
      acceptanceRate: body.acceptanceRate ?? null,
      oa: body.oa,
    });
  }

  /** 删除期刊 */
  @Delete('journals-lib/:id')
  removeJournal(@Param('id') id: string) {
    return this.submission.deleteJournal(id);
  }

  /** 结构化期刊匹配推荐 */
  @Post('journals-match')
  journalsMatch(@Body() body: { title?: string; abstract?: string }) {
    return this.submission.matchJournals(body.title || '', body.abstract || '');
  }

  /* —— 投稿流程状态跟踪 —— */

  /** 登记投稿（L1） */
  @Post('track')
  createTrack(@Body() body: Record<string, any>) {
    return this.submission.createTrack({
      projectId: body.projectId,
      journalId: body.journalId || '',
      journalName: body.journalName,
      documentId: body.documentId || '',
      submittedAt: body.submittedAt || undefined,
      currentStatus: body.currentStatus || 'submitted',
      note: body.note || '',
      previousSubmissionId: body.previousSubmissionId || '',
      revisionDeadline: typeof body.revisionDeadline === 'number' ? body.revisionDeadline : null,
    });
  }

  /** 投稿列表（含事件流 + 超期推断） */
  @Get('track')
  listTracks(@Query('projectId') projectId: string) {
    return this.submission.listTracks(projectId || '');
  }

  /** AI 解析编辑部邮件（只给建议，不改库） */
  @Post('track/parse-email')
  parseEmail(@Body() body: { emailText?: string; currentStatus?: string }) {
    return this.submission.parseTrackEmail({ emailText: body.emailText || '', currentStatus: body.currentStatus || '' });
  }

  /** 追加状态事件 */
  @Post('track/:id/event')
  addEvent(@Param('id') id: string, @Body() body: { status: string; date?: number; note?: string }) {
    return this.submission.addTrackEvent(id, {
      status: body.status,
      date: body.date || undefined,
      note: body.note || '',
    });
  }

  /** 修改 note / currentStatus / revisionDeadline */
  @Patch('track/:id')
  updateTrack(@Param('id') id: string, @Body() body: { notes?: string; currentStatus?: string; revisionDeadline?: number | null }) {
    return this.submission.updateTrack(id, { notes: body.notes, currentStatus: body.currentStatus, revisionDeadline: body.revisionDeadline });
  }

  /** 删除投稿（级联清事件） */
  @Delete('track/:id')
  removeTrack(@Param('id') id: string) {
    return this.submission.removeTrack(id);
  }
}
