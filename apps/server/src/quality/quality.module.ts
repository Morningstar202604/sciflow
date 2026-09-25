import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { QualityService } from './quality.service';
import { QualityController } from './quality.controller';

@Module({
  imports: [AiModule],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
