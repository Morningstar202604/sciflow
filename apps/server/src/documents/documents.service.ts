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

  /** versions JSON 历史元素：本轮起可选携带 name（纯 JSON 内嵌，无需 ensureColumn/列迁移） */
  private parseVersions(existing: { versions: string | null }): { version: number; content: string; updatedAt: number; name?: string }[] {
    return this.parseJson<{ version: number; content: string; updatedAt: number; name?: string }[]>(existing.versions ?? '[]');
  }

  /**
   * 缺口#2：为某个历史版本命名（PATCH /api/documents/:id/version-name）。
   *  - 幂等：同 version 重复命名直接覆盖 name，不新增历史条目；
   *  - 仅写入 versions JSON 内嵌的可选 name 字段，不动 content/updatedAt；
   *  - version 不存在（历史已被 MAX_VERSIONS=20 上限淘汰出数组）或 name 非法 → 400；
   *  - 返回更新后的整个 versions 数组。
   */
  setVersionName(id: string, version: number, name: string) {
    const existing = this.get(id);
    if (typeof version !== 'number' || !Number.isFinite(version)) throw new BadRequestException('version 必须是数字');
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new BadRequestException('版本名不能为空');
    if (trimmed.length > 80) throw new BadRequestException('版本名过长（≤80 字）');
    const versions = this.parseVersions(existing);
    const target = versions.find((v) => v.version === version);
    if (!target) {
      throw new BadRequestException(
        `未找到版本 v${version}：它可能尚未产生历史快照，或已被历史上限（${MAX_VERSIONS} 条）淘汰出数组`,
      );
    }
    target.name = trimmed;
    db.update(documents).set({ versions: JSON.stringify(versions), updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return versions;
  }

  /**
   * 缺口#4：按样式渲染正文锚点 + 文末参考文献列表（纯函数预览，永不落库）。
   *  - 序号样式（ieee/vancouver/gbt/nature/springer/acs）：正文 [n] 保持 [n]（citations 插入序 n=index+1，与现状一致），
   *    references 按插入序渲染，changed=false；
   *  - 著者-年样式（apa/chicago）：正文每个 [n] 重排为 (第一作者姓, 年份)，文末参考文献按作者姓字母序重排，changed=true；
   *    无作者/年份降级为 (佚名, n.d.)；同作者同年多篇按**正文重排后首次出现顺序**分配 a/b 后缀（首现 a、次现 b…），文末列表同步。
   *  - 幂等：相同 style 重复调用逐字节一致（纯函数变换，不读外部可变状态）。
   *  - 不落库：无论 dryRun 传与否，都只返回渲染结果，不写 documents.content——由前端预览确认后自行 PATCH content，
   *    避免破坏编辑器自动保存链。dryRun 入参仅为 API 对称/前向兼容保留。
   */
  renderCitations(docId: string, style: string, _dryRun?: boolean) {
    const doc = this.get(docId);
    const valid: CiteStyleKind[] = ['apa', 'ieee', 'vancouver', 'gbt', 'nature', 'chicago', 'springer', 'acs'];
    if (!valid.includes(style as CiteStyleKind)) throw new BadRequestException(`不支持的引用样式: ${style}`);
    const isAuthorYear = style === 'apa' || style === 'chicago';

    // citations 按存储顺序（rowid=插入序 = 前端 n=index+1）
    const rows = this.listCitations(docId);
    const refs = rows.map((r) => ({
      title: r.reference.title,
      authors: r.reference.authors ?? '[]',
      year: r.reference.year,
      venue: r.reference.venue ?? '',
      doi: r.reference.doi ?? '',
    }));
    const content = doc.content || '';

    // 序号样式：正文锚点与参考文献顺序均不变
    if (!isAuthorYear) {
      const references = refs.map((ref, i) => formatRefEntry8(ref, style, i + 1));
      return { content, references, style, changed: false };
    }

    // 著者-年样式：解析每条 citation 的第一作者姓 / 年
    const meta = refs.map((ref) => {
      const arr = parseAuthorArr(ref.authors);
      const surname = arr.length ? surnameOf(arr[0]) : '佚名';
      const year = ref.year ? String(ref.year) : 'n.d.';
      return { ref, surname, year };
    });

    // key = 第一作者姓(小写)||年；文末参考文献按此字母序
    const keyOf = (i: number) => `${meta[i].surname.toLowerCase()}||${meta[i].year}`;
    // 先按正文锚点 [n] 的出现顺序收集 citation 下标（0 基），用于 a/b 后缀按正文首现序分配
    const anchorOrder: number[] = [];
    const anchorRe = /\[(\d+)\]/g;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(content)) !== null) {
      const n = Number(am[1]);
      if (Number.isInteger(n) && n >= 1 && n <= meta.length) anchorOrder.push(n - 1);
    }
    // 同 (姓,年) 组内不同引用的数量：≥2 才需要 a/b 后缀
    const groupSize = new Map<string, number>();
    for (let i = 0; i < meta.length; i++) groupSize.set(keyOf(i), (groupSize.get(keyOf(i)) || 0) + 1);

    // 按正文首现序分配 a/b：组内第一次出现→a、第二次→b…；同一引用多次出现复用同一后缀
    const letterByIndex: string[] = meta.map(() => '');
    const groupNext = new Map<string, number>();
    for (const i of anchorOrder) {
      const key = keyOf(i);
      if ((groupSize.get(key) || 0) < 2 || letterByIndex[i]) continue;
      const next = groupNext.get(key) || 0;
      letterByIndex[i] = String.fromCharCode(97 + next);
      groupNext.set(key, next + 1);
    }
    // 兜底：组内未在正文出现的引用，按插入序补字母（确定性，保证纯函数幂等）
    for (let i = 0; i < meta.length; i++) {
      const key = keyOf(i);
      if ((groupSize.get(key) || 0) < 2 || letterByIndex[i]) continue;
      const next = groupNext.get(key) || 0;
      letterByIndex[i] = String.fromCharCode(97 + next);
      groupNext.set(key, next + 1);
    }

    // 正文 [n] → (姓, 年{letter})；n 越界（非本文档引用锚点）原样保留
    const contentOut = content.replace(/\[(\d+)\]/g, (m, g1) => {
      const n = Number(g1);
      if (!Number.isInteger(n) || n < 1 || n > meta.length) return m;
      const i = n - 1;
      return `(${meta[i].surname}, ${meta[i].year}${letterByIndex[i]})`;
    });

    // 参考文献按 key（作者姓字母序→年）；同 key 组内按后缀字母序（= 正文首现序）
    const order = meta.map((_, i) => i);
    order.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return letterByIndex[a] < letterByIndex[b] ? -1 : letterByIndex[a] > letterByIndex[b] ? 1 : 0;
    });
    const references = order.map((idx) => formatRefEntry8(meta[idx].ref, style, 0, `${meta[idx].year}${letterByIndex[idx]}`));
    return { content: contentOut, references, style, changed: true };
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

  /** 三段式润色/降重并记录历史（图表/参考文献尾部原样保留，避免被当章节润色洗掉） */
  async polish(id: string, text: string, mode: 'polish' | 'reduce' = 'polish') {
    const doc = this.get(id);
    const content = String(text ?? '');
    const refIdx = content.indexOf('\n\n## 参考文献');
    const figIdx = content.indexOf('\n\n## 图表');
    const cuts = [refIdx, figIdx].filter((i) => i >= 0);
    const cut = cuts.length ? Math.min(...cuts) : -1;
    const bodyPart = cut >= 0 ? content.slice(0, cut) : content;
    const tailPart = cut >= 0 ? content.slice(cut) : '';
    const result = await this.ai.polish(bodyPart, mode);
    const polished = `${String(result.polished ?? '').trim()}\n\n${tailPart}`.trim();
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: mode,
        original: result.original,
        polished,
        reason: result.reason,
        createdAt: Date.now(),
      })
      .run();
    return { ...result, polished };
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

/* =====================================================================
 * 缺口#4：render-citations 用的 8 样式单条条目渲染——逐行镜像前端 WritingPage.formatRefEntry，
 * 保证后端预览列表与前端所见一致（加粗/斜体以纯文本近似）。
 * ===================================================================== */
type CiteStyleKind = 'apa' | 'ieee' | 'vancouver' | 'gbt' | 'nature' | 'chicago' | 'springer' | 'acs';

function parseAuthorArr(authors: string): string[] {
  try {
    const a = JSON.parse(authors || '[]');
    return Array.isArray(a) ? a.filter(Boolean) : [];
  } catch {
    return [];
  }
}
/** "First Middle Last" -> "Last" */
function surnameOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : a;
}
/** "First Middle Last" -> "F. M." */
function initialsOf(a: string): string {
  const parts = a.trim().split(/\s+/).filter(Boolean);
  parts.pop();
  return parts.map((p) => p.charAt(0).toUpperCase()).join('. ') + (parts.length ? '.' : '');
}

type RefLite = { title: string; authors: string; year: number | null; venue: string; doi: string };

/** 单条参考文献条目渲染（镜像前端 formatRefEntry）。yearOverride 用于著者-年样式注入 a/b 后缀 */
function formatRefEntry8(ref: RefLite, format: string, index: number, yearOverride?: string): string {
  const arr = parseAuthorArr(ref.authors);
  const year = yearOverride ?? (ref.year ? `${ref.year}` : 'n.d.');
  const venue = ref.venue || '';
  const doi = ref.doi ? ` https://doi.org/${ref.doi}` : '';
  const t = ref.title || 'Untitled';

  const apaAuthors = arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : `${arr[0]} et al.`;
  const iniOf = (a: string) => initialsOf(a).replace(/\.\s?/g, '');
  const ieeeAuthors = arr.map((a) => (iniOf(a) ? `${initialsOf(a)} ${surnameOf(a)}` : surnameOf(a))).join(', ');
  const vanAuthors = arr.map((a) => `${surnameOf(a)} ${iniOf(a)}`.trim()).join(', ');
  const semiAuthors = arr.map((a) => `${surnameOf(a)}${iniOf(a) ? `, ${initialsOf(a)}` : ''}`).join('; ');
  const gbtAuthors = arr.length === 0 ? '佚名' : arr.length === 1 ? arr[0] : arr.length > 3 ? `${arr[0]} 等` : arr.join(', ');

  switch (format) {
    case 'ieee':
      return `[${index}] ${ieeeAuthors || 'Anonymous'} "${t},"${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'vancouver':
      return `${index}. ${vanAuthors || 'Anonymous'} ${t}.${venue ? ` ${venue}.` : ''} ${year}.${doi}`;
    case 'gbt':
      return `[${index}] ${gbtAuthors}. ${t}[J].${venue ? ` ${venue},` : ''} ${year}.${doi}`;
    case 'nature': {
      const names = arr.slice(0, 6).map((a) => `${iniOf(a)} ${surnameOf(a)}`.trim()).join(', ');
      return `[${index}] ${names || 'Anonymous'}${arr.length > 6 ? ' et al.' : ''}. ${t}. ${venue} ${year}.${doi}`;
    }
    case 'chicago': {
      const names =
        arr.length === 0 ? 'Anonymous' : arr.length === 1 ? arr[0] : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
      return `${names}. ${year}. "${t}."${venue ? ` ${venue}.` : ''}${doi}`;
    }
    case 'springer':
    case 'acs':
      return `[${index}] ${semiAuthors || 'Anonymous'}. ${t}. ${venue} ${year}.${doi}`;
    case 'apa':
    default:
      return `${apaAuthors} (${year}). ${t}.${venue ? ` ${venue}.` : ''}${doi}`;
  }
}
