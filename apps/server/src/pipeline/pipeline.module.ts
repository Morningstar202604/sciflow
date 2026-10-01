import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';

@Module({
  imports: [AiModule, ReferencesModule, OrchestratorModule, KnowledgeModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
