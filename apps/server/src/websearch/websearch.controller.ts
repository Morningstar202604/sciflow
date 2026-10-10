/**
 * Web 搜索 API（POST /api/web/search?q=...）
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebSearchService } from './websearch.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';

@Controller('api/web')
@UseGuards(JwtAuthGuard)
export class WebSearchController {
  constructor(private readonly ws: WebSearchService) {}

  @Post('search')
  @Public()
  async search(@Body() body: { q?: string }) {
    const q = body?.q?.trim() || '';
    if (!q) return { error: 'q required', results: [] };
    const results = await this.ws.search(q);
    return { results, context: WebSearchService.toContext(results) };
  }
}
