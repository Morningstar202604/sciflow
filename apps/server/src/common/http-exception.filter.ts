import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** 回给客户端的 message 最大长度（截断防止长堆栈/长错误细节外泄） */
const MAX_MESSAGE_LEN = 300;

/**
 * 全局异常过滤器：
 *  - HttpException：保留原 status 与 message 语义（前端/回归脚本依赖 400/503 等），
 *    仅把超长 message 截断到 300 字符，响应体结构与 Nest 默认保持一致
 *    （{ statusCode, message, error } 或原样透传自定义对象响应）。
 *  - 非 HttpException（未捕获异常/编程错误）：完整堆栈只写服务端日志，
 *    对客户端只返回通用 500，绝不回显堆栈/内部细节。
 *  - 响应已开始发送（如 SSE 流中途出错）时不再写 JSON body，仅记日志。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 流响应已中途开始（chat/stream 等 SSE），headersSent 后无法再换 JSON body
    if (response.headersSent) {
      this.logServerSide(exception);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let body: Record<string, unknown>;
      if (typeof raw === 'string') {
        body = {
          statusCode: status,
          message: truncate(raw),
          error: errorNameFor(status),
        };
      } else {
        body = { ...(raw as Record<string, unknown>) };
        if (typeof body.message === 'string') {
          body.message = truncate(body.message);
        }
      }
      response.status(status).json(body);
      return;
    }

    // 未捕获异常：堆栈仅落服务端日志，客户端拿不到任何内部细节
    this.logServerSide(exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }

  private logServerSide(e: unknown) {
    if (e instanceof Error) {
      this.logger.error(e.message, e.stack);
    } else {
      this.logger.error(String(e));
    }
  }
}

function truncate(s: string): string {
  return s.length > MAX_MESSAGE_LEN ? s.slice(0, MAX_MESSAGE_LEN) : s;
}

function errorNameFor(status: number): string {
  // 与 Nest 默认 error 名称对齐，保持既有错误语义
  const known: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return known[status] || `Error (${status})`;
}
