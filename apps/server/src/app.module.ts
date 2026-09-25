import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { ProjectsModule } from './projects/projects.module';
import { DocumentsModule } from './documents/documents.module';
import { ReferencesModule } from './references/references.module';
import { QualityModule } from './quality/quality.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ChatModule } from './chat/chat.module';
import { SubmissionModule } from './submission/submission.module';
import { SettingsModule } from './settings/settings.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    AiModule,
    ProjectsModule,
    DocumentsModule,
    ReferencesModule,
    QualityModule,
    PipelineModule,
    ChatModule,
    SubmissionModule,
    SettingsModule,
    KnowledgeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
