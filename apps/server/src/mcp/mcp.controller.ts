import { Controller, Get, Post, Body } from '@nestjs/common';
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
}
