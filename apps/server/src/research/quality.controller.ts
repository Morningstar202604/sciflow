import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { QualityService } from './quality.service';

@Controller('quality')
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Post()
  review(@Body() body: { documentId: string; title: string; content: string }) {
    return this.quality.review(body.documentId, body.title, body.content);
  }

  @Get()
  history(@Query('documentId') documentId: string) {
    return this.quality.history(documentId);
  }

  /** 最新一次评分（须声明在 :id 之前，避免 latest 被当成报告 id）；无记录返回 null */
  @Get('latest')
  latest(@Query('documentId') documentId: string) {
    return this.quality.latest(documentId);
  }

  /** 差距 #7：把最新报告 feedback 结构化拆条写入 review_comment（幂等：同报告重复导出不新增） */
  @Post('export-comments')
  exportComments(@Query('documentId') documentId: string) {
    return this.quality.exportComments(documentId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.quality.get(id);
  }
}
