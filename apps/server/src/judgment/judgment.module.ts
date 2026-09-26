import { Module } from '@nestjs/common';
import { JudgmentController } from './judgment.controller';
import { JudgmentService } from './judgment.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [JudgmentController],
  providers: [JudgmentService],
  exports: [JudgmentService],
})
export class JudgmentModule {}
