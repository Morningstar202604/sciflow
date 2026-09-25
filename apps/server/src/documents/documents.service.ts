import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { documents, citations, references, polishRecords } from '../db/schema';
import { AiService } from '../ai/ai.service';

const MAX_VERSIONS = 20;

@Injectable()
export class DocumentsService {
  constructor(private readonly ai: AiService) {}

  list(projectId: string) {
    return db.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(documents.updatedAt);
  }

  get(id: string) {
    const row = db.select().from(documents).where(eq(documents.id, id)).get();
    if (!row) throw new NotFoundException('文档不存在');
    return row;
  }

  create(projectId: string, input: { title: string }) {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId,
      title: input.title.trim() || '未命名论文',
      content: '',
      outline: '[]',
      version: 1,
      versions: '[]',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(documents).values(row).run();
    return row;
  }

  /** 更新文档；内容变化时自动保存历史版本 */
  update(id: string, patch: { title?: string; content?: string; outline?: string; status?: string }) {
    const existing = this.get(id);
    const baseVersion = existing.version ?? 1;
    let versions = this.parseJson<{ version: number; content: string; updatedAt: number }[]>(existing.versions ?? '[]');
    if (patch.content !== undefined && patch.content !== existing.content && existing.content) {
      versions = [
        ...versions,
        { version: baseVersion, content: existing.content, updatedAt: existing.updatedAt ?? Date.now() },
      ].slice(-MAX_VERSIONS);
    }
    const row = {
      ...existing,
      ...patch,
      versions: JSON.stringify(versions),
      version: patch.content !== undefined && patch.content !== existing.content ? baseVersion + 1 : baseVersion,
      updatedAt: Date.now(),
    };
    db.update(documents).set(row).where(eq(documents.id, id)).run();
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    db.delete(documents).where(eq(documents.id, id)).run();
    db.delete(citations).where(eq(citations.documentId, id)).run();
    db.delete(polishRecords).where(eq(polishRecords.documentId, id)).run();
    return { ok: true };
  }

  // ---------- AI 写作工具 ----------

  /** 大纲生成（outline-first，借鉴 STORM），保存到文档 */
  async generateOutline(id: string, topic: string, summary = '') {
    const doc = this.get(id);
    const outline = await this.ai.writeOutline(topic || doc.title, summary);
    this.update(id, { outline: JSON.stringify(outline), title: doc.title === '未命名论文' ? outline.title : doc.title });
    return outline;
  }

  /** 章节起草 */
  async draftSection(id: string, sectionTitle: string) {
    const doc = this.get(id);
    const outline = this.parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline ?? '[]');
    const refs = this.getRefsForPrompt(id);
    const text = await this.ai.draftSection(sectionTitle, JSON.stringify(outline), refs);
    return { text };
  }

  /** 三段式润色/降重并记录历史 */
  async polish(id: string, text: string, mode: 'polish' | 'reduce' = 'polish') {
    const doc = this.get(id);
    const result = await this.ai.polish(text, mode);
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: mode,
        original: result.original,
        polished: result.polished,
        reason: result.reason,
        createdAt: Date.now(),
      })
      .run();
    return result;
  }

  /** 学术翻译 */
  async translate(id: string, text: string, targetLang: 'zh' | 'en') {
    const doc = this.get(id);
    const translated = await this.ai.translate(text, targetLang);
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: 'translate',
        original: text,
        polished: translated,
        reason: `学术翻译（目标语言：${targetLang === 'zh' ? '中文' : '英文'}）`,
        createdAt: Date.now(),
      })
      .run();
    return { translated };
  }

  listPolishRecords(id: string) {
    return db.select().from(polishRecords).where(eq(polishRecords.documentId, id)).orderBy(polishRecords.createdAt);
  }

  // ---------- 引用管理（Citation -> Reference 可追溯） ----------

  addCitation(documentId: string, input: { referenceId: string; location?: string; context?: string; format?: string }) {
    const ref = db.select().from(references).where(eq(references.id, input.referenceId)).get();
    if (!ref) throw new BadRequestException('引用的文献不存在，请先加入文献库');
    this.get(documentId);
    const row = {
      id: randomUUID(),
      documentId,
      referenceId: input.referenceId,
      location: input.location || '',
      context: input.context || '',
      format: input.format || 'apa',
      verified: ref.doi ? 1 : 0, // 有 DOI 视为可核验
      createdAt: Date.now(),
    };
    db.insert(citations).values(row).run();
    return row;
  }

  listCitations(documentId: string) {
    const rows = db
      .select({
        citation: citations,
        reference: references,
      })
      .from(citations)
      .innerJoin(references, eq(citations.referenceId, references.id))
      .where(eq(citations.documentId, documentId))
      .all();
    return rows.map((r) => ({ ...r.citation, reference: r.reference }));
  }

  removeCitation(citationId: string) {
    db.delete(citations).where(eq(citations.id, citationId)).run();
    return { ok: true };
  }

  /** 按格式导出参考文献（APA / IEEE / Vancouver） */
  exportCitations(documentId: string, format: string) {
    const rows = this.listCitations(documentId);
    return rows.map((c, i) =>
      formatCitation(
        {
          title: c.reference.title,
          authors: c.reference.authors ?? '[]',
          year: c.reference.year,
          venue: c.reference.venue ?? '',
          doi: c.reference.doi ?? '',
        },
        format,
        i + 1,
      ),
    );
  }

  private getRefsForPrompt(documentId: string): string {
    const rows = this.listCitations(documentId);
    return rows
      .map(
        (r, i) =>
          `[Ref:${i + 1}] ${r.reference.title}（${r.reference.authors}，${r.reference.year || 'n.d.'}，${r.reference.venue}${r.reference.doi ? `，DOI:${r.reference.doi}` : ''}）`,
      )
      .join('\n');
  }

  private parseJson<T>(raw: string): T {
    try {
      return JSON.parse(raw || '[]') as T;
    } catch {
      return [] as unknown as T;
    }
  }
}

/** 引用格式转换（简化实现） */
export function formatCitation(ref: { title: string; authors: string; year: number | null; venue: string; doi: string }, format: string, index: number): string {
  const authors = (() => {
    try {
      const arr = JSON.parse(ref.authors || '[]') as string[];
      if (arr.length === 0) return 'Anonymous';
      if (format === 'ieee') {
        return arr
          .map((a) => {
            const parts = a.split(' ').filter(Boolean);
            const last = parts.pop() || '';
            const initials = parts.map((p) => p.charAt(0)).join('');
            return initials ? `${initials}. ${last}` : last;
          })
          .join(', ');
      }
      if (arr.length === 1) return arr[0];
      if (format === 'apa') return `${arr[0]} et al.`;
      if (format === 'vancouver') {
        return arr
          .map((a) => {
            const parts = a.split(' ').filter(Boolean);
            const last = parts.pop() || '';
            const initials = parts.map((p) => p.charAt(0)).join('');
            return `${last} ${initials}`.trim();
          })
          .join(', ');
      }
      return arr[0] + ' ' + arr.slice(1).map((a) => a.split(' ').pop()?.charAt(0) || '').join('') + '.';
    } catch {
      return 'Anonymous';
    }
  })();
  const year = ref.year ? ` ${ref.year}` : ' n.d.';
  const venue = ref.venue ? `. ${ref.venue}` : '';
  const doi = ref.doi ? `. https://doi.org/${ref.doi}` : '';

  switch (format) {
    case 'ieee':
      return `[${index}] ${authors} "${ref.title},"${venue}${year}.${doi}`;
    case 'vancouver':
      return `${index}. ${authors} ${ref.title}${venue}${year}.${doi}`;
    default:
      return `${authors} (${year.trim()}). ${ref.title}.${venue}${doi}`;
  }
}
