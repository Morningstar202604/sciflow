import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LiteratureModule } from '../literature/literature.module';
import { ReferencesModule } from '../references/references.module';
import { QualityModule } from '../quality/quality.module';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';

@Module({
  imports: [AiModule, LiteratureModule, ReferencesModule, QualityModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
