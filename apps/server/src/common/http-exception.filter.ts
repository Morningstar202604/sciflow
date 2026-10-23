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
    // 例外：ZodError（service 层入参校验失败）是客户端错误 → 400 + 首条 issue，不是 500
    if (isZodError(exception)) {
      const first = exception.issues[0];
      const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
      this.logger.warn(`[Zod] 入参校验失败 ${path}${first?.message || ''}`);
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: truncate(`入参校验失败：${path}${first?.message || '字段类型或格式不符合要求'}`),
        error: 'Bad Request',
      });
      return;
    }
    // 例外 2：body-parser 的超限错误（type=entity.too.large）是客户端错误 → 413 可读中文，不是 500
    const tooLarge = asBodyParserError(exception);
    if (tooLarge) {
      this.logger.warn(`[Body] 请求体过大（上限 ${tooLarge.limit ?? '未知'}）`);
      response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `上传内容过大（上限 ${tooLarge.limit ?? '64mb'}），请压缩后重试`,
        error: 'Payload Too Large',
      });
      return;
    }
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

/** 结构化识别 body-parser 的超限错误（只认最小形状，不引 body-parser 类型） */
function asBodyParserError(e: unknown): { limit?: string } | null {
  if (typeof e !== 'object' || e === null) return null;
  const o = e as { type?: unknown; status?: unknown; statusCode?: unknown; limit?: unknown };
  const isTooLarge = o.type === 'entity.too.large' || o.status === 413 || o.statusCode === 413;
  if (!isTooLarge) return null;
  // body-parser 的 limit 是字节数（number），不是字符串；统一格式化成 MB 展示
  let limit: string | undefined;
  if (typeof o.limit === 'number' && Number.isFinite(o.limit)) {
    limit = `${Math.round((o.limit / (1024 * 1024)) * 10) / 10}mb`;
  } else if (typeof o.limit === 'string') {
    limit = o.limit;
  } else if (process.env.BODY_LIMIT) {
    limit = process.env.BODY_LIMIT;
  }
  return { limit };
}

/** 结构化识别 ZodError（避免直接 import zod 造成循环依赖：只认最小形状） */
function isZodError(e: unknown): e is { issues: { path: (string | number | symbol)[]; message: string }[] } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'issues' in e &&
    Array.isArray((e as { issues: unknown }).issues) &&
    (e as { issues: unknown[] }).issues.length > 0 &&
    typeof (e as { issues: Array<{ message?: unknown }> }).issues[0]?.message === 'string'
  );
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
