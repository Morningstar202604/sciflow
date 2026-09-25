import { Injectable, BadRequestException } from '@nestjs/common';
import { AiService } from '../ai/ai.service';

@Injectable()
export class SubmissionService {
  constructor(private readonly ai: AiService) {}

  /** 期刊推荐 */
  recommendJournals(title: string, abstract: string, field: string) {
    if (!title && !abstract) throw new BadRequestException('请提供论文标题或摘要');
    return this.ai.recommendJournal(title || '(未命名)', abstract || '(未提供摘要)', field || '通用');
  }

  /** Cover Letter */
  coverLetter(title: string, abstract: string, journal: string) {
    if (!journal) throw new BadRequestException('请指定目标期刊');
    return this.ai.coverLetter(title || '(未命名)', abstract || '', journal);
  }

  /** 审稿意见回复 */
  replyReview(reviewComments: string, response = '') {
    if (!reviewComments) throw new BadRequestException('请粘贴审稿意见');
    return this.ai.replyReview(reviewComments, response);
  }
}
