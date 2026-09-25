import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { knowledgeDocs, knowledgeChunks } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { AiService } from '../ai/ai.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const CHUNK_SIZE = 800; // 每块约 800 字

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

  /** 上传文档（type: text | pdf | markdown；content 为文本或 PDF 的 base64） */
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
    await db.insert(knowledgeDocs).values({
      id: docId,
      projectId,
      name,
      type,
      chunkCount: chunks.length,
      createdAt: Date.now(),
    });
    await db.insert(knowledgeChunks).values(
      chunks.map((c, i) => ({ id: randomUUID(), docId, content: c, seq: i })),
    );
    return { id: docId, name, chunkCount: chunks.length };
  }

  list(projectId: string) {
    return db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).orderBy(knowledgeDocs.createdAt);
  }

  async remove(id: string) {
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, id));
    await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return { ok: true };
  }

  /** 轻量检索：查询词与分块词重叠评分（零外部依赖 RAG） */
  private scoreChunk(question: string, chunk: string): number {
    const qWords = new Set(question.toLowerCase().split(/[\s,.;:!?，。；：！？()（）"']+/).filter((w) => w.length > 1));
    if (qWords.size === 0) return 0;
    const cLower = chunk.toLowerCase();
    let hit = 0;
    for (const w of qWords) {
      if (cLower.includes(w)) hit += 1;
    }
    return hit / qWords.size;
  }

  async search(projectId: string, question: string, topK = 5) {
    const docs = await db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId));
    if (docs.length === 0) return [];
    const docIds = docs.map((d) => d.id);
    const chunks = await db.select().from(knowledgeChunks).where(and(...docIds.map((id) => eq(knowledgeChunks.docId, id))));
    const scored = chunks
      .map((c) => {
        const doc = docs.find((d) => d.id === c.docId);
        return { ...c, docName: doc?.name || '未知', score: this.scoreChunk(question, c.content) };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }

  /** RAG 问答：检索 + LLM 基于资料回答 */
  async query(projectId: string, question: string) {
    const hits = await this.search(projectId, question, 5);
    if (hits.length === 0) {
      return { answer: '知识库中没有找到与问题相关的资料。请先上传相关文献或文档。', sources: [] };
    }
    const chunksText = hits.map((h, i) => `【来源${i + 1}｜文档：${h.docName}】\n${h.content}`).join('\n\n---\n\n');
    const answer = await this.ai.knowledgeQa(question, chunksText);
    return {
      answer,
      sources: hits.map((h) => ({ docName: h.docName, snippet: h.content.slice(0, 120), score: Math.round(h.score * 100) })),
    };
  }
}
