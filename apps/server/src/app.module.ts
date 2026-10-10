import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
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
import { ExperimentsModule } from './experiments/experiments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health.controller';
import { HttpExceptionFilter } from './common/http-exception.filter';

@Module({
  imports: [
    // 全局频率限制：每分钟 60 次（AI 调用 + API），防止 token 成本爆炸 / DoS
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    AiModule,
    AuthModule,
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
    ExperimentsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
