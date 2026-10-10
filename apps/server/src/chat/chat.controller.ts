import { Controller, Post, Body, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ChatService } from './chat.service';
import { ChatMessage } from '../ai/ai.service';
import { forwardOpenAiSse } from '../common/sse.helper';

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
      try { ac.abort(); } catch { /* noop */ }
    });

    // 深度思考开关：仅显式开启时才把上游推理增量（delta.reasoning_content / delta.thinking）透传给前端。
    const forwardReasoning = body.enableThinking === true;
    try {
      const { stream, sources } = await this.chat.stream(
        body.message, body.history || [], body.projectId, body.docContext,
        { model: body.model, enableThinking: body.enableThinking, signal: ac.signal },
      );
      // 正文流开始前先推送 RAG 来源（无命中则不发送）
      if (sources.length && !closed) {
        res.write(`data: ${JSON.stringify({ sources })}\n\n`);
      }
      const result = await forwardOpenAiSse(res, { stream, forwardReasoning, signal: ac.signal });
      if (result.error && !closed) {
        res.write(`data: ${JSON.stringify({ error: result.error })}\n\n`);
      }
    } catch (e: any) {
      if (!closed) res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
    }
    res.end();
  }
}
