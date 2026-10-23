/**
 * Web 搜索 API
 *  - POST /api/web/search?q=...       执行搜索（按当前 provider 分发，带缓存+降级）
 *  - GET  /api/web/config             当前 provider 配置（key 掩码回显）
 *  - PUT  /api/web/config             保存 provider 配置（开源 SearXNG 填 URL；商业引擎用户自填 Key）
 */

import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { WebSearchService } from './websearch.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('web')
@UseGuards(JwtAuthGuard)
export class WebSearchController {
  constructor(private readonly ws: WebSearchService) {}

  @Post('search')
  async search(@Body() body: { q?: string }) {
    const q = body?.q?.trim() || '';
    if (!q) return { error: 'q required', results: [] };
    const results = await this.ws.search(q);
    return { results, context: WebSearchService.toContext(results) };
  }

  @Get('config')
  config() {
    return this.ws.getConfigMasked();
  }

  @Put('config')
  saveConfig(
    @Body()
    body: Partial<{ provider: string; searxngUrl: string; tavilyKey: string; serperKey: string; braveKey: string }>,
  ) {
    try {
      return this.ws.saveConfig(body ?? {});
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}
