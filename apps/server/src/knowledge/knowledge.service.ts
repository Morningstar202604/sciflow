import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { sqlite } from '../db/database';
import { knowledgeDocs, knowledgeChunks, references } from '../db/schema';
import { eq, inArray, and, asc } from 'drizzle-orm';
import { AiService } from '../ai/ai.service';
import { EmbeddingService } from './embedding.service';
import { fingerprint } from '../common/fingerprint';
import { parseAuthors } from '../common/authors';

const CHUNK_SIZE = 800; // 每块约 800 字（段落聚合，与文档切分逻辑保持一致）

/** 文献库↔知识库打通（#5）：列表/检索中嵌入的 reference 摘要 */
interface RefSummary {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
  /** 归一化后的作者串（逗号分隔；无作者为空串） */
  authors: string;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly ai: AiService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** 文本分块：按段落聚合到 CHUNK_SIZE */
  private chunkText(text: string): string[] {
    const cleaned = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned) return [];
    const paragraphs = cleaned.split('\n\n').filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let buf = '';
    for (const p of paragraphs) {
      if (buf && buf.length + p.length > CHUNK_SIZE) {
        chunks.push(buf.trim());
        buf = '';
      }
      buf += (buf ? '\n\n' : '') + p;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  // ---------- 文献库↔知识库打通（#5） ----------
  /** 上传时按标题自动命中项目内已有文献：先指纹精确，再忽略大小写标题兜底；命中不中都可继续（不强绑） */
  private matchReference(projectId: string, title: string): string | null {
    const fp = fingerprint(title);
    const all = db.select().from(references).where(eq(references.projectId, projectId)).all();
    const hit = all.find(
      (r) => (fp && r.fingerprint === fp) || (r.title || '').trim().toLowerCase() === (title || '').trim().toLowerCase(),
    );
    return hit ? hit.id : null;
  }

  /**
   * 差距 #6 补全：标题指纹未命中时，把上传文件名自动建成一条文献（source='knowledge-upload'）并回填 referenceId。
   * 判定逻辑（谨慎防误建）：
   *  1) 标题取 name 去扩展名后 trim，长度必须 ≥ 4；
   *  2) 标题含「笔记/纪要/备忘录/会议/草稿/提纲/notes/memo/minutes/agenda/todo」等词时视为非论文文档，不建；
   *  3) 同项目标题指纹已存在则不重复建（幂等）。
   */
  private autoCreateReference(projectId: string, name: string): string | null {
    const title = (name || '').replace(/\.[a-zA-Z0-9]{1,12}$/, '').trim();
    if (title.length < 4) return null;
    if (/笔记|纪要|备忘录|会议|草稿|提纲|notes?|memo|minutes|agenda|todo/i.test(title)) return null;
    const fp = fingerprint(title);
    if (fp) {
      const dup = db.select().from(references).where(and(eq(references.projectId, projectId), eq(references.fingerprint, fp))).get();
      if (dup) return dup.id;
    }
    const id = randomUUID();
    db.insert(references)
      .values({
        id,
        projectId,
        title,
        authors: '[]',
        year: null,
        venue: '',
        doi: '',
        url: '',
        abstract: '',
        source: 'knowledge-upload',
        tags: '[]',
        citationCount: 0,
        readingStatus: 'unread',
        fingerprint: fp,
        isDuplicateOf: '',
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /** 批量取 reference 摘要映射：docId -> RefSummary（列表/检索共用，避免 N+1） */
  private referenceSummaryMap(rows: { referenceId: string | null }[]): Map<string, RefSummary> {
    const refIds = [...new Set(rows.map((r) => r.referenceId).filter((x): x is string => !!x))];
    const map = new Map<string, RefSummary>();
    if (refIds.length === 0) return map;
    for (const r of db.select().from(references).where(inArray(references.id, refIds)).all()) {
      map.set(r.id, {
        id: r.id,
        title: r.title,
        year: r.year,
        venue: r.venue ?? '',
        citationCount: r.citationCount ?? 0,
        authors: this.formatAuthorsForSummary(r.authors),
      });
    }
    return map;
  }

  /** 渲染作者 JSON 为逗号分隔字符串（摘要用）；复用 common/authors 的公共解析，避免对象元素渲染为 [object Object] */
  private formatAuthorsForSummary(authorsJson: string | null): string {
    return parseAuthors(authorsJson).join(', ');
  }

  /** 上传文档（type: text | pdf | markdown；content 为文本或 PDF 的 base64）
   *  RAG 升级：每块生成 BLOB 向量（sqlite-vec ANN 检索）+ 文档上下文前缀（Contextual Retrieval） */
  async upload(projectId: string, name: string, type: string, content: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
    let text = '';
    if (type === 'pdf') {
      try {
        const buf = Buffer.from(content, 'base64');
        const parsed = await pdfParse(buf);
        text = parsed.text || '';
      } catch (e: any) {
        throw new HttpException(`PDF 解析失败: ${e.message}`, HttpStatus.BAD_REQUEST);
      }
    } else {
      text = content;
    }
    const chunks = this.chunkText(text);
    if (chunks.length === 0) throw new HttpException('文档内容为空或无法解析', HttpStatus.BAD_REQUEST);

    const docId = randomUUID();
    // 文献库↔知识库打通：先按文档标题指纹命中项目内已有文献回填 referenceId
    let referenceId = this.matchReference(projectId, name);
    if (!referenceId) referenceId = this.autoCreateReference(projectId, name);
    // Contextual Retrieval：文档级上下文描述（文档名 + 首段要点），检索时拼在块前，显著提升命中精度
    const head = text.replace(/\s+/g, ' ').trim().slice(0, 100);
    const context = `【${name}】${head}`;

    // 向量嵌入：为每个 chunk 生成 embedding BLOB（异步批量）
    const embeddings = await this.embedChunks(chunks);

    // 事务写入：doc + chunks + vec0 虚拟表（崩溃时自动回滚，防止"有 doc 无 chunk"的脏数据）
    const insertDoc = sqlite.transaction(() => {
      db.insert(knowledgeDocs).values({
        id: docId,
        projectId,
        name,
        type,
        chunkCount: chunks.length,
        referenceId,
        createdAt: Date.now(),
      }).run();
      const insertChunk = sqlite.prepare(
        `INSERT INTO knowledge_chunk (id, doc_id, content, seq, context, embedding) VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insertVec = sqlite.prepare(
        `INSERT OR REPLACE INTO knowledge_chunks_embedding (chunk_id, embedding) VALUES (?, ?)`
      );
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, docId, chunks[i], i, context, embeddings[i] ?? null);
        // vec0 仅在有向量时写入（无向量则走 LIKE/BM25 兜底检索）
        if (embeddings[i]) insertVec.run(chunkId, embeddings[i]);
      }
    });
    insertDoc();

    return { id: docId, name, chunkCount: chunks.length, referenceId: referenceId || null };
  }

  /** 为多段文本生成 embedding 数组（返回 Float32Array 序列化后的 Buffer；失败时对应位置为 null） */
  private async embedChunks(texts: string[]): Promise<(Buffer | null)[]> {
    return Promise.all(texts.map((t) => this.embedding.embed(t)));
  }

  /** 项目知识库列表：每条嵌入绑定文献的摘要（未绑定时 reference=null） */
  async list(projectId: string) {
    const docs = db
      .select()
      .from(knowledgeDocs)
      .where(eq(knowledgeDocs.projectId, projectId))
      .orderBy(knowledgeDocs.createdAt)
      .all();
    const refMap = this.referenceSummaryMap(docs);
    return docs.map((d) => ({ ...d, reference: d.referenceId ? (refMap.get(d.referenceId) || null) : null }));
  }

  /**
   * 学习复盘取数：按 id 返回文档元信息 + 全部分块正文（按 seq 升序）+ outline。
   * outline 从分块正文里抽取 Markdown 标题（#/##/###）派生；无任何标题时返回 null。
   */
  async get(id: string) {
    const doc = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get();
    if (!doc) throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    const chunks = db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.docId, id))
      .orderBy(asc(knowledgeChunks.seq))
      .all();
    const headings: string[] = [];
    for (const c of chunks) {
      for (const line of (c.content || '').split('\n')) {
        const m = line.match(/^\s{0,3}(#{1,3})\s+(\S.*?)\s*$/);
        if (m) {
          const h = m[2].trim();
          if (h && !headings.includes(h)) headings.push(h);
        }
      }
    }
    const outline = headings.length > 0 ? headings.join('\n') : null;
    const refMap = this.referenceSummaryMap([doc]);
    return {
      ...doc,
      chunks: chunks.map((c) => ({ id: c.id, seq: c.seq, content: c.content })),
      outline,
      reference: doc.referenceId ? (refMap.get(doc.referenceId) || null) : null,
    };
  }

  /** 手动绑定/解除文献：入参 referenceId 传 null 即解绑；绑定校验文献必须属于同一项目 */
  async bind(id: string, referenceId: string | null) {
    const doc = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get();
    if (!doc) throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    let resolved: string | null = null;
    if (referenceId) {
      const ref = db
        .select()
        .from(references)
        .where(and(eq(references.id, referenceId), eq(references.projectId, doc.projectId)))
        .get();
      if (!ref) throw new HttpException('绑定失败：所选文献不在当前项目内', HttpStatus.BAD_REQUEST);
      resolved = ref.id;
    }
    await db.update(knowledgeDocs).set({ referenceId: resolved }).where(eq(knowledgeDocs.id, id)).run();
    const updated = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get()!;
    const refMap = this.referenceSummaryMap([updated]);
    return { ...updated, reference: updated.referenceId ? (refMap.get(updated.referenceId) || null) : null };
  }

  async remove(id: string) {
    // 同步清理 vec0 虚拟表
    const chunkRows = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.docId, id)).all();
    const delVec = sqlite.prepare('DELETE FROM knowledge_chunks_embedding WHERE chunk_id = ?');
    for (const c of chunkRows) delVec.run(c.id);
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, id));
    await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return { ok: true };
  }

  // ---------- 检索升级：sqlite-vec ANN 向量检索（替代手搓 BM25 + TF 余弦混合） ----------

  /** 向量 ANN 检索（sqlite-vec vec0）：语义召回 TopK */
  private async annSearch(projectId: string, questionEmbedding: Buffer | null, topK: number): Promise<any[]> {
    if (!questionEmbedding) {
      // 模型不可用，回退 LIKE 兜底
      return this.likeSearch(projectId, topK);
    }
    try {
      const rows = sqlite
        .prepare(
          `SELECT c.id AS chunk_id, c.doc_id, c.content, c.context, c.seq,
                  d.name AS doc_name, d.reference_id,
                  e.distance
           FROM knowledge_chunks_embedding e
           JOIN knowledge_chunk c ON c.id = e.chunk_id
           JOIN knowledge_doc d ON d.id = c.doc_id
           WHERE d.project_id = ? AND e.embedding MATCH ?
           ORDER BY e.distance ASC
           LIMIT ?`,
        )
        .all(projectId, questionEmbedding, topK + 5) as any[]; // 多召回 5 条留给 rerank/去重
      return rows;
    } catch {
      // vec0 不可用时回退到 LIKE 全文兜底
      return this.likeSearch(projectId, topK);
    }
  }

  /** LIKE 兜底检索（当 sqlite-vec 不可用或 chunk 无 embedding 时回退） */
  private likeSearch(projectId: string, topK: number): any[] {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    const chunks = db.select().from(knowledgeChunks).where(inArray(knowledgeChunks.docId, docs.map((d) => d.id))).all();
    return chunks.map((c) => ({
      chunk_id: c.id,
      doc_id: c.docId,
      content: c.content,
      context: c.context,
      seq: c.seq,
      doc_name: docs.find((d) => d.id === c.docId)?.name || '未知',
      reference_id: docs.find((d) => d.id === c.docId)?.referenceId || null,
      distance: 999,
    }));
  }

  async search(projectId: string, question: string, topK = 5) {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    const refMap = this.referenceSummaryMap(docs);

    // 向量语义召回
    const qVec = await this.embedding.embed(question);
    const hitRows = await this.annSearch(projectId, qVec, topK);

    return hitRows
      .slice(0, topK)
      .map((row) => ({
        id: row.chunk_id,
        docId: row.doc_id,
        docName: row.doc_name,
        content: row.content,
        context: row.context || null,
        seq: row.seq,
        // ANN 距离有效时用 (1-distance)*100 换算百分制；兜底 LIKE 命中给固定中间分，保证排序稳定
        score: row.distance < 999 ? Math.max(0, Math.round((1 - row.distance) * 100)) : 15,
        referenceId: row.reference_id || null,
        referenceTitle: row.reference_id ? (refMap.get(row.reference_id)?.title || null) : null,
        referenceAuthors: row.reference_id ? (refMap.get(row.reference_id)?.authors || null) : null,
        referenceYear: row.reference_id ? (refMap.get(row.reference_id)?.year || null) : null,
      }));
  }

  /** RAG 问答：检索 + LLM 基于资料回答（Contextual Retrieval：块前带文档上下文前缀） */
  async query(projectId: string, question: string) {
    const hits = await this.search(projectId, question, 5);
    if (hits.length === 0) {
      return { answer: '知识库中没有找到与问题相关的资料。请先上传相关文献或文档。', sources: [] };
    }
    const chunksText = hits
      .map((h, i) => `【来源${i + 1}｜文档：${h.docName}】\n${h.context ? `${h.context}\n` : ''}${h.content}`)
      .join('\n\n---\n\n');
    const answer = await this.ai.knowledgeQa(question, chunksText);
    return {
      answer,
      sources: hits.map((h) => ({
        docName: h.docName,
        snippet: h.content.slice(0, 120),
        score: h.score,
        chunkId: h.id,
        chunkText: h.content,
        chunkSeq: h.seq,
        referenceId: h.referenceId ?? null,
        referenceTitle: h.referenceTitle ?? null,
        referenceAuthors: h.referenceAuthors ?? null,
        referenceYear: h.referenceYear ?? null,
      })),
    };
  }
}
