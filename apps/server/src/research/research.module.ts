import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';
import { SubmissionController } from './submission.controller';
import { SubmissionService } from './submission.service';
import { AiModule } from '../ai/ai.module';

/** 科研辅助工具集：研究设计诊断 / 论文对比 / 模拟审稿 + 7 维质量评分 + 投稿辅助（期刊推荐/Cover Letter/审稿回复） */
@Module({
  imports: [AiModule],
  controllers: [ResearchController, QualityController, SubmissionController],
  providers: [ResearchService, QualityService, SubmissionService],
  exports: [ResearchService, QualityService, SubmissionService],
})
export class ResearchModule {}
