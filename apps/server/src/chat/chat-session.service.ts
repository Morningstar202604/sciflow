/**
 * 对话会话摘要服务（跨会话记忆注入）
 *
 * 对标 Cursor "长上下文对话摘要注入" 与 Claude "Contextual Retrieval"：
 *  - 每轮对话结束时，用 LLM 归纳当前轮的关键信息（≤500 字）落库
 *  - 新对话启动时（history 为空），自动注入最近 N 轮摘要作为上下文
 *  - 避免"金鱼脑"：跨会话保持项目记忆连续，同时控制 token 开销
 */

import { Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { chatSessions } from '../db/schema';
import { AiService } from '../ai/ai.service';
import type { ChatMessage } from '../ai/ai.service';

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);
  /** 注入上下文时最多携带的轮次数 */
  private static readonly INJECT_LIMIT = 5;
  /** 摘要最大字数 */
  private static readonly SUMMARY_MAX_LEN = 500;

  /** 列出项目最近会话摘要 */
  listSummaries(projectId: string, limit = ChatSessionService.INJECT_LIMIT) {
    return db.select().from(chatSessions).where(eq(chatSessions.projectId, projectId)).orderBy(desc(chatSessions.createdAt)).limit(limit).all();
  }

  /**
   * 为新对话注入历史摘要（仅当 history 为空时调用）：
   * 取最近 N 轮摘要，按时间正序组装为一段系统级上下文。
   * 若无历史摘要，返回空字符串（行为无变化）。
   */
  injectPastSummary(projectId: string): string {
    const rows = this.listSummaries(projectId);
    if (!rows.length) return '';
    return [
      '以下是你在该项目中最近几次对话的摘要（回答时请结合这些历史上下文；若与当前问题无关，可忽略）：',
      ...rows.reverse().map((r, i) => `[对话${i + 1}] ${r.summary || '（无摘要）'}`),
      '---',
    ].join('\n');
  }

  /**
   * 异步记录本轮对话摘要（fire-and-forget）：
   * 对话结束后由 controller 调用，LLM 失败时降级为截断拼接。
   */
  async recordSummary(projectId: string, messages: ChatMessage[], totalTokens: number): Promise<void> {
    if (messages.length < 2) return; // 至少一轮问答才有记录价值
    try {
      const dialogueText = messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 600)}`)
        .join('\n');
      const summaryPrompt = `请用中文简要归纳以下科研问答对话的关键信息（研究问题、结论、决定），控制在 ${ChatSessionService.SUMMARY_MAX_LEN} 字内：\n\n${dialogueText.slice(0, 4000)}`;
      let summary = '';
      try {
        summary = await this.ai.complete([{ role: 'user', content: summaryPrompt }], {
          temperature: 0.3,
          maxTokens: 300,
          model: 'fast',
          context: 'chatSessionSummary',
        });
        summary = summary.trim().slice(0, ChatSessionService.SUMMARY_MAX_LEN);
      } catch (e: any) {
        // LLM 失败时降级为截取首条用户消息 + AI 首句
        summary = messages.find((m) => m.role === 'user')?.content?.slice(0, 200) || '';
        this.logger.warn(`会话摘要 LLM 生成失败，降级为截断: ${e?.message || e}`);
      }
      const now = Date.now();
      db.insert(chatSessions)
        .values({
          id: randomUUID(),
          projectId,
          summary,
          messageCount: messages.filter((m) => m.role !== 'system').length,
          totalTokens: totalTokens || 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    } catch (e: any) {
      this.logger.warn(`记录会话摘要失败: ${e?.message || e}`);
    }
  }

  constructor(private readonly ai: AiService) {}
}
