import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ReferencesService } from './references.service';
import { PaperHit } from '../literature/literature.service';

@Controller('references')
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  /** 文献库内检索（不自动入库；projectId 可选，用于限定当前项目） */
  @Post('search')
  search(@Body() body: { query: string; limit?: number; projectId?: string }) {
    return this.references.search(body.query, body.limit || 8, body.projectId);
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

  /** Elicit 式：结构化提取（方法/结果/贡献/局限对比表） */
  @Post('extract')
  extract(@Body() body: { projectId: string }) {
    return this.references.extract(body.projectId);
  }

  /** Consensus 式：证据综合（论断 + 支持/矛盾 + 证据强度） */
  @Post('deep-dive')
  deepDive(@Body() body: { projectId: string; refId: string }) {
    return this.references.deepDive(body.projectId, body.refId);
  }

  @Post('gap')
  gap(@Body('projectId') projectId: string, @Body('topic') topic: string) {
    return this.references.gap(projectId, topic || '');
  }

  @Post('evidence')
  evidence(@Body() body: { projectId: string; question: string }) {
    return this.references.evidence(body.projectId, body.question);
  }
}
