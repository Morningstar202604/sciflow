import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  /** 新增记忆（程序记忆=写作风格指令） */
  @Post()
  add(@Body() body: { type?: string; content: string; projectId?: string; keywords?: string[] }) {
    const type = body.type === 'procedural' ? 'procedural' : 'episodic';
    return this.memory.add(type, body.content, body.projectId, body.keywords || []);
  }

  /** 记忆列表：?type=procedural|episodic&q=关键词&projectId=项目ID */
  @Get()
  list(@Query('type') type?: string, @Query('q') q?: string, @Query('projectId') projectId?: string) {
    return this.memory.list(
      type === 'procedural' || type === 'episodic' ? type : undefined,
      q,
      projectId,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.memory.remove(id);
  }
}
