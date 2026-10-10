import { Module } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { AgentTraceController } from './agent-trace.controller';

@Module({
  providers: [AgentTraceService],
  controllers: [AgentTraceController],
  exports: [AgentTraceService],
})
export class AgentTraceModule {}
