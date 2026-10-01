import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ChatService } from './chat.service';
import { ChatMessage } from '../ai/ai.service';

interface ChatRequestBody {
  message: string;
  history?: ChatMessage[];
  projectId?: string;
  docContext?: string;
  /** 可选：显式指定模型 ID（best-effort 覆盖默认模型） */
  model?: string;
  /** 可选：开启推理过程透传（delta.reasoning_content / delta.thinking） */
  enableThinking?: boolean;
}

/**
 * SSE 事件契约（向后兼容升级）：
 *  - `data: {"sources":[{docName,score,chunkText,chunkSeq,referenceId,referenceTitle}]}`   正文开始前一次（无命中则不发）
 *      · docName/score 为旧字段，保持不变；chunkText/chunkSeq/referenceId/referenceTitle 为本轮新增附加字段，
 *        与 knowledge query 的 sources 对齐。referenceId/referenceTitle 未绑定文献时为 null。旧客户端只读 docName/score，不受影响。
 *      · chunkText 截断到 ≤2000 字符，超限末尾追加 `…[已截断]`，未超限原样；字段名/长度变化不影响旧客户端。
 *        完整块可凭 chunkSeq 经 GET /api/knowledge/:id 取全文。
 *  - `data: {"delta":"..."}`                  正文增量（旧客户端兼容）
 *  - `data: {"delta":"...","reasoning":"..."}` 正文+推理过程同发（reasoning 仅在「深度思考」开启且上游有值时附加；
 *      对无视 thinking 参数、恒输出 reasoning_content 的推理型网关，关闭开关时此处不再下发 reasoning，保持折叠思维链 UI 静默）
 *  - `data: {"usage":{prompt_tokens,completion_tokens,total_tokens}}` 收尾一次
 *  - `data: {"error":"..."}`                  异常
 *  - `data: [DONE]`                           结束
 */
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async answer(@Body() body: ChatRequestBody) {
    return this.chat.answer(body.message, body.history || [], body.projectId, body.docContext, { model: body.model });
  }

  /** SSE 流式问答 */
  @Post('stream')
  async stream(@Body() body: ChatRequestBody, @Res() res: Response, @Req() req: Request) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // 前端停止流式时客户端断开 → 中止上游 fetch，避免生成空跑浪费 token（尽力而为）
    const ac = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      try {
        ac.abort();
      } catch {
        /* noop */
      }
    });

    // 深度思考开关：仅显式开启时才把上游推理增量（delta.reasoning_content / delta.thinking）透传给前端。
    // 部分推理型网关（如 u2-flash / DeepSeek-R1 兼容）无视 thinking 参数、每帧都带 reasoning_content；
    // 若不在此门控，关闭「深度思考」时折叠思维链 UI 仍会收到推理流，开关语义形同虚设。
    const forwardReasoning = body.enableThinking === true;
    try {
      const { stream, sources } = await this.chat.stream(
        body.message,
        body.history || [],
        body.projectId,
        body.docContext,
        { model: body.model, enableThinking: body.enableThinking, signal: ac.signal },
      );

      // 正文流开始前先推送 RAG 来源（无命中则不发送）
      if (sources.length && !closed) {
        res.write(`data: ${JSON.stringify({ sources })}\n\n`);
      }

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload) as any;
            const choice = json?.choices?.[0]?.delta || {};
            // 正文增量（行为与旧版完全一致）
            const delta: string | undefined = choice.content;
            // 推理过程透传：DeepSeek/通义系 reasoning_content，豆包系 thinking；仅深度思考开启时转发
            const reasoning: string | undefined = forwardReasoning ? choice.reasoning_content || choice.thinking : undefined;
            const chunk: Record<string, string> = {};
            if (delta) chunk.delta = delta;
            if (reasoning) chunk.reasoning = reasoning;
            if (Object.keys(chunk).length && !closed) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            // 用量收尾块（include_usage）：此块 choices 为空、usage 独立下发
            const usage = json?.usage;
            if (usage && !closed && (usage.prompt_tokens != null || usage.total_tokens != null)) {
              const prompt_tokens = Number(usage.prompt_tokens) || 0;
              const completion_tokens = Number(usage.completion_tokens) || 0;
              res.write(
                `data: ${JSON.stringify({
                  usage: {
                    prompt_tokens,
                    completion_tokens,
                    total_tokens: Number(usage.total_tokens) || prompt_tokens + completion_tokens,
                  },
                })}\n\n`,
              );
            }
          } catch {
            /* 未知字段/坏行忽略，绝不中断流式 */
          }
        }
      }
      if (!closed) res.write('data: [DONE]\n\n');
    } catch (e: any) {
      // 客户端主动断连属于正常停止，不回写 error 事件
      if (!closed) {
        res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
      }
    }
    res.end();
  }
}
