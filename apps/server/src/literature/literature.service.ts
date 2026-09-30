import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from '../db/database';
import { references } from '../db/schema';

export interface PaperHit {
  id?: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: 'manual';
  citationCount: number;
}

/**
 * 文献检索服务（本地文献库版）
 * - 已移除全部国外在线源（OpenAlex / arXiv / Semantic Scholar / CrossRef），零外部网络依赖
 * - search() 在本地文献库（references 表）内按 标题/作者/摘要 做模糊检索，
 *   供流水线 ReAct / Agentic RAG / MCP / 前端复用；projectId 可选限定项目范围
 */
@Injectable()
export class LiteratureService {
  async search(query: string, limit = 8, projectId?: string): Promise<PaperHit[]> {
    const q = query.trim();
    if (!q) return [];
    const q2 = `%${q}%`;
    const cond = sql`${references.title} LIKE ${q2} OR COALESCE(${references.authors}, '') LIKE ${q2} OR COALESCE(${references.abstract}, '') LIKE ${q2}`;
    const rows = db
      .select()
      .from(references)
      .where(projectId ? sql`${references.projectId} = ${projectId} AND (${cond})` : cond)
      .all();
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      title: r.title,
      authors: this.parseAuthors(r.authors),
      year: r.year,
      venue: r.venue ?? '',
      doi: r.doi ?? '',
      url: r.url || (r.doi ? `https://doi.org/${r.doi}` : ''),
      abstract: r.abstract ?? '',
      source: 'manual' as const,
      citationCount: r.citationCount ?? 0,
    }));
  }

  private parseAuthors(json: string | null): string[] {
    if (!json) return [];
    try {
      const arr = JSON.parse(json);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return json ? [json] : [];
    }
  }
}
