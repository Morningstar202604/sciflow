import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { ProjectsModule } from './projects/projects.module';
import { DocumentsModule } from './documents/documents.module';
import { ReferencesModule } from './references/references.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ChatModule } from './chat/chat.module';
import { SettingsModule } from './settings/settings.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { McpModule } from './mcp/mcp.module';
import { MemoryModule } from './memory/memory.module';
import { ResearchModule } from './research/research.module';
import { JudgmentModule } from './judgment/judgment.module';
import { CustomizationModule } from './settings/customization.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    AiModule,
    ProjectsModule,
    DocumentsModule,
    ReferencesModule,
    PipelineModule,
    ChatModule,
    SettingsModule,
    KnowledgeModule,
    McpModule,
    MemoryModule,
    ResearchModule,
    JudgmentModule,
    CustomizationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
