import { Body, Controller, Get, Post, Patch, Delete, Param, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ResearchService } from './research.service';

@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Post('design-review')
  async designReview(@Body() body: { idea: string; papers?: any[] }) {
    const result = await this.research.designReview(body?.idea || '', body?.papers);
    if ('error' in result) {
      throw new HttpException((result as { error: string }).error, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Post('comparison')
  async compare(@Body() body: { papers: any[] }) {
    const result = await this.research.comparePapers(body?.papers || []);
    if ('error' in result) {
      throw new HttpException((result as { error: string }).error, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Post('review')
  async review(@Body() body: { title: string; content: string }) {
    const result = await this.research.simulatedReview(body?.title || '', body?.content || '');
    if ('error' in result) {
      throw new HttpException((result as { error: string }).error, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  /* —— 审稿意见闭环 —— */

  /** 批量录入审稿意见 */
  @Post('review-comments')
  addReviewComments(@Body() body: { documentId: string; comments: { reviewer: string; commentText: string; category?: string }[] }) {
    return this.research.addReviewComments(body.documentId, body.comments || []);
  }

  /** 列出某文档的审稿意见 */
  @Get('review-comments')
  listReviewComments(@Query('documentId') documentId: string) {
    return this.research.listReviewComments(documentId);
  }

  /** 更新单条意见 */
  @Patch('review-comments/:id')
  updateReviewComment(@Param('id') id: string, @Body() body: { status?: string; responseText?: string; category?: string }) {
    return this.research.updateReviewComment(id, body);
  }

  /** 删除单条意见 */
  @Delete('review-comments/:id')
  deleteReviewComment(@Param('id') id: string) {
    return this.research.deleteReviewComment(id);
  }

  /** 生成 point-by-point 回复信 */
  @Post('response-letter')
  async responseLetter(@Body() body: { documentId: string }) {
    return this.research.generateResponseLetter(body.documentId);
  }
}
