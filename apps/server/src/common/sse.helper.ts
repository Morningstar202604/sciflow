/**
 * SSE 流式响应助手（封装 NestJS + 原生 fetch 的 OpenAI 兼容流式转发）
 *
 * 替代 chat.controller.ts 中手写的 SSE 拼接 + JSON 解析逻辑，
 * 统一处理 delta/reasoning/usage 三种事件。
 */

import type { Response } from 'express';

export interface SseStreamOptions {
  /** 上游 Web ReadableStream（来自 OpenAI 兼容网关响应体） */
  stream: ReadableStream<Uint8Array>;
  /** 是否转发 reasoning_content / thinking（对应前端"深度思考"开关） */
  forwardReasoning: boolean;
  /** 客户端断连信号 */
  signal?: AbortSignal;
  /** 流完整结束（自然中止或 [DONE]）时的回调：传入累积的 assistant 全文 + 总 usage tokens */
  onComplete?: (fullText: string, totalTokens: number) => void;
}

export interface SseStreamResult {
  /** 异常（客户端断连除外） */
  error?: string;
  /** 累积的 assistant 正文全文（完整生成时；断连时为截至断开时已生成部分） */
  fullText?: string;
}

/** 向客户端写一个 SSE 事件 */
export function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 将 OpenAI 兼容 SSE 流转发到客户端
 *  - delta.content → { delta: string }
 *  - delta.reasoning_content / thinking → { reasoning: string } (仅 forwardReasoning)
 *  - usage → { usage: { prompt_tokens, completion_tokens, total_tokens } }
 *  - [DONE] → 自动终止
 */
export async function forwardOpenAiSse(res: Response, opts: SseStreamOptions): Promise<SseStreamResult> {
  const { stream, forwardReasoning, signal, onComplete } = opts;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let naturalEnd = false;
  let fullText = '';
  let totalTokens = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        onComplete?.(fullText, totalTokens);
        return { fullText };
      }
      const { done, value } = await reader.read();
      if (done) { naturalEnd = true; break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') { naturalEnd = true; break; }
        try {
          const json = JSON.parse(payload) as Record<string, unknown>;
          const choice = (json?.choices as Array<{ delta?: Record<string, unknown> }>)?.[0]?.delta ?? {};
          const delta = choice.content;
          const reasoning = forwardReasoning ? choice.reasoning_content || choice.thinking : undefined;
          if (typeof delta === 'string') fullText += delta;
          const chunk: Record<string, string> = {};
          if (typeof delta === 'string') chunk.delta = delta;
          if (typeof reasoning === 'string') chunk.reasoning = reasoning;
          if (Object.keys(chunk).length) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          // 收尾 usage 块
          const usage = json?.usage as Record<string, number> | undefined;
          if (usage && (usage.prompt_tokens != null || usage.total_tokens != null)) {
            totalTokens = Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
            res.write(
              `data: ${JSON.stringify({
                usage: {
                  prompt_tokens: Number(usage.prompt_tokens) || 0,
                  completion_tokens: Number(usage.completion_tokens) || 0,
                  total_tokens: totalTokens,
                },
              })}\n\n`,
            );
          }
        } catch {
          /* 忽略坏行 */
        }
      }
      if (naturalEnd) break;
    }
    res.write('data: [DONE]\n\n');
    onComplete?.(fullText, totalTokens);
    return { fullText };
  } catch (e: any) {
    if (signal?.aborted) {
      onComplete?.(fullText, totalTokens);
      return { fullText };
    }
    return { error: e?.message || String(e), fullText };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}