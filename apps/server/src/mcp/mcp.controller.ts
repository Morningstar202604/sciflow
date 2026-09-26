import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { McpService } from './mcp.service';

@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  /** MCP 协议信息 */
  @Get('info')
  info() {
    return {
      protocol: 'model-context-protocol',
      version: '2026-07-28',
      name: 'sciflow-mcp',
      tools: this.mcp.list().length,
    };
  }

  /** 工具清单（MCP tools/list） */
  @Get('tools')
  tools() {
    return {
      tools: this.mcp.list(),
    };
  }

  /** 调用工具（MCP tools/call） */
  @Post('call')
  call(@Body() body: { name: string; arguments?: Record<string, any> }) {
    return this.mcp.call(body?.name, body?.arguments);
  }

  // ---------- 外部 MCP 服务器（客户端） ----------
  @Get('external')
  externalServers() {
    return this.mcp.listExternalServers();
  }

  @Post('external/discover')
  discover(@Body() body: { url: string }) {
    return this.mcp.discoverExternal(body?.url);
  }

  @Post('external/:id/call')
  callExternal(@Param('id') id: string, @Body() body: { name: string; arguments?: Record<string, any> }) {
    return this.mcp.callExternal(id, body?.name, body?.arguments || {});
  }
}
