import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { sql, eq, and } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../db/database';
import { references, screeningQueue, extractionFields, extractionValues } from '../db/schema';
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

  /** 标题归一化指纹：lowercase + 去标点空白（保留字母数字与中日韩），再取短 md5（项目内去重依据） */
  private fingerprint(title: string): string {
    const norm = (title || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
    if (!norm) return '';
    return createHash('md5').update(norm).digest('hex').slice(0, 16);
  }

  /** 手动/检索结果入库（自动计算去重指纹，同项目内重复则标记 isDuplicateOf） */
  create(projectId: string, hit: Partial<PaperHit> & { title: string }) {
    if (!hit.title) throw new BadRequestException('文献标题必填');
    // 空元数据守卫：无作者且无年份的条目（如 Agentic RAG 补检的纯标题）不进文献库，
    // 避免污染引用池导致 [Unknown n.d.] / 佚名
    const authorsOk = (hit.authors || []).length > 0;
    if (!authorsOk && !hit.year) return null;
    // 标题归一化指纹去重：命中同项目已存在文献时，新条目标记为其重复（保留两条记录供筛选流程核对）
    const fp = this.fingerprint(hit.title);
    const dupOf = fp
      ? db
          .select()
          .from(references)
          .where(and(eq(references.projectId, projectId), eq(references.fingerprint, fp)))
          .get()
      : undefined;
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
      readingStatus: 'unread',
      fingerprint: fp,
      isDuplicateOf: dupOf ? dupOf.id : '',
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

  /** PATCH /:id：阅读状态 / 标签（tags 为 JSON 字符串） */
  update(id: string, patch: { readingStatus?: string; tags?: string }) {
    const existing = this.get(id);
    const set: Record<string, unknown> = {};
    if (patch.readingStatus !== undefined) {
      const allowed = ['unread', 'reading', 'read', 'cited'];
      if (!allowed.includes(patch.readingStatus)) throw new BadRequestException('readingStatus 取值不合法');
      set.readingStatus = patch.readingStatus;
    }
    if (patch.tags !== undefined) {
      // tags 以 JSON 字符串落库；校验可解析
      try {
        JSON.parse(patch.tags);
      } catch {
        throw new BadRequestException('tags 必须是合法 JSON 字符串');
      }
      set.tags = patch.tags;
    }
    db.update(references).set(set).where(eq(references.id, id)).run();
    return this.get(id);
  }

  // ---------- 系统综述·筛选队列 ----------

  /** 单条筛选：同 (project, reference) 已存在则更新，否则新建 */
  screenUpsert(projectId: string, referenceId: string, status: string, reason = '') {
    const allowed = ['pending', 'included', 'excluded', 'uncertain'];
    if (!allowed.includes(status)) throw new BadRequestException('筛选 status 取值不合法');
    const now = Date.now();
    const existing = db
      .select()
      .from(screeningQueue)
      .where(and(eq(screeningQueue.projectId, projectId), eq(screeningQueue.referenceId, referenceId)))
      .get();
    let id: string;
    if (existing) {
      id = existing.id;
      db.update(screeningQueue).set({ status, reason, updatedAt: now }).where(eq(screeningQueue.id, id)).run();
    } else {
      id = randomUUID();
      db.insert(screeningQueue)
        .values({ id, projectId, referenceId, status, reason, reviewer: 'me', createdAt: now, updatedAt: now })
        .run();
    }
    return this.screenList(projectId).find((s) => s.id === id);
  }

  /** 批量筛选 */
  screenBulk(projectId: string, referenceIds: string[], status: string, reason = '') {
    const allowed = ['pending', 'included', 'excluded', 'uncertain'];
    if (!allowed.includes(status)) throw new BadRequestException('筛选 status 取值不合法');
    let updated = 0;
    for (const refId of referenceIds || []) {
      this.screenUpsert(projectId, refId, status, reason);
      updated += 1;
    }
    return { ok: true, updated };
  }

  /** 筛选队列列表（join reference 元数据） */
  screenList(projectId: string) {
    const rows = db
      .select({
        id: screeningQueue.id,
        projectId: screeningQueue.projectId,
        referenceId: screeningQueue.referenceId,
        status: screeningQueue.status,
        reason: screeningQueue.reason,
        reviewer: screeningQueue.reviewer,
        createdAt: screeningQueue.createdAt,
        updatedAt: screeningQueue.updatedAt,
        title: references.title,
        year: references.year,
        venue: references.venue,
        authors: references.authors,
      })
      .from(screeningQueue)
      .leftJoin(references, eq(screeningQueue.referenceId, references.id))
      .where(eq(screeningQueue.projectId, projectId))
      .orderBy(screeningQueue.updatedAt)
      .all();
    return rows.map((r) => ({ ...r, title: r.title ?? '', venue: r.venue ?? '', authors: r.authors ?? '[]' }));
  }

  // ---------- 系统综述·文献编码抽取表 ----------

  /** 新建抽取字段（key 小写字母数字下划线，项目内唯一） */
  addExtractionField(projectId: string, key: string, label: string, kind = 'text', options: string[] = []) {
    const k = (key || '').trim();
    if (!/^[a-z0-9_]+$/.test(k)) throw new BadRequestException('key 仅允许小写字母、数字与下划线');
    if (!label?.trim()) throw new BadRequestException('字段 label 必填');
    const fieldKind = kind === 'select' ? 'select' : 'text';
    const dup = db
      .select()
      .from(extractionFields)
      .where(and(eq(extractionFields.projectId, projectId), eq(extractionFields.key, k)))
      .get();
    if (dup) throw new BadRequestException('该项目下已存在相同 key 的字段');
    const row = {
      id: randomUUID(),
      projectId,
      key: k,
      label: label.trim(),
      kind: fieldKind,
      options: JSON.stringify(Array.isArray(options) ? options.map(String) : []),
      createdAt: Date.now(),
    };
    db.insert(extractionFields).values(row).run();
    return this.toFieldDto(row);
  }

  listExtractionFields(projectId: string) {
    return db
      .select()
      .from(extractionFields)
      .where(eq(extractionFields.projectId, projectId))
      .orderBy(extractionFields.createdAt)
      .all()
      .map((f) => this.toFieldDto(f));
  }

  /** 删除字段并级联清理其取值 */
  removeExtractionField(id: string) {
    db.delete(extractionValues).where(eq(extractionValues.fieldId, id)).run();
    db.delete(extractionFields).where(eq(extractionFields.id, id)).run();
    return { ok: true };
  }

  /** 设置/更新某字段在某文献上的取值（upsert） */
  setExtractionValue(fieldId: string, referenceId: string, value: string) {
    const now = Date.now();
    const existing = db
      .select()
      .from(extractionValues)
      .where(and(eq(extractionValues.fieldId, fieldId), eq(extractionValues.referenceId, referenceId)))
      .get();
    if (existing) {
      db.update(extractionValues).set({ value: value ?? '', updatedAt: now }).where(eq(extractionValues.id, existing.id)).run();
    } else {
      db.insert(extractionValues)
        .values({ id: randomUUID(), fieldId, referenceId, value: value ?? '', createdAt: now, updatedAt: now })
        .run();
    }
    return { ok: true };
  }

  /** 抽取表矩阵：字段列表 + 每篇文献一行的取值映射 */
  extractionTable(projectId: string) {
    const fields = this.listExtractionFields(projectId);
    const refs = db.select().from(references).where(eq(references.projectId, projectId)).orderBy(references.createdAt).all();
    const fieldIds = fields.map((f) => f.id);
    const values = fieldIds.length
      ? db
          .select()
          .from(extractionValues)
          .where(sql`${extractionValues.fieldId} IN (${sql.join(fieldIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : [];
    const rows = refs.map((r) => {
      const valuesMap: Record<string, string> = {};
      for (const v of values) {
        if (v.referenceId === r.id) valuesMap[v.fieldId] = v.value ?? '';
      }
      return { referenceId: r.id, title: r.title, year: r.year, venue: r.venue ?? '', values: valuesMap };
    });
    return { fields, rows };
  }

  private toFieldDto(row: typeof extractionFields.$inferSelect) {
    let options: string[] = [];
    try {
      const parsed = JSON.parse(row.options || '[]');
      options = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      options = [];
    }
    return {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      label: row.label,
      kind: (row.kind === 'select' ? 'select' : 'text') as 'text' | 'select',
      options,
      createdAt: row.createdAt,
    };
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
