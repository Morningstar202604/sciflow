import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Query('projectId') projectId: string) {
    return this.documents.list(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @Post()
  create(@Body() body: { projectId: string; title: string }) {
    return this.documents.create(body.projectId, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; content?: string; outline?: string; status?: string }) {
    return this.documents.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }

  // --- AI 写作工具 ---
  @Post(':id/outline')
  generateOutline(@Param('id') id: string, @Body() body: { topic?: string; summary?: string }) {
    return this.documents.generateOutline(id, body.topic || '', body.summary || '');
  }

  @Post(':id/section')
  draftSection(@Param('id') id: string, @Body() body: { sectionTitle: string }) {
    return this.documents.draftSection(id, body.sectionTitle);
  }

  @Post(':id/abstract')
  generateAbstract(@Param('id') id: string) {
    return this.documents.generateAbstract(id);
  }

  @Post(':id/polish')
  polish(@Param('id') id: string, @Body() body: { text: string; mode?: 'polish' | 'reduce' }) {
    return this.documents.polish(id, body.text, body.mode || 'polish');
  }

  @Post(':id/translate')
  translate(@Param('id') id: string, @Body() body: { text: string; targetLang?: 'zh' | 'en' }) {
    return this.documents.translate(id, body.text, body.targetLang || 'zh');
  }

  @Get(':id/polish-records')
  listPolishRecords(@Param('id') id: string) {
    return this.documents.listPolishRecords(id);
  }

  // --- 引用管理 ---
  @Post(':id/citations')
  addCitation(@Param('id') id: string, @Body() body: { referenceId: string; location?: string; context?: string; format?: string }) {
    return this.documents.addCitation(id, body);
  }

  @Get(':id/citations')
  listCitations(@Param('id') id: string) {
    return this.documents.listCitations(id);
  }

  @Delete(':id/citations/:citationId')
  removeCitation(@Param('id') _id: string, @Param('citationId') citationId: string) {
    return this.documents.removeCitation(citationId);
  }

  @Get(':id/export-citations')
  exportCitations(@Param('id') id: string, @Query('format') format: string) {
    return this.documents.exportCitations(id, format || 'apa');
  }

  /** 导出 Markdown 全文 */
  @Get(':id/export')
  exportMarkdown(@Param('id') id: string) {
    return this.documents.exportMarkdown(id);
  }

  /** 导出 Word(.docx) 全文（交稿/投稿） */
  @Get(':id/export-docx')
  async exportDocx(@Param('id') id: string) {
    return this.documents.exportDocx(id);
  }
}
