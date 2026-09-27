import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatMessage } from '../ai/ai.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  async answer(@Body() body: { message: string; history?: ChatMessage[]; projectId?: string; docContext?: string }) {
    return this.chat.answer(body.message, body.history || [], body.projectId, body.docContext);
  }

  /** SSE 流式问答 */
  @Post('stream')
  async stream(@Body() body: { message: string; history?: ChatMessage[]; projectId?: string; docContext?: string }, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const upstream = await this.chat.stream(body.message, body.history || [], body.projectId, body.docContext);
      const reader = upstream.getReader();
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
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          } catch {
            /* 忽略无法解析的行 */
          }
        }
      }
      res.write('data: [DONE]\n\n');
    } catch (e: any) {
      res.write(`data: ${JSON.stringify({ error: e.message || String(e) })}\n\n`);
    }
    res.end();
  }
}
