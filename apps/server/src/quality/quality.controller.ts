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

  @Get(':id')
  get(@Param('id') id: string) {
    return this.quality.get(id);
  }
}
