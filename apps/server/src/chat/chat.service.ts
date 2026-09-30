import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AiService, ChatMessage, ChatStreamOptions } from '../ai/ai.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { db } from '../db/database';
import { projects } from '../db/schema';

/** RAG 来源（随 SSE 首事件下发给前端）
 *  向后兼容：旧字段 docName/score 保留；chunkText/chunkSeq/referenceId/referenceTitle 为本轮新增附加字段，
 *  与 knowledge query 的 sources 对齐（旧客户端只认 docName/score，多出来的字段被忽略，不受影响）。 */
export interface ChatSource {
  docName: string;
  score: number;
  /** 完整命中块文本（来源卡片"展开原文"；单块约数百~数千字符，SSE 单帧可接受） */
  chunkText: string;
  /** 命中块在所属知识库文档内的分块序号（0 起，来自 knowledge_chunk.seq） */
  chunkSeq: number;
  /** 该块绑定的文献 id（未绑定为 null） */
  referenceId: string | null;
  /** 绑定文献标题（未绑定为 null） */
  referenceTitle: string | null;
}

interface ChatRuntimeOptions {
  /** 显式覆盖模型 ID（best-effort 透传 ai 层） */
  model?: string;
  /** 开启推理过程输出 */
  enableThinking?: boolean;
  /** 客户端断连信号 */
  signal?: AbortSignal;
}

/** Agent 化科研问答：回答前自动注入项目记忆 + 知识库 RAG 上下文 */
@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** 组装项目上下文：程序/情景记忆 + 知识库检索片段（NotebookLM 式 RAG 注入）；同时返回去重后的来源列表 */
  private async contextFor(projectId?: string, question?: string, docContext?: string): Promise<{ context: string; sources: ChatSource[] }> {
    const parts: string[] = [];
    const sources: ChatSource[] = [];
    // 差距 #22：项目级系统提示 projectPreface 拼在上下文最前（即 system prompt 开头）；无 preface 时行为完全不变
    try {
      if (projectId) {
        const proj = db.select().from(projects).where(eq(projects.id, projectId)).get();
        if (proj?.preface?.trim()) parts.push(`项目要求：${proj.preface.trim()}`);
      }
    } catch {
      /* preface 不可用时忽略 */
    }
    try {
      const mems = this.memory.list(undefined, undefined, projectId).slice(0, 4);
      if (mems.length) {
        parts.push(`项目记忆（历史经验）：\n${mems.map((m) => `- [${m.type === 'procedural' ? '写作偏好' : '历史经验'}] ${m.content.slice(0, 400)}`).join('\n')}`);
      }
    } catch {
      /* 记忆不可用时忽略 */
    }
    try {
      if (docContext && docContext.trim()) {
        parts.push(`当前正在撰写的论文（优先理解并关联此上下文）：\n${docContext.trim().slice(0, 2500)}`);
      }
      if (projectId && question) {
        const hits = await this.knowledge.search(projectId, question, 3);
        if (hits.length) {
          parts.push(`知识库资料（回答可标注【来源:文档名】）：\n${hits.map((h) => `【来源:${h.docName}】${h.content.slice(0, 320)}`).join('\n')}`);
          // 同一文档多个片段只保留一条来源，取最高分块；该最高分块的 chunkText/chunkSeq/referenceId/referenceTitle 一并透传
          // （与 knowledge query 的 sources 字段对齐；docName/score 旧字段保留，新字段全部为附加）
          const byDoc = new Map<string, (typeof hits)[number]>();
          for (const h of hits) {
            const prev = byDoc.get(h.docName);
            if (!prev || h.score > prev.score) byDoc.set(h.docName, h);
          }
          for (const h of byDoc.values()) {
            sources.push({
              docName: h.docName,
              score: Math.round(h.score * 1000) / 1000,
              chunkText: h.content ?? '',
              chunkSeq: h.seq ?? 0,
              referenceId: h.referenceId ?? null,
              referenceTitle: h.referenceTitle ?? null,
            });
          }
        }
      }
    } catch {
      /* 知识库不可用时忽略 */
    }
    return { context: parts.join('\n\n'), sources };
  }

  async answer(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string, opts: Pick<ChatRuntimeOptions, 'model'> = {}) {
    const { context, sources } = await this.contextFor(projectId, message, docContext);
    const answerText = context
      ? await this.ai.chatWithContext(message, history, context, { modelName: opts.model })
      : await this.ai.chat(message, history, { modelName: opts.model });
    return { answer: answerText, sources };
  }

  stream(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string, opts: ChatRuntimeOptions = {}) {
    return this.contextFor(projectId, message, docContext).then(async ({ context, sources }) => {
      const streamOpts: ChatStreamOptions = { modelName: opts.model, enableThinking: opts.enableThinking, signal: opts.signal };
      const stream = context
        ? await this.ai.streamChatWithContext(message, history, context, streamOpts)
        : await this.ai.streamChat(message, history, streamOpts);
      return { stream, sources };
    });
  }
}
