import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiModule } from '../ai/ai.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [AiModule, MemoryModule, KnowledgeModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService], // RAG 注入逻辑（contextFor）可被 McpModule 等复用
})
export class ChatModule {}
