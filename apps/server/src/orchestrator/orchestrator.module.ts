import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';
import { ResearchModule } from '../research/research.module';
import { AgentOrchestratorService } from './orchestrator.service';

@Module({
  imports: [AiModule, ReferencesModule, ResearchModule],
  providers: [AgentOrchestratorService],
  exports: [AgentOrchestratorService],
})
export class OrchestratorModule {}
