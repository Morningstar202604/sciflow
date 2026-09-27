import { Injectable } from '@nestjs/common';
import { AiService, ChatMessage } from '../ai/ai.service';
import { MemoryService } from '../memory/memory.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

/** Agent 化科研问答：回答前自动注入项目记忆 + 知识库 RAG 上下文 */
@Injectable()
export class ChatService {
  constructor(
    private readonly ai: AiService,
    private readonly memory: MemoryService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** 组装项目上下文：程序/情景记忆 + 知识库检索片段（NotebookLM 式 RAG 注入） */
  private async contextFor(projectId?: string, question?: string, docContext?: string): Promise<string> {
    const parts: string[] = [];
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
        }
      }
    } catch {
      /* 知识库不可用时忽略 */
    }
    return parts.join('\n\n');
  }

  async answer(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string) {
    const ctx = await this.contextFor(projectId, message, docContext);
    return { answer: ctx ? await this.ai.chatWithContext(message, history, ctx) : await this.ai.chat(message, history) };
  }

  stream(message: string, history: ChatMessage[] = [], projectId?: string, docContext?: string) {
    return this.contextFor(projectId, message, docContext).then((ctx) =>
      ctx ? this.ai.streamChatWithContext(message, history, ctx) : this.ai.streamChat(message, history),
    );
  }
}
