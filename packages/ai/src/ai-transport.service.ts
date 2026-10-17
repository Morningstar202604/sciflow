import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, generateObject, streamText, jsonSchema as aiJsonSchema, type ModelMessage, type LanguageModelUsage } from 'ai';
import type { LanguageModel } from 'ai';
import { decryptSecret } from '../../db/src/secret-crypto';
import { sqlite } from '../../db/src/database';
import { db } from '../../db/src/database';
import { llmCallLogs, customPrompts } from '../../db/src/schema';
import { eq } from 'drizzle-orm';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** chat 流式/问答的可选运行参数（best-effort 透传，厂商不支持时静默忽略） */
export interface ChatStreamOptions {
  /** 显式覆盖完整模型 ID（优先于 fast/strong 档位） */
  modelName?: string;
  /** 开启推理过程输出（对应上游 delta.reasoning_content / delta.thinking 透传） */
  enableThinking?: boolean;
  /** 客户端断连时中止上游生成，避免空跑 token */
  signal?: AbortSignal;
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** 模型档位：fast=轻量快速（默认），strong=强模型（长文/评审/规划等高难任务） */
  model?: 'fast' | 'strong';
  /** 调用方标识（成本追踪落库用） */
  context?: string;
  /** 显式指定完整模型 ID（覆盖 fast/strong 档位；best-effort） */
  modelName?: string;
  /** 流式请求收尾 usage 块（stream_options.include_usage） */
  streamIncludeUsage?: boolean;
  /** 外部 AbortSignal（客户端断连时中止上游请求） */
  signal?: AbortSignal;
  /** 思考模式开关：仅 true 时附加上下文厂商 thinking 参数；不支持的厂商静默忽略 */
  enableThinking?: boolean;
  /** JSON Schema 结构化输出（经 AI SDK jsonSchema 包装走 response_format） */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

/**
 * 底层 LLM 传输层 — 经 Vercel AI SDK（@ai-sdk/openai-compatible）访问 OpenAI 兼容端点，
 * 保留 fast/strong 路由、p-limit 限流、p-retry 退避、token 成本落库、多厂商切换。
 *
 * 协议细节（SSE 解析、分块拼装、usage 提取）由 AI SDK 承担，本层不再手写。
 * 不含任何 domain 级 prompt / 业务方法（那些在 AiService 里）。
 * 其他不相干服务也可以独立注入本 provider，复用 transport 层。
 */
@Injectable()
export class AiTransportService {
  protected readonly logger = new Logger(AiTransportService.name);

  protected baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  /** 当前生效密钥：优先 env，被激活厂商覆盖（v0.3.0 起库内为密文，读取时解密）。私有字段 + getter 暴露。 */
  private _secretKey = process.env.AI_API_KEY || '';
  /** fast 档：轻量快速模型（默认） */
  protected fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  protected strongModel = process.env.AI_MODEL_STRONG || this.fastModel;

  // ---------- 并发限流：p-limit（成熟库替代手写实现） ----------
  // RPM 换算为并发上限：假设单请求 ~10s，RPM 60 → 最多 6 并发；取保守值避免 429
  protected readonly limit = pLimit(Math.max(1, Math.floor(Number(process.env.AI_RPM_CAP || 60) / 6)));

  constructor() {
    this.applyActiveProvider();
  }

  /** 读取当前生效密钥 */
  protected get apiKey(): string {
    return this._secretKey;
  }

  /** 覆盖当前生效密钥（解密后写入） */
  protected setApiKey(v: string): void {
    this._secretKey = v;
  }

  /** 切换激活厂商（设置页调用，立即生效） */
  switchProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as
      | { base_url?: string; ['api_key']?: string; model?: string }
      | undefined;
    if (!row) throw new HttpException('模型厂商不存在', HttpStatus.NOT_FOUND);
    this.baseUrl = String(row.base_url).replace(/\/$/, '');
    if (row['api_key']) this.setApiKey(decryptSecret(String(row['api_key'])));
    this.fastModel = String(row.model);
    this.strongModel = String(row.model);
    sqlite.prepare('UPDATE model_provider SET is_active = 0 WHERE is_active = 1').run();
    sqlite.prepare('UPDATE model_provider SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** 回退到环境变量配置（删除激活中的厂商时调用，避免内存残留失效厂商） */
  resetToEnv() {
    this.baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.setApiKey(process.env.AI_API_KEY || '');
    this.fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
    this.strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  }

  /** 是否已配置 AI：仅当确有可用密钥时为 true（不再对未配置状态谎报可用） */
  get configured(): boolean {
    return !!this.apiKey;
  }

  get config(): { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean } {
    return { baseUrl: this.baseUrl, model: this.fastModel, fastModel: this.fastModel, strongModel: this.strongModel, configured: this.configured };
  }

  /** 自定义提示词查询：用户配置优先，未配置返回 null（调用方回退系统默认） */
  getCustomPrompt(toolKey: string): string | null {
    try {
      const row = db.select().from(customPrompts).where(eq(customPrompts.toolKey, toolKey)).get();
      return row?.enabled ? row.prompt : null;
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- //
  //  transport helpers                                              //
  // ----------------------------------------------------------------- //

  protected resolveModel(opts: CompleteOptions): string {
    if (opts.modelName) return opts.modelName;
    return opts.model === 'strong' ? this.strongModel : this.fastModel;
  }

  protected assertConfigured(): void {
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** 最近一次调用的总 token 数（流水线预算器打点用；每次调用覆盖） */
  lastTotalTokens = 0;

  /** LLM 调用成本追踪（token 用量审计，落 llm_call_log 表） */
  protected logLlmCall(opts: { caller: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number; success: boolean; error?: string }): void {
    try {
      this.lastTotalTokens = opts.promptTokens + opts.completionTokens;
      db.insert(llmCallLogs)
        .values({
          id: randomUUID(),
          caller: opts.caller || 'general',
          model: opts.model,
          promptTokens: opts.promptTokens,
          completionTokens: opts.completionTokens,
          totalTokens: opts.promptTokens + opts.completionTokens,
          latencyMs: opts.latencyMs,
          success: opts.success ? 1 : 0,
          error: opts.error || '',
          createdAt: Date.now(),
        })
        .run();
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }



  /**
   * AI SDK v7 语义：system 消息不得混入 messages/prompt（真实厂家会直接 400：
   * "System messages are not allowed... Use the instructions option instead"；mock 网关不校验）。
   * 统一拆分：system → instructions，其余保持顺序。
   */
  private splitSystemMessages(messages: ChatMessage[]): { instructions: string | undefined; rest: ModelMessage[] } {
    const sys = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
      .trim();
    const rest = messages.filter((m) => m.role !== 'system') as unknown as ModelMessage[];
    return { instructions: sys || undefined, rest };
  }


  /** 上游限流判定：AI SDK 用 statusCode；兼容 status 字段与厂商文案（含中文"速率限制"/英文 rate limit/quota/429） */
  static isRetriableLimit(err: unknown): boolean {
    const e = err as { statusCode?: number; status?: number; message?: string } | null;
    if (e?.statusCode === 429 || e?.status === 429) return true;
    const msg = String(e?.message || '');
    return /\(429\)|\b429\b|rate.?limit|too many requests|quota|速率限制|限流|限额/i.test(msg);
  }

  /** AI SDK usage（对象/数值两种版本兼容）→ 平铺 token 数 */
  private usageTokens(usage: LanguageModelUsage | undefined): { prompt: number; completion: number } {
    if (!usage) return { prompt: 0, completion: 0 };
    const num = (v: unknown): number => (typeof v === 'number' ? v : typeof (v as { total?: unknown })?.total === 'number' ? (v as { total: number }).total : 0);
    return { prompt: num(usage.inputTokens), completion: num(usage.outputTokens) };
  }

  /** 构造 AI SDK 模型实例（每次调用读取当前 baseUrl/key，保证设置页切换立即生效） */
  protected buildModel(modelId: string, signal?: AbortSignal): LanguageModel {
    void signal;
    const provider = createOpenAICompatible({
      name: 'sciflow',
      baseURL: this.baseUrl,
      apiKey: this._secretKey,
      headers: { Authorization: `Bearer ${this._secretKey}` },
      supportsStructuredOutputs: true,
    });
    return provider(modelId);
  }

  /** 非 stream_options.include_usage 兼容探测：某些网关拒绝该参数（保留容错语义由 AI SDK headers/参数层处理） */

  /** 非流式补全（p-limit 限流 + p-retry 指数退避重试 + token 成本追踪） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';

    return this.limit(async () =>
      pRetry(
        async () => {
          const { instructions, rest } = this.splitSystemMessages(messages);
          const callArgs = {
            model: this.buildModel(model),
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 4096,
            abortSignal: opts.signal,
            instructions,
            messages: rest,
          };
          if (opts.jsonSchema) {
            // 结构化路径：走 generateObject（v7 中 response_format json_schema 仅由它下发）
            const { object, usage } = await generateObject({
              ...callArgs,
              schema: aiJsonSchema(opts.jsonSchema.schema),
            });
            const text = JSON.stringify(object);
            if (!text.trim()) throw new HttpException('AI 返回空响应', 429);
            return { text, usage };
          }
          const { text, usage } = await generateText(callArgs);
          if (!text.trim()) throw new HttpException('AI 返回空响应', 429);
          return { text, usage };
        },
        {
          retries: 4,
          factor: 2,
          minTimeout: 2000,
          maxTimeout: 60_000,
          onFailedAttempt: (err) => {
            if (!AiTransportService.isRetriableLimit(err)) throw err;
            this.logger.warn(`AI 限流重试：第 ${err.attemptNumber} 次失败，剩余 ${err.retriesLeft} 次（${String((err as { message?: string }).message || '').slice(0, 80)}）`);
          },
        },
      ),
    ).then(({ text, usage }) => {
      const tokens = this.usageTokens(usage);
      this.logLlmCall({
        caller,
        model,
        promptTokens: tokens.prompt,
        completionTokens: tokens.completion,
        latencyMs: Date.now() - t0,
        success: true,
      });
      return text;
    }).catch((err) => {
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
      if (err instanceof HttpException) throw err;
      if (AiTransportService.isRetriableLimit(err)) throw new HttpException('AI 限流 (429)：上游速率限制，请降低 AI_RPM_CAP 或升级模型配额', 429);
      throw new HttpException(`AI 服务调用失败: ${String(err?.message || err).slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
    });
  }

  /** 结构化补全：zod schema 强约束输出（约束工程主路径，替代手写 JSON 抠取） */
  async completeStructured<T>(messages: ChatMessage[], schema: import('zod').core.$ZodType, opts: CompleteOptions = {}): Promise<T> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    return this.limit(async () =>
      pRetry(
        async () => {
          const { instructions, rest } = this.splitSystemMessages(messages);
          const { object, usage } = await generateObject({
            model: this.buildModel(model),
            temperature: opts.temperature ?? 0.3,
            maxOutputTokens: opts.maxTokens ?? 4096,
            abortSignal: opts.signal,
            schema,
            instructions,
            messages: rest,
          });
          return { object: object as T, usage };
        },
        { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 15_000, onFailedAttempt: (err) => { throw err; } },
      ),
    ).then(({ object, usage }) => {
      const tokens = this.usageTokens(usage);
      this.logLlmCall({ caller, model, promptTokens: tokens.prompt, completionTokens: tokens.completion, latencyMs: Date.now() - t0, success: true });
      return object;
    }).catch((err) => {
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
      throw new HttpException(`AI 结构化输出失败: ${String(err?.message || err).slice(0, 200)}`, HttpStatus.BAD_GATEWAY);
    });
  }

  /** 流式补全：返回 OpenAI 兼容 SSE 文本流（经 AI SDK streamText → 转接为上游 ReadableStream 语义，供 sse.helper 转发） */
  async completeStream(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    const selfLog = this.logLlmCall.bind(this);
    return this.limit(async () => {
      const { instructions, rest } = this.splitSystemMessages(messages);
      const result = streamText({
        model: this.buildModel(model, opts.signal),
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 4096,
        abortSignal: opts.signal,
        instructions,
        messages: rest,
      });
      // streamText.textStream → 重新编码为 SSE data: 行流，保持 sse.helper 的转发契约
      const encoder = new TextEncoder();
      const sse = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const delta of result.textStream) {
              if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta }, index: 0 }] })}\n\n`));
            }
            const usage = await result.usage;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: usage?.inputTokens ?? 0, completion_tokens: usage?.outputTokens ?? 0, total_tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            selfLog({ caller, model, promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, latencyMs: Date.now() - t0, success: true });
          } catch (err: any) {
            selfLog({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(err?.message || err) })}\n\n`));
          } finally {
            controller.close();
          }
        },
      });
      return sse;
    });
  }

  /** 查询可用模型列表（OpenAI 兼容 /models；openai-compatible v4 未暴露列表方法，保留 fetch） */
  async listModels(): Promise<string[]> {
    this.assertConfigured();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this._secretKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id?: string } | null> };
      const ids: string[] = (data.data || []).filter((m): m is { id?: string } => !!m).map((m) => m.id).filter((id): id is string => !!id && !id.includes('image') && !id.includes('video'));
      return ids.slice(0, 20);
    } catch {
      return [];
    }
  }

  /** 连接测试：发一条最小消息验证 Key/端点/模型 */
  async testConnection(model?: string): Promise<{ ok: boolean; reply: string; model: string; latencyMs: number }> {
    this.assertConfigured();
    const target = model || this.fastModel;
    const t0 = Date.now();
    try {
      const { text } = await generateText({
        model: this.buildModel(target),
        temperature: 0,
        maxOutputTokens: 512,
        messages: [{ role: 'user', content: '请只回复两个字：正常' }],
      });
      const reply = text.trim() || '（空回复）';
      return { ok: true, reply, model: target, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, reply: e.message || String(e), model: target, latencyMs: Date.now() - t0 };
    }
  }

  // ----------------------------------------------------------------- //
  //  initialisation helpers (protected so subclasses can hook)     //
  // ----------------------------------------------------------------- //

  /** 从 model_provider 表读取激活厂商并覆盖连接配置（LiteLLM 式多厂商切换） */
  protected applyActiveProvider(): void {
    try {
      const row = sqlite
        .prepare('SELECT * FROM model_provider WHERE is_active = 1 LIMIT 1')
        .get() as { base_url?: string; ['api_key']?: string; model?: string } | undefined;
      if (row?.base_url && row?.model) {
        this.baseUrl = String(row.base_url).replace(/\/$/, '');
        if (row['api_key']) this.setApiKey(decryptSecret(String(row['api_key'])));
        this.fastModel = String(row.model);
        this.strongModel = String(row.model);
      }
    } catch {
      /* 表不存在时回退环境变量 */
    }
  }
}
