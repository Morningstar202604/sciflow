import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { references } from '../db/schema';
import { LiteratureService, PaperHit } from '../literature/literature.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ReferencesService {
  constructor(
    private readonly literature: LiteratureService,
    private readonly ai: AiService,
  ) {}

  /** 真实检索（多源） */
  search(query: string, limit = 8) {
    return this.literature.search(query, limit);
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
    return hits.map((h) => this.create(projectId, h)).filter(Boolean);
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
    const papers = refs
      .map(
        (r, i) =>
          `[Ref:${i + 1}] ${r.title}（作者:${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）\n摘要:${(r.abstract || '').slice(0, 300)}`,
      )
      .join('\n\n');
    return this.ai.summarizeLiterature(topic, papers);
  }
}
