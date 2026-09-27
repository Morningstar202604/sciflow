import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { documents, citations, references, polishRecords } from '../db/schema';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
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
  /** 科研加强：论文摘要 + 关键词生成 */
  async generateAbstract(id: string) {
    const doc = this.get(id);
    return this.ai.generateAbstract(doc.title || '', doc.content || '');
  }

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

  /** 导出 Markdown 全文（标题 + 大纲 + 正文 + 引用列表） */
  exportMarkdown(id: string) {
    const doc = this.get(id);
    const outline = this.parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline || '[]');
    const citeRows = db.select().from(citations).where(eq(citations.documentId, id)).all();
    const refList = citeRows
      .map((c) => db.select().from(references).where(eq(references.id, c.referenceId)).get())
      .filter(Boolean) as any[];
    const lines: string[] = [];
    lines.push(`# ${doc.title}`);
    lines.push('');
    lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手`);
    lines.push('');
    if (outline.sections?.length) {
      lines.push('## 大纲');
      outline.sections.forEach((s) => {
        lines.push(`- ${s.title}`);
        (s.subsections || []).forEach((sub) => lines.push(`  - ${sub}`));
      });
      lines.push('');
    }
    lines.push('## 正文');
    lines.push('');
    lines.push(doc.content || '（正文为空）');
    lines.push('');
    if (refList.length) {
      lines.push('## 参考文献');
      lines.push('');
      refList.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}${r.authors && r.authors !== '[]' ? ` — ${r.authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`);
      });
    }
    return { markdown: lines.join('\n'), filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.md` };
  }

  /** Markdown 纯文本化（docx 段落用）：去 #、**、链接、列表符 */
  private mdToPlain(md: string): string {
    return md
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/[|>]+\s?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 导出 Word(.docx) 全文——交稿/投稿刚需（标题 + 大纲 + 正文 + 参考文献） */
  async exportDocx(id: string) {
    const doc = this.get(id);
    const outline = this.parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline || '[]');
    const citeRows = db.select().from(citations).where(eq(citations.documentId, id)).all();
    const refList = citeRows
      .map((c) => db.select().from(references).where(eq(references.id, c.referenceId)).get())
      .filter(Boolean) as any[];

    const children: Paragraph[] = [
      new Paragraph({ text: doc.title || '未命名论文', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: `导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手`, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: '', spacing: { after: 120 } }),
    ];

    if (outline.sections?.length) {
      children.push(new Paragraph({ text: '大纲', heading: HeadingLevel.HEADING_1 }));
      outline.sections.forEach((s) => {
        children.push(new Paragraph({ text: s.title, bullet: { level: 0 } }));
        (s.subsections || []).forEach((sub) => children.push(new Paragraph({ text: sub, bullet: { level: 1 } })));
      });
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }

    children.push(new Paragraph({ text: '正文', heading: HeadingLevel.HEADING_1 }));
    const content = doc.content || '（正文为空）';
    const paragraphs = this.mdToPlain(content).split('\n');
    // 正文按段落转 docx 段落；识别 ## 标题提升为 Heading2
    for (const raw of paragraphs) {
      const line = raw.trim();
      if (!line) continue;
      if (/^##\s/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 160 } }));
      } else if (/^###\s/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^###\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 120 } }));
      } else {
        children.push(new Paragraph({ text: line, spacing: { after: 100 } }));
      }
    }

    if (refList.length) {
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      children.push(new Paragraph({ text: '参考文献', heading: HeadingLevel.HEADING_1 }));
      refList.forEach((r, i) => {
        const authors = (() => {
          try {
            const arr = JSON.parse(r.authors || '[]') as string[];
            return arr.length ? arr.join(', ') : '';
          } catch {
            return '';
          }
        })();
        const line = `${i + 1}. ${r.title}${authors ? ` — ${authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`;
        children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
      });
    }

    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    return {
      base64: buffer.toString('base64'),
      filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.docx`,
    };
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
    case 'bibtex': {
      // BibTeX（LaTeX 论文引用刚需）：@article{key, author, title, journal, year, doi}
      const arr = (() => {
        try {
          return JSON.parse(ref.authors || '[]') as string[];
        } catch {
          return [];
        }
      })();
      const keyBase = (arr[0]?.split(' ').pop() || 'unknown').toLowerCase().replace(/[^a-z]/g, '');
      const key = `${keyBase}${ref.year || 'n.d.'}`;
      const authorsBib = arr.length === 0 ? 'Anonymous' : arr.join(' and ');
      const titleClean = ref.title.replace(/[{}&%$#_^~\\]/g, '');
      const venueClean = (ref.venue || '').replace(/[{}&%$#_^~\\]/g, '');
      const doiLine = ref.doi ? `,
  doi = {${ref.doi}}` : '';
      return `@article{${key},
  author = {${authorsBib}},
  title = {${titleClean}},
  journal = {${venueClean}},
  year = {${ref.year || 'n.d.'}}${doiLine}
}`;
    }
    case 'gbt': {
      // GB/T 7714-2015 顺序编码制：[序号] 作者. 题名[文献类型标志]. 出版地: 出版者, 年份: 页码. DOI
      const namePart = (() => {
        try {
          const arr = JSON.parse(ref.authors || '[]') as string[];
          if (arr.length === 0) return '佚名';
          if (arr.length === 1) return arr[0];
          if (arr.length > 3) return `${arr[0]} 等`;
          return arr.join(', ');
        } catch {
          return '佚名';
        }
      })();
      return `[${index}] ${namePart}. ${ref.title}[J].${ref.venue ? ` ${ref.venue},` : ''} ${ref.year ? `${ref.year}.` : 'n.d.'}${ref.doi ? ` https://doi.org/${ref.doi}` : ''}`;
    }
    default:
      return `${authors} (${year.trim()}). ${ref.title}.${venue}${doi}`;
  }
}
