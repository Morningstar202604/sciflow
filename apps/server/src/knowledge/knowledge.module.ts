import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [AiModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, EmbeddingService],
  exports: [KnowledgeService, EmbeddingService],
})
export class KnowledgeModule {}
