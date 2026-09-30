import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Header } from '@nestjs/common';
import { ReferencesService, PaperHit } from './references.service';

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

  /** 系统综述·筛选队列列表（须声明在 :id 之前，避免 screen 被当成文献 id） */
  @Get('screen')
  screenList(@Query('projectId') projectId: string) {
    return this.references.screenList(projectId);
  }

  /** 系统综述·抽取字段列表 */
  @Get('extraction/fields')
  extractionFields(@Query('projectId') projectId: string) {
    return this.references.listExtractionFields(projectId);
  }

  /** 系统综述·抽取表矩阵 */
  @Get('extraction/table')
  extractionTable(@Query('projectId') projectId: string) {
    return this.references.extractionTable(projectId);
  }

  /** 引用网络图聚合（共引边 + 去重边），须声明在 :id 之前 */
  @Get('graph')
  graph(@Query('projectId') projectId: string) {
    return this.references.graph(projectId);
  }

  /** 导出项目全部文献为 BibTeX / RIS 纯文本（前端 fetch 后 Blob 下载） */
  @Get('export')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportRefs(@Query('projectId') projectId: string, @Query('format') format?: string) {
    return this.references.exportRefs(projectId, format || 'bibtex');
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

  /** 导入 BibTeX 文本（指纹去重，返回 imported/skipped） */
  @Post('import-bibtex')
  importBibtex(@Body() body: { projectId: string; text: string }) {
    return this.references.importBibtex(body.projectId, body.text || '');
  }

  /** 更新阅读状态 / 标签 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { readingStatus?: string; tags?: string }) {
    return this.references.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.references.remove(id);
  }

  /** 系统综述·单条筛选（upsert） */
  @Post('screen')
  screen(@Body() body: { projectId: string; referenceId: string; status: string; reason?: string }) {
    return this.references.screenUpsert(body.projectId, body.referenceId, body.status, body.reason || '');
  }

  /** 系统综述·批量筛选 */
  @Post('screen/bulk')
  screenBulk(@Body() body: { projectId: string; referenceIds: string[]; status: string; reason?: string }) {
    return this.references.screenBulk(body.projectId, body.referenceIds || [], body.status, body.reason || '');
  }

  /** 系统综述·新建抽取字段 */
  @Post('extraction/fields')
  addExtractionField(
    @Body() body: { projectId: string; key: string; label: string; kind?: string; options?: string[] },
  ) {
    return this.references.addExtractionField(body.projectId, body.key, body.label, body.kind, body.options || []);
  }

  /** 系统综述·删除抽取字段（级联清理取值） */
  @Delete('extraction/fields/:id')
  removeExtractionField(@Param('id') id: string) {
    return this.references.removeExtractionField(id);
  }

  /** 系统综述·设置某字段在某文献上的取值 */
  @Put('extraction/values')
  setExtractionValue(@Body() body: { fieldId: string; referenceId: string; value: string }) {
    return this.references.setExtractionValue(body.fieldId, body.referenceId, body.value || '');
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
