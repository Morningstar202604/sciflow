import { Controller, Get, Post, Body, Param, Req, Res, All } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

  // ---------- 官方 MCP 协议端点（Streamable HTTP，供 Claude Desktop 等真 MCP 客户端接入） ----------

  /**
   * MCP 协议入口：POST /api/mcp/rpc（无状态 Streamable HTTP）。
   * 客户端配置示例：{"mcpServers":{"sciflow":{"url":"http://127.0.0.1:3000/api/mcp/rpc"}}}
   */
  @All('rpc')
  async rpc(@Req() req: Request, @Res() res: Response) {
    const server = this.mcp.buildSdkServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
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
