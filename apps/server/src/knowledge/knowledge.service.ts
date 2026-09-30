import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { db } from '../db/database';
import { knowledgeDocs, knowledgeChunks, references } from '../db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { AiService } from '../ai/ai.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const CHUNK_SIZE = 800; // 每块约 800 字

/** 文献库↔知识库打通（#5）：列表/检索中嵌入的 reference 摘要 */
interface RefSummary {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly ai: AiService) {}

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
  /** 标题归一化指纹：与 references.service 同一规则（lowercase + 去标点空白，取短 md5） */
  private fingerprint(title: string): string {
    const norm = (title || '').toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
    if (!norm) return '';
    return createHash('md5').update(norm).digest('hex').slice(0, 16);
  }

  /** 上传时按标题自动命中项目内已有文献：先指纹精确，再忽略大小写标题兜底；命中不中都可继续（不强绑） */
  private matchReference(projectId: string, title: string): string | null {
    const fp = this.fingerprint(title);
    const all = db.select().from(references).where(eq(references.projectId, projectId)).all();
    const hit = all.find(
      (r) => (fp && r.fingerprint === fp) || (r.title || '').trim().toLowerCase() === (title || '').trim().toLowerCase(),
    );
    return hit ? hit.id : null;
  }

  /** 批量取 reference 摘要映射：docId -> RefSummary（列表/检索共用，避免 N+1） */
  private referenceSummaryMap(rows: { referenceId: string | null }[]): Map<string, RefSummary> {
    const refIds = [...new Set(rows.map((r) => r.referenceId).filter((x): x is string => !!x))];
    const map = new Map<string, RefSummary>();
    if (refIds.length === 0) return map;
    for (const r of db.select().from(references).where(inArray(references.id, refIds)).all()) {
      map.set(r.id, { id: r.id, title: r.title, year: r.year, venue: r.venue ?? '', citationCount: r.citationCount ?? 0 });
    }
    return map;
  }

  /** 上传文档（type: text | pdf | markdown；content 为文本或 PDF 的 base64）
   *  RAG 升级：每块生成归一化 TF 向量（vector 列）+ 文档上下文前缀（context 列，Contextual Retrieval） */
  async upload(projectId: string, name: string, type: string, content: string) {
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
    // 文献库↔知识库打通：按文档标题自动命中项目内已有文献并回填 referenceId（不强绑，未命中则为 null）
    const referenceId = this.matchReference(projectId, name);
    // Contextual Retrieval：文档级上下文描述（文档名 + 首段要点），检索时拼在块前，显著提升命中精度
    const head = text.replace(/\s+/g, ' ').trim().slice(0, 100);
    const context = `【${name}】${head}`;
    await db.insert(knowledgeDocs).values({
      id: docId,
      projectId,
      name,
      type,
      chunkCount: chunks.length,
      referenceId,
      createdAt: Date.now(),
    });
    await db.insert(knowledgeChunks).values(
      chunks.map((c, i) => ({
        id: randomUUID(),
        docId,
        content: c,
        seq: i,
        context,
        vector: JSON.stringify(this.tfVector(c)),
      })),
    );
    return { id: docId, name, chunkCount: chunks.length, referenceId: referenceId || null };
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
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, id));
    await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return { ok: true };
  }

  // ---------- 检索升级：混合检索（BM25 词频-逆文档频率 + TF 向量余弦） ----------
  /** 轻量 tokenize：英文按词、中文按 bigram（零依赖，无需分词库） */
  private tokenize(text: string): string[] {
    const t = text.toLowerCase();
    const tokens: string[] = [];
    for (const m of t.matchAll(/[a-z][a-z0-9_-]{1,}/g)) tokens.push(m[0]);
    const cn = t.replace(/[^一-龥]/g, '');
    for (let i = 0; i < cn.length - 1; i++) tokens.push(cn.slice(i, i + 2));
    return tokens;
  }

  /** 归一化 TF 向量（L2 归一化，点积即余弦） */
  private tfVector(text: string): Record<string, number> {
    const tokens = this.tokenize(text);
    const freq: Record<string, number> = {};
    for (const tk of tokens) freq[tk] = (freq[tk] || 0) + 1;
    const norm = Math.sqrt(Object.values(freq).reduce((s, v) => s + v * v, 0)) || 1;
    const vec: Record<string, number> = {};
    for (const [k, v] of Object.entries(freq)) vec[k] = v / norm;
    return vec;
  }

  private cosine(a: Record<string, number>, b: Record<string, number>): number {
    let dot = 0;
    for (const [k, v] of Object.entries(a)) if (b[k]) dot += v * b[k];
    return dot;
  }

  /** BM25：词频加权 + 逆文档频率（对高频通用词降权，检索精度远胜子串包含） */
  private bm25(question: string, chunk: string, df: Map<string, number>, totalDocs: number): number {
    const qTokens = this.tokenize(question);
    const cTokens = this.tokenize(chunk);
    const cf: Record<string, number> = {};
    for (const t of cTokens) cf[t] = (cf[t] || 0) + 1;
    const docLen = cTokens.length || 1;
    const avgLen = 800;
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    for (const t of qTokens) {
      if (!cf[t]) continue;
      const f = df.get(t) || 0;
      const idf = Math.log(1 + (totalDocs - f + 0.5) / (f + 0.5));
      score += idf * ((cf[t] * (k1 + 1)) / (cf[t] + k1 * (1 - b + (b * docLen) / avgLen)));
    }
    return score;
  }

  async search(projectId: string, question: string, topK = 5) {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    const docIds = docs.map((d) => d.id);
    const chunks = db.select().from(knowledgeChunks).where(inArray(knowledgeChunks.docId, docIds)).all();
    if (chunks.length === 0) return [];

    // 文献库↔知识库打通：命中文档若绑定了文献，附带 referenceId/referenceTitle（前端显示"对应文献"）
    const refMap = this.referenceSummaryMap(docs);

    // 文档频率（BM25 逆文档频率分母）
    const df = new Map<string, number>();
    for (const c of chunks) {
      const seen = new Set(this.tokenize(c.content));
      for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
    }
    const qVec = this.tfVector(question);
    const scored = chunks
      .map((c) => {
        const doc = docs.find((d) => d.id === c.docId);
        const ref = doc?.referenceId ? refMap.get(doc.referenceId) : undefined;
        let cVec: Record<string, number> = {};
        try {
          cVec = JSON.parse(c.vector || '{}');
        } catch {
          cVec = this.tfVector(c.content);
        }
        const bm = this.bm25(question, c.content, df, chunks.length);
        const cos = this.cosine(qVec, cVec);
        // 混合评分：BM25 语义 + 余弦向量 互补（单边 0 分不归零，保留另一路信号）
        const score = bm * 1.0 + cos * 1.2;
        return {
          ...c,
          docName: doc?.name || '未知',
          score,
          referenceId: doc?.referenceId || null,
          referenceTitle: ref?.title || null,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
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
        score: Math.round(h.score * 100),
        // RAG 引用可点（#17）：chunkId + 完整块文本，前端"展开原文"查看（不跳 PDF）
        chunkId: h.id,
        chunkText: h.content,
        // 来源卡片：该块在所属文档内的分块序号（0 起，来自 knowledge_chunk.seq）
        chunkSeq: h.seq,
        // 文献库↔知识库打通（#5）：命中块若绑定文献，前端显示"对应文献"
        referenceId: h.referenceId ?? null,
        referenceTitle: h.referenceTitle ?? null,
      })),
    };
  }
}
