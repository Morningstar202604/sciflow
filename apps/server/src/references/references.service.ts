import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { sql, eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { references } from '../db/schema';
import { AiService } from '../ai/ai.service';

/** 文献命中条目（本地文献库检索/入库共用） */
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

@Injectable()
export class ReferencesService {
  constructor(private readonly ai: AiService) {}

  /** 本地文献库检索（标题/作者/摘要模糊匹配，已移除国外在线源，零外部网络依赖） */
  search(query: string, limit = 8, projectId?: string): PaperHit[] {
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

  list(projectId: string) {
    return db.select().from(references).where(eq(references.projectId, projectId)).orderBy(references.createdAt).all();
  }

  get(id: string) {
    const row = db.select().from(references).where(eq(references.id, id)).get();
    if (!row) throw new NotFoundException('文献不存在');
    return row;
  }

  /** 手动/检索结果入库 */
  create(projectId: string, hit: Partial<PaperHit> & { title: string }) {
    if (!hit.title) throw new BadRequestException('文献标题必填');
    // 空元数据守卫：无作者且无年份的条目（如 Agentic RAG 补检的纯标题）不进文献库，
    // 避免污染引用池导致 [Unknown n.d.] / 佚名
    const authorsOk = (hit.authors || []).length > 0;
    if (!authorsOk && !hit.year) return null;
    // 按 DOI/标题去重
    const existing = db
      .select()
      .from(references)
      .where(and(eq(references.projectId, projectId), eq(references.title, hit.title)))
      .get();
    if (existing) return existing;
    const row = {
      id: randomUUID(),
      projectId,
      title: hit.title,
      authors: JSON.stringify(hit.authors || []),
      year: hit.year ?? null,
      venue: hit.venue || '',
      doi: hit.doi || '',
      url: hit.url || '',
      abstract: hit.abstract || '',
      source: hit.source || 'manual',
      tags: '[]',
      citationCount: hit.citationCount || 0,
      createdAt: Date.now(),
    };
    db.insert(references).values(row).run();
    return row;
  }

  /** 批量导入检索结果 */
  import(projectId: string, hits: (Partial<PaperHit> & { title: string })[]) {
    return hits.map((h) => this.create(projectId, h)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  }

  remove(id: string) {
    this.get(id);
    db.delete(references).where(eq(references.id, id)).run();
    return { ok: true };
  }

  /** AI 文献综述（只基于文献库内真实文献，禁止编造） */
  async summarize(projectId: string, topic: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = this.paperListText(refs);
    return this.ai.summarizeLiterature(topic, papers);
  }

  private paperListText(refs: (typeof references.$inferSelect)[]) {
    return refs
      .map(
        (r, i) =>
          `[Ref:${i + 1}] ${r.title}（作者:${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）\n摘要:${(r.abstract || '').slice(0, 300)}`,
      )
      .join('\n\n');
  }

  /** Elicit 式：文献结构化提取（方法/结果/贡献/局限） */
  async extract(projectId: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}）\n摘要:${(r.abstract || '').slice(0, 400)}`)
      .join('\n\n');
    const rows = await this.ai.extractPaperTable(papers);
    return rows.map((row, i) => ({ ...row, ref: row.ref || String(i + 1) }));
  }

  /** 科研加强：单篇文献深度精读 */
  async deepDive(projectId: string, refId: string) {
    const ref = this.get(refId);
    const paper = `标题:${ref.title}\n作者:${ref.authors}\n年份:${ref.year || 'n.d.'}\n期刊/会议:${ref.venue || '未知'}\nDOI:${ref.doi || '无'}\n摘要:${(ref.abstract || '').slice(0, 800)}`;
    return this.ai.deepDivePaper(paper);
  }

  /** 科研加强：研究缺口定位（选题顾问） */
  async gap(projectId: string, topic: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}，${r.venue}）\n摘要:${(r.abstract || '').slice(0, 300)}`)
      .join('\n\n');
    return this.ai.researchGap(topic, papers);
  }

  /** Consensus 式：证据综合（论断 + 支持/矛盾 + 证据强度） */
  async evidence(projectId: string, question: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}）\n摘要:${(r.abstract || '').slice(0, 350)}`)
      .join('\n\n');
    return this.ai.evidenceSynthesis(question, papers);
  }
}
