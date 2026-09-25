import { Injectable, Logger } from '@nestjs/common';

export interface PaperHit {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: 'openalex' | 'arxiv' | 'semantic-scholar';
  citationCount: number;
}

/**
 * 文献检索服务：真实对接 3 个免费学术 API
 * - OpenAlex（无需 key）
 * - arXiv（无需 key）
 * - Semantic Scholar（免费、限流）
 * 多源并查 + 失败降级，保证返回的文献真实存在、可追溯
 */
@Injectable()
export class LiteratureService {
  private readonly logger = new Logger(LiteratureService.name);

  async search(query: string, limit = 8): Promise<PaperHit[]> {
    const q = query.trim();
    if (!q) return [];

    const [openalex, arxiv, s2] = await Promise.allSettled([
      this.searchOpenAlex(q, limit),
      this.searchArxiv(q, limit),
      this.searchSemanticScholar(q, limit),
    ]);

    const results: PaperHit[] = [];
    const seen = new Set<string>();
    for (const r of [openalex, arxiv, s2]) {
      if (r.status !== 'fulfilled') {
        this.logger.warn(`检索源失败: ${r.reason?.message || r.reason}`);
        continue;
      }
      for (const hit of r.value) {
        const key = hit.title.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        results.push(hit);
      }
    }
    return results.slice(0, limit);
  }

  private async searchOpenAlex(query: string, limit: number): Promise<PaperHit[]> {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=sciflow@example.com`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
    const data = (await res.json()) as any;
    return (data.results || []).map((w: any) => ({
      title: w.title || '(untitled)',
      authors: (w.authorships || []).slice(0, 8).map((a: any) => a.author?.display_name || ''),
      year: w.publication_year ?? null,
      venue: w.primary_location?.source?.display_name || '',
      doi: w.doi || '',
      url: w.doi || '',
      abstract: w.abstract_inverted_index ? this.invertedIndexToText(w.abstract_inverted_index) : '',
      source: 'openalex' as const,
      citationCount: w.cited_by_count || 0,
    }));
  }

  private async searchArxiv(query: string, limit: number): Promise<PaperHit[]> {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`arXiv ${res.status}`);
    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.slice(0, limit).map((e) => {
      const title = this.xmlTag(e, 'title').replace(/\s+/g, ' ').trim();
      const authors = [...e.matchAll(/<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g)].map((m) => m[1].trim());
      const id = this.xmlTag(e, 'id');
      const summary = this.xmlTag(e, 'summary').replace(/\s+/g, ' ').trim();
      return {
        title,
        authors,
        year: Number(this.xmlTag(e, 'published').slice(0, 4)) || null,
        venue: 'arXiv',
        doi: '',
        url: id,
        abstract: summary,
        source: 'arxiv' as const,
        citationCount: 0,
      };
    });
  }

  private async searchSemanticScholar(query: string, limit: number): Promise<PaperHit[]> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(
      query,
    )}&limit=${limit}&fields=title,authors,year,venue,externalIds,abstract,url,citationCount`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`SemanticScholar ${res.status}`);
    const data = (await res.json()) as any;
    return (data.data || []).map((p: any) => ({
      title: p.title || '(untitled)',
      authors: (p.authors || []).slice(0, 8).map((a: any) => a.name || ''),
      year: p.year ?? null,
      venue: p.venue || '',
      doi: p.externalIds?.DOI || '',
      url: p.url || p.externalIds?.ArXiv || '',
      abstract: p.abstract || '',
      source: 'semantic-scholar' as const,
      citationCount: p.citationCount || 0,
    }));
  }

  private invertedIndexToText(index: Record<string, number[]>): string {
    const words: string[] = [];
    for (const [word, positions] of Object.entries(index)) {
      for (const pos of positions) words[pos] = word;
    }
    return words.filter(Boolean).join(' ').slice(0, 600);
  }

  private xmlTag(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1] : '';
  }
}
