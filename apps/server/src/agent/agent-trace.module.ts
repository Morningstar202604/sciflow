import { Module } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { AgentTraceController } from './agent-trace.controller';
import { AgentToolBridge } from './agent-tool-bridge';
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [McpModule],
  providers: [AgentTraceService, AgentToolBridge],
  controllers: [AgentTraceController],
  exports: [AgentTraceService, AgentToolBridge],
})
export class AgentTraceModule {}
