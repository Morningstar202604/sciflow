import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  /** 执行沙箱：保存实验行并在本机临时目录运行 python3 */
  @Post('run')
  run(@Body() body: { projectId: string; goal?: string; code: string; documentId?: string | null }) {
    return this.experiments.run(body);
  }

  @Get()
  list(@Query('projectId') projectId: string) {
    return this.experiments.list(projectId);
  }

  /** 按文档回流写作页：返回关联该文档的实验列表（须声明在 :id 之前，避免 by-document 被当成实验 id） */
  @Get('by-document/:documentId')
  byDocument(@Param('documentId') documentId: string) {
    return this.experiments.byDocument(documentId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.experiments.get(id);
  }

  /** 更新实验目的 / 结论（zod 校验，仅这两个字段可改） */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { goal?: string; conclusion?: string }) {
    return this.experiments.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.experiments.remove(id);
  }
}
