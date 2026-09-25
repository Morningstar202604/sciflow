import { Controller, Post, Body } from '@nestjs/common';
import { SubmissionService } from './submission.service';

@Controller('submission')
export class SubmissionController {
  constructor(private readonly submission: SubmissionService) {}

  @Post('journals')
  recommend(@Body() body: { title?: string; abstract?: string; field?: string }) {
    return this.submission.recommendJournals(body.title || '', body.abstract || '', body.field || '');
  }

  @Post('cover-letter')
  coverLetter(@Body() body: { title?: string; abstract?: string; journal: string }) {
    return this.submission.coverLetter(body.title || '', body.abstract || '', body.journal);
  }

  @Post('reply-review')
  replyReview(@Body() body: { reviewComments: string; response?: string }) {
    return this.submission.replyReview(body.reviewComments, body.response || '');
  }
}
