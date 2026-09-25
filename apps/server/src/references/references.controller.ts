import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ReferencesService } from './references.service';
import { PaperHit } from '../literature/literature.service';

@Controller('references')
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  /** 真实检索文献（不自动入库） */
  @Post('search')
  search(@Body() body: { query: string; limit?: number }) {
    return this.references.search(body.query, body.limit || 8);
  }

  @Get()
  list(@Query('projectId') projectId: string) {
    return this.references.list(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.references.get(id);
  }

  /** 单条入库 */
  @Post()
  create(@Body() body: { projectId: string; hit: Partial<PaperHit> & { title: string } }) {
    return this.references.create(body.projectId, body.hit);
  }

  /** 批量导入 */
  @Post('import')
  import(@Body() body: { projectId: string; hits: (Partial<PaperHit> & { title: string })[] }) {
    return this.references.import(body.projectId, body.hits);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.references.remove(id);
  }

  /** AI 综述（只基于文献库真实文献） */
  @Post('summarize')
  summarize(@Body() body: { projectId: string; topic: string }) {
    return this.references.summarize(body.projectId, body.topic);
  }
}
