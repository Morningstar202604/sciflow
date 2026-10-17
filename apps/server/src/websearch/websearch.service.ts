/**
 * Web 搜索服务（可插拔 Provider 架构）
 * ============================================================================
 * 设计原则（2026-10-17 重构）：**开源集成内置、闭源入口留给用户自填**。
 *
 * 内置支持（无需任何 Key 即可用）：
 *  - `duckduckgo`   DDG Instant Answer 兜底（零配置，通用网页摘要级）
 *  - `searxng`      开源元搜索引擎（推荐：用户自部署 https://github.com/searxng/searxng，
 *                   填实例 URL 即用；尊重隐私、可聚合 Google/Bing/DuckDuckGo）
 *
 * 用户自填 Key 的商业引擎（可选）：
 *  - `tavily`       AI 优先搜索（https://tavily.com）
 *  - `serper`       Google SERP API（https://serper.dev）
 *  - `brave`        Brave Search API（https://brave.com/search/api）
 *
 * 配置优先级：DB(app_setting) > 环境变量 > 默认(duckduckgo)。
 * 结果统一带本地缓存（web_search_cache 表，2 小时 TTL）。
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { sqlite } from '../db/database';
import { webSearchCache } from '../db/schema';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type ProviderName = 'duckduckgo' | 'searxng' | 'tavily' | 'serper' | 'brave';

interface ProviderConfig {
  provider: ProviderName;
  searxngUrl: string;
  tavilyKey: string;
  serperKey: string;
  braveKey: string;
}

const SETTING_KEYS = {
  provider: 'websearch_provider',
  searxngUrl: 'websearch_searxng_url',
  tavilyKey: 'websearch_tavily_key',
  serperKey: 'websearch_serper_key',
  braveKey: 'websearch_brave_key',
} as const;

/** 校验 provider 名合法性（防注入任意字符串进日志/配置） */
function isProviderName(v: string): v is ProviderName {
  return ['duckduckgo', 'searxng', 'tavily', 'serper', 'brave'].includes(v);
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private static readonly CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 小时缓存
  private static readonly MAX_RESULTS = 6;

  // ---------- 配置（DB > env > 默认） ----------

  private readSetting(key: string): string {
    try {
      const row = sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value?: string } | undefined;
      return row?.value ?? '';
    } catch {
      return ''; // 表可能尚未建（极早期启动），回退 env
    }
  }

  private writeSetting(key: string, value: string): void {
    // app_setting: key(PK), value —— UPSERT 幂等写入
    sqlite
      .prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** chat 联网兜底开关（默认 off；设置 websearch_in_chat=on 开启） */
  isChatSearchEnabled(): boolean {
    return this.readSetting('websearch_in_chat') === 'on' || process.env.WEBSEARCH_IN_CHAT === 'on';
  }

  getConfig(): ProviderConfig {
    return {
      provider: (isProviderName(this.readSetting(SETTING_KEYS.provider) || process.env.WEBSEARCH_PROVIDER || '')
        ? (this.readSetting(SETTING_KEYS.provider) || process.env.WEBSEARCH_PROVIDER || 'duckduckgo')
        : 'duckduckgo') as ProviderName,
      searxngUrl: this.readSetting(SETTING_KEYS.searxngUrl) || process.env.WEBSEARCH_SEARXNG_URL || '',
      tavilyKey: this.readSetting(SETTING_KEYS.tavilyKey) || process.env.WEBSEARCH_TAVILY_KEY || '',
      serperKey: this.readSetting(SETTING_KEYS.serperKey) || process.env.WEBSEARCH_SERPER_KEY || '',
      braveKey: this.readSetting(SETTING_KEYS.braveKey) || process.env.WEBSEARCH_BRAVE_KEY || '',
    };
  }

  /** 掩码回显（key 只露尾 4） */
  getConfigMasked() {
    const c = this.getConfig();
    const mask = (s: string) => (s ? '*'.repeat(Math.max(s.length - 4, 0)) + s.slice(-4) : '');
    return {
      provider: c.provider,
      searxngUrl: c.searxngUrl,
      tavilyKey: mask(c.tavilyKey),
      serperKey: mask(c.serperKey),
      braveKey: mask(c.braveKey),
      chatFallback: this.isChatSearchEnabled(),
      available: {
        duckduckgo: true,
        searxng: !!c.searxngUrl,
        tavily: !!c.tavilyKey,
        serper: !!c.serperKey,
        brave: !!c.braveKey,
      },
    };
  }

  saveConfig(body: Partial<{ provider: string; searxngUrl: string; tavilyKey: string; serperKey: string; braveKey: string; chatFallback: boolean }>) {
    if (body.chatFallback !== undefined) {
      this.writeSetting('websearch_in_chat', body.chatFallback ? 'on' : 'off');
    }
    if (body.provider !== undefined) {
      if (!isProviderName(body.provider)) throw new Error(`未知 provider: ${body.provider}`);
      this.writeSetting(SETTING_KEYS.provider, body.provider);
    }
    if (body.searxngUrl !== undefined) this.writeSetting(SETTING_KEYS.searxngUrl, body.searxngUrl.trim().replace(/\/$/, ''));
    // key 提交：空串=清除；含 * =掩码回显不改原值
    const saveKey = (settingKey: string, submitted?: string) => {
      if (submitted === undefined) return;
      if (submitted.includes('*')) return;
      this.writeSetting(settingKey, submitted.trim());
    };
    saveKey(SETTING_KEYS.tavilyKey, body.tavilyKey);
    saveKey(SETTING_KEYS.serperKey, body.serperKey);
    saveKey(SETTING_KEYS.braveKey, body.braveKey);
    return { ok: true, config: this.getConfigMasked() };
  }

  // ---------- 搜索主入口 ----------

  /** 搜索（带缓存）：按当前 provider 分发；失败自动降级到 duckduckgo 兜底 */
  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];
    const cached = this.cacheGet(q);
    if (cached) return cached;

    const cfg = this.getConfig();
    let results: SearchResult[] = [];
    try {
      switch (cfg.provider) {
        case 'searxng':
          results = await this.searchSearxng(q, cfg.searxngUrl);
          break;
        case 'tavily':
          results = await this.searchTavily(q, cfg.tavilyKey);
          break;
        case 'serper':
          results = await this.searchSerper(q, cfg.serperKey);
          break;
        case 'brave':
          results = await this.searchBrave(q, cfg.braveKey);
          break;
        default:
          results = await this.searchDuckDuckGo(q);
      }
    } catch (e: any) {
      this.logger.warn(`[${cfg.provider}] 搜索失败，降级到 duckduckgo: ${e?.message || e}`);
      try {
        results = await this.searchDuckDuckGo(q);
      } catch (e2: any) {
        this.logger.warn(`duckduckgo 兜底也失败: ${e2?.message || e2}`);
        return [];
      }
    }
    this.cachePut(q, results);
    return results;
  }

  // ---------- 各 Provider 实现 ----------

  /** SearXNG（开源自部署）：GET {base}/search?q=&format=json */
  private async searchSearxng(q: string, base: string): Promise<SearchResult[]> {
    if (!base) throw new Error('SearXNG 实例 URL 未配置');
    const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&language=zh-CN`;
    const r = await this.fetchJson(url, { headers: { Accept: 'application/json' } });
    const items = Array.isArray(r?.results) ? r.results : [];
    return items.slice(0, WebSearchService.MAX_RESULTS).map((it: { title?: string; url?: string; content?: string }) => ({
      title: it.title || '',
      url: it.url || '',
      snippet: it.content || '',
    })).filter((x: SearchResult) => x.url);
  }

  /** Tavily：POST https://api.tavily.com/search */
  private async searchTavily(q: string, key: string): Promise<SearchResult[]> {
    if (!key) throw new Error('Tavily API Key 未配置（请到设置页填写）');
    const r = await this.fetchJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: q, max_results: WebSearchService.MAX_RESULTS, search_depth: 'basic' }),
    });
    const items = Array.isArray(r?.results) ? r.results : [];
    return items.map((it: { title?: string; url?: string; content?: string }) => ({
      title: it.title || '',
      url: it.url || '',
      snippet: it.content || '',
    }));
  }

  /** Serper（Google SERP）：POST https://google.serper.dev/search */
  private async searchSerper(q: string, key: string): Promise<SearchResult[]> {
    if (!key) throw new Error('Serper API Key 未配置（请到设置页填写）');
    const r = await this.fetchJson('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q, num: WebSearchService.MAX_RESULTS }),
    });
    const items = Array.isArray(r?.organic) ? r.organic : [];
    return items.map((it: { title?: string; link?: string; snippet?: string }) => ({
      title: it.title || '',
      url: it.link || '',
      snippet: it.snippet || '',
    }));
  }

  /** Brave Search API：GET https://api.search.brave.com/res/v1/web/search */
  private async searchBrave(q: string, key: string): Promise<SearchResult[]> {
    if (!key) throw new Error('Brave API Key 未配置（请到设置页填写）');
    const r = await this.fetchJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${WebSearchService.MAX_RESULTS}`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
    );
    const items = Array.isArray(r?.web?.results) ? r.web.results : [];
    return items.map((it: { title?: string; url?: string; description?: string }) => ({
      title: it.title || '',
      url: it.url || '',
      snippet: (it.description || '').replace(/<[^>]+>/g, ''),
    }));
  }

  /** DDG Instant Answer（零配置兜底） */
  private async searchDuckDuckGo(q: string): Promise<SearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const data = await this.fetchJson(url, { headers: { 'User-Agent': 'SciFlow/0.5 (local research tool)' } });
    const results: SearchResult[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: data.Heading || q, url: data.AbstractURL, snippet: data.AbstractText });
    }
    for (const t of data.RelatedTopics || []) {
      if (t.Text && t.FirstURL && results.length < WebSearchService.MAX_RESULTS) {
        results.push({ title: t.Text.split(' - ')[0] || t.Text.slice(0, 60), url: t.FirstURL, snippet: t.Text });
      }
    }
    return results;
  }

  // ---------- 基础设施 ----------

  private async fetchJson(url: string, init: RequestInit = {}): Promise<any> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private cacheGet(q: string): SearchResult[] | null {
    const row = db.select().from(webSearchCache).where(eq(webSearchCache.query, q)).get() as
      | { results: string; updatedAt: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.updatedAt > WebSearchService.CACHE_TTL_MS) return null;
    try {
      return JSON.parse(row.results) as SearchResult[];
    } catch {
      return null;
    }
  }

  private cachePut(q: string, results: SearchResult[]): void {
    if (results.length === 0) return;
    const now = Date.now();
    const existing = db.select().from(webSearchCache).where(eq(webSearchCache.query, q)).get() as { id?: string } | undefined;
    if (existing?.id) {
      db.update(webSearchCache).set({ results: JSON.stringify(results), updatedAt: now }).where(eq(webSearchCache.id, existing.id)).run();
      return;
    }
    db.insert(webSearchCache)
      .values({ id: randomUUID(), query: q, results: JSON.stringify(results), createdAt: now, updatedAt: now })
      .run();
  }

  /** 搜索结果 → 文本片段（可直接注入 LLM context） */
  static toContext(results: SearchResult[]): string {
    if (results.length === 0) return '';
    return results.map((r, i) => `[网搜${i + 1}] ${r.title}\n${r.snippet}\n来源: ${r.url}`).join('\n\n');
  }
}
