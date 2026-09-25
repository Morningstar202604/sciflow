import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** 上传资料（text | pdf | markdown；PDF 传 base64） */
  @Post('upload')
  upload(@Body() body: { projectId: string; name: string; type: string; content: string }) {
    return this.knowledge.upload(body.projectId, body.name, body.type || 'text', body.content);
  }

  /** 项目知识库列表 */
  @Get()
  list(@Query('projectId') projectId: string) {
    return this.knowledge.list(projectId);
  }

  /** RAG 问答 */
  @Post('query')
  query(@Body() body: { projectId: string; question: string }) {
    return this.knowledge.query(body.projectId, body.question);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }
}
