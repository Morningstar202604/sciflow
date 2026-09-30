import { Controller, Post, Get, Delete, Body, Param } from '@nestjs/common';
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
}
