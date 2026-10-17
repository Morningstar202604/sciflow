import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AiService, ChatMessage, ChatStreamOptions } from '../ai/ai.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ChatSessionService } from './chat-session.service';
import { WebSearchService } from '../websearch/websearch.service';
import { db } from '../db/database';
import { projects } from '../db/schema';

/** RAG 来源（随 SSE 首事件下发给前端）
 *  向后兼容：旧字段 docName/score 保留；chunkText/chunkSeq/referenceId/referenceTitle 为本轮新增附加字段，
 *  与 knowledge query 的 sources 对齐（旧客户端只认 docName/score，多出来的字段被忽略，不受影响）。 */
export interface ChatSource {
  docName: string;
  score: number;
  /** 命中块文本（来源卡片"展开原文"；截断到 CHUNK_TEXT_MAX_LEN 字符，超限末尾加截断标记，未超限原样） */
  chunkText: string;
  /** 命中块在所属知识库文档内的分块序号（0 起，来自 knowledge_chunk.seq） */
  chunkSeq: number;
  /** 该块绑定的文献 id（未绑定为 null） */
  referenceId: string | null;
  /** 绑定文献标题（未绑定为 null） */
  referenceTitle: string | null;
  /** 差距#2：绑定文献作者串（逗号分隔；未绑定为 null） */
  referenceAuthors: string | null;
  /** 差距#2：绑定文献年份（未绑定为 null） */
  referenceYear: number | null;
}

/** sources.chunkText 上限：超过则截断并在末尾加明确标记；前端可凭 chunkSeq 经 GET /api/knowledge/:id 取全文 */
const CHUNK_TEXT_MAX_LEN = 2000;
const CHUNK_TRUNC_MARK = '…[已截断]';

function truncateChunkText(text: string): string {
  if (!text || text.length <= CHUNK_TEXT_MAX_LEN) return text ?? '';
  return text.slice(0, CHUNK_TEXT_MAX_LEN) + CHUNK_TRUNC_MARK;
}

interface ChatRuntimeOptions {
  /** 显式覆盖模型 ID（best-effort 透传 ai 层） */
  model?: string;
  /** 开启推理过程输出 */
  enableThinking?: boolean;
  /** 客户端断连信号 */
  signal?: AbortSignal;
}

/** Agent 化科研问答：回答前自动注入项目记忆 + 跨会话摘要 + 知识库 RAG 上下文 */
@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly knowledge: KnowledgeService,
    private readonly chatSession: ChatSessionService,
    private readonly websearch: WebSearchService,
  ) {}

  /** 组装项目上下文：程序/情景记忆 + 知识库检索片段（NotebookLM 式 RAG 注入）；同时返回去重后的来源列表
   *  historyLen=0 时自动注入最近 N 轮对话摘要（跨会话记忆不丢失） */
  private async contextFor(projectId?: string, question?: string, docContext?: string, historyLen = 0): Promise<{ context: string; sources: ChatSource[] }> {
    const parts: string[] = [];
    const sources: ChatSource[] = [];
    // 跨会话摘要注入：新对话（history 为空）时自动注入最近几轮摘要
    try {
      if (projectId && historyLen === 0) {
        const pastCtx = this.chatSession.injectPastSummary(projectId);
        if (pastCtx) parts.push(pastCtx);
      }
    } catch { /* 注入失败不影响主流程 */ }
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
    let hitsLen = 0;
    try {
      if (docContext && docContext.trim()) {
        parts.push(`当前正在撰写的论文（优先理解并关联此上下文）：\n${docContext.trim().slice(0, 2500)}`);
      }
      if (projectId && question) {
        const hits = await this.knowledge.search(projectId, question, 3);
        hitsLen = hits.length;
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
              chunkText: truncateChunkText(h.content ?? ''),
              chunkSeq: h.seq ?? 0,
              referenceId: h.referenceId ?? null,
              referenceTitle: h.referenceTitle ?? null,
              referenceAuthors: h.referenceAuthors ?? null,
              referenceYear: h.referenceYear ?? null,
            });
          }
        }
      }
    } catch {
      /* 知识库不可用时忽略 */
    }
    // 联网搜索兜底（默认关闭；app_setting websearch_in_chat=on 开启）：知识库无命中时按当前 provider 搜索公开网页
    try {
      if (projectId && question && hitsLen === 0 && this.websearch.isChatSearchEnabled()) {
        const webResults = await this.websearch.search(question);
        if (webResults.length > 0) {
          parts.push(
            `联网搜索资料（公开网页，仅供背景参考，注意甄别时效与权威性）：\n${WebSearchService.toContext(webResults)}`,
          );
          for (const r of webResults.slice(0, 3)) {
            sources.push({
              docName: `🌐 ${r.title}`.slice(0, 80),
              score: 0,
              chunkText: r.snippet.slice(0, 200),
              chunkSeq: 0,
              referenceId: null,
              referenceTitle: null,
              referenceAuthors: null,
              referenceYear: null,
            });
          }
        }
      }
    } catch {
      /* 网搜失败静默跳过（不影响回答） */
    }
    return { context: parts.join('\n\n'), sources };
  }

  async answer(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string, opts: Pick<ChatRuntimeOptions, 'model'> = {}) {
    const { context, sources } = await this.contextFor(projectId, message, docContext, history.length);
    const answerText = context
      ? await this.ai.chatWithContext(message, history, context, { modelName: opts.model })
      : await this.ai.chat(message, history, { modelName: opts.model });
    return { answer: answerText, sources };
  }

  /** 异步记录本轮会话摘要（流结束后由 controller 触发，fire-and-forget） */
  recordSessionSummary(projectId: string, messages: ChatMessage[], totalTokens: number): void {
    void this.chatSession.recordSummary(projectId, messages, totalTokens);
  }

  /** 项目最近会话摘要列表（供前端"对话历史"面板） */
  listSessionSummaries(projectId: string) {
    return this.chatSession.listSummaries(projectId);
  }

  stream(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string, opts: ChatRuntimeOptions = {}) {
    return this.contextFor(projectId, message, docContext, history.length).then(async ({ context, sources }) => {
      const streamOpts: ChatStreamOptions = { modelName: opts.model, enableThinking: opts.enableThinking, signal: opts.signal };
      const stream = context
        ? await this.ai.streamChatWithContext(message, history, context, streamOpts)
        : await this.ai.streamChat(message, history, streamOpts);
      return { stream, sources };
    });
  }
}