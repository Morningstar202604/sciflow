import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
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
}
