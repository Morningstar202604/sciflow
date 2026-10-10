/**
 * Web 搜索服务（对标 Cursor @Web / Mistral 联网搜索）
 *
 * 使用 DuckDuckGo Instant Answer API（免费、无需 key、CORS 友好）+ 本地缓存。
 * 结果以结构化片段返回，可直接注入 LLM 上下文。
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { webSearchCache } from '../db/schema';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private static readonly CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时缓存
  private static readonly MAX_RESULTS = 6;

  /** 搜索（带缓存）：先查本地缓存，未命中则请求 DDG Instant Answer + HTML 接口兜底 */
  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    // 1. 查缓存
    const cached = db.select().from(webSearchCache).where(eq(webSearchCache.query, q)).get();
    if (cached && Date.now() - cached.updatedAt < WebSearchService.CACHE_TTL_MS) {
      db.update(webSearchCache).set({ hitCount: (cached.hitCount ?? 0) + 1, updatedAt: Date.now() }).where(eq(webSearchCache.id, cached.id)).run();
      return JSON.parse(cached.results ?? '[]') as SearchResult[];
    }

    // 2. 请求 DDG
    let results: SearchResult[] = [];
    try {
      results = await this.fetchDDG(q);
    } catch (e: any) {
      this.logger.warn(`DDG 搜索失败: ${e?.message || e}`);
    }

    // 3. 写缓存
    if (results.length > 0) {
      const now = Date.now();
      if (cached) {
        db.update(webSearchCache).set({ results: JSON.stringify(results), hitCount: (cached.hitCount ?? 0) + 1, updatedAt: now }).where(eq(webSearchCache.id, cached.id)).run();
      } else {
        db.insert(webSearchCache).values({ id: randomUUID(), query: q, results: JSON.stringify(results), createdAt: now, updatedAt: now }).run();
      }
    }

    return results;
  }

  private async fetchDDG(query: string): Promise<SearchResult[]> {
    // DDG Instant Answer API（结构化结果，无需 key）
    const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(iaUrl, { signal: controller.signal, headers: { 'User-Agent': 'SciFlow/0.2 (+https://gitcode.com/badhope/sciflow)' } });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const results: SearchResult[] = [];
      if (data.AbstractText && data.AbstractURL) {
        results.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText });
      }
      for (const t of data.RelatedTopics || []) {
        if (t.Text && t.FirstURL && results.length < WebSearchService.MAX_RESULTS) {
          results.push({ title: t.Text.split(' - ')[0] || t.Text.slice(0, 60), url: t.FirstURL, snippet: t.Text });
        }
      }
      return results;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 搜索结果 → 文本片段（可直接注入 LLM context） */
  static toContext(results: SearchResult[]): string {
    if (results.length === 0) return '';
    return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n来源: ${r.url}`).join('\n\n');
  }
}
