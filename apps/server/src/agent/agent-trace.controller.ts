/**
 * Agent 轨迹 API（GET /api/agent/runs + GET /api/agent/runs/:id + GET /api/agent/usage）
 */

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentTraceController {
  constructor(private readonly trace: AgentTraceService) {}

  /** 项目 Agent 执行历史列表 */
  @Get('executions')
  listExecutions(@Query('projectId') projectId: string, @Query('limit') limit?: string) {
    if (!projectId) return { error: 'projectId required' };
    return { executions: this.trace.listRuns(projectId, limit ? Number(limit) : 20) };
  }

  /** 单次执行详情（含步骤链） */
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    const detail = this.trace.getRunDetail(id);
    if (!detail) return { error: 'not found' };
    return detail;
  }

  /** Token 用量走势 */
  @Get('usage')
  usageTrend(@Query('projectId') projectId: string, @Query('days') days?: string) {
    if (!projectId) return { error: 'projectId required' };
    return { trend: this.trace.tokenUsageTrend(projectId, days ? Number(days) : 14) };
  }
}
