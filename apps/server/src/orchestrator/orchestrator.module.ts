import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LiteratureModule } from '../literature/literature.module';
import { QualityModule } from '../quality/quality.module';
import { AgentOrchestratorService } from './orchestrator.service';

@Module({
  imports: [AiModule, LiteratureModule, QualityModule],
  providers: [AgentOrchestratorService],
  exports: [AgentOrchestratorService],
})
export class OrchestratorModule {}
