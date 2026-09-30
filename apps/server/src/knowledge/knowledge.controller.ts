import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
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

  /** 文献库↔知识库打通（#5）：手动绑定/解除文献，入参 {referenceId | null} */
  @Patch(':id/bind')
  bind(@Param('id') id: string, @Body() body: { referenceId: string | null }) {
    return this.knowledge.bind(id, body.referenceId ?? null);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }
}
