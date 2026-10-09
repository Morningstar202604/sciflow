import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pRetry from 'p-retry';
import { sqlite } from '../db/database';
import { db } from '../db/database';
import { llmCallLogs, customPrompts } from '../db/schema';
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
  /** JSON Schema 结构化输出（OpenAI response_format: json_schema） */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
}

/**
 * 底层 LLM 传输层 — 纯 OpenAI-兼容 HTTP 协议调用、并发限流、
 * 退避重试、token 成本落库、多厂商切换。
 *
 * 不含任何 domain 级 prompt / 业务方法（那些在 AiService 里）。
 * 其他不相干服务也可以独立注入本 provider，复用 transport 层。
 */
@Injectable()
export class AiTransportService {
  protected readonly logger = new Logger(AiTransportService.name);

  protected baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  protected apiKey = process.env.AI_API_KEY || '';
  /** fast 档：轻量快速模型（默认） */
  protected fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || 'agnes-3.0-flash';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  protected strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  /**
   * 本地 mock 模式（AI_MOCK=1）：无 AI_API_KEY / 无外网环境下，把 baseUrl 指向进程内
   * 零依赖的 mock OpenAI 兼容网关（见 mock-gateway.ts），让全链路可端到端跑通。
   * 未设置 AI_MOCK 时，本类行为与逐字节一致（真实网关路径不变）。
   */
  protected readonly mockMode = process.env.AI_MOCK === '1';

  // ---------- 并发限流：手写 class 版 p-limit（避免外部包运行时缺失） ----------
  // RPM 换算为并发上限：假设单请求 ~10s，RPM 60 → 最多 6 并发；取保守值避免 429
  protected readonly limit = this.createLimiter(Math.max(1, Math.floor(Number(process.env.AI_RPM_CAP || 60) / 6)));

  constructor() {
    this.applyActiveProvider();
  }

  /** 切换激活厂商（设置页调用，立即生效） */
  switchProvider(id: string) {
    if (this.mockMode) return; // mock 模式忽略厂商切换，始终指向本地 mock 网关
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as
      | { base_url?: string; api_key?: string; model?: string }
      | undefined;
    if (!row) throw new HttpException('模型厂商不存在', HttpStatus.NOT_FOUND);
    this.baseUrl = String(row.base_url).replace(/\/$/, '');
    if (row.api_key) this.apiKey = String(row.api_key);
    this.fastModel = String(row.model);
    this.strongModel = String(row.model);
    sqlite.prepare('UPDATE model_provider SET is_active = 0 WHERE is_active = 1').run();
    sqlite.prepare('UPDATE model_provider SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** 回退到环境变量配置（删除激活中的厂商时调用，避免内存残留失效厂商） */
  resetToEnv() {
    if (this.mockMode) return; // mock 模式忽略回退，始终指向本地 mock 网关
    this.baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.apiKey = process.env.AI_API_KEY || '';
    this.fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || 'agnes-3.0-flash';
    this.strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  }

  /** 是否已配置 AI（mock 模式下恒为 true，本机测试无需真实密钥） */
  get configured(): boolean {
    return this.mockMode || !!this.apiKey;
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
    if (this.mockMode) return; // mock 模式无需真实密钥
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** LLM 调用成本追踪（token 用量审计，落 llm_call_log 表） */
  protected logLlmCall(opts: { caller: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number; success: boolean; error?: string }): void {
    try {
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

  /** 极简并发队列：等同 p-limit(concurrency) —— activeCount 超限时挂起，队头释放后唤醒 */
  private createLimiter(concurrency: number) {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
      if (active >= concurrency || !queue.length) return;
      active++;
      const fn = queue.shift()!;
      fn();
    };
    return <T>(task: () => T | Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const run = () => {
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              active--;
              next();
            });
        };
        if (active < concurrency) {
          active++;
          run();
        } else {
          queue.push(run);
        }
      });
  }

  /** 统一构造 OpenAI 兼容补全请求 */
  protected buildChatRequest(
    model: string,
    messages: ChatMessage[],
    opts: { temperature?: number; maxTokens?: number; stream?: boolean; streamIncludeUsage?: boolean; enableThinking?: boolean; jsonSchema?: { name: string; schema: Record<string, unknown> } },
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 4096,
      stream: opts.stream ?? false,
    };
    // OpenAI 兼容流式：要求最后一个 chunk 带 usage 统计
    if (opts.stream && opts.streamIncludeUsage) body.stream_options = { include_usage: true };
    // 推理开关：仅显式开启时附加方舟/智谱系 thinking 参数
    if (opts.enableThinking) body.thinking = { type: 'enabled' };
    // JSON Schema 结构化输出
    if (opts.jsonSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema } };
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
  }

  /** 非流式补全（p-limit 限流 + p-retry 指数退避重试 + token 成本追踪） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';

    return this.limit(async () =>
      pRetry(
        async () => {
          const res = await this.buildChatRequest(model, messages, { temperature: opts.temperature, maxTokens: opts.maxTokens, stream: false }, 180_000);
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            // 429 触发重试；其他 HTTP 错误立即抛出不重试
            if (res.status === 429) {
              throw new HttpException(`AI 限流 (429)`, 429);
            }
            throw new HttpException(`AI 服务调用失败 (${res.status}): ${errText.slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
          }
          const data = (await res.json()) as any;
          const content = String(data.choices?.[0]?.message?.content ?? '').trim();
          // 空响应按失败重试
          if (!content) throw new HttpException('AI 返回空响应', 429);
          return { content, data };
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 30_000,
          onFailedAttempt: (err) => {
            // 仅对 429 限流重试；其他错误立即抛出
            if (Number(err?.status) !== 429) throw err;
            this.logger.warn(`重试 ${err.attemptNumber}/${err.retriesLeft + err.attemptNumber - 1}: ${err.message}`);
          },
        },
      ),
    ).then(({ content, data }) => {
      const usage = (data?.usage || {}) as any;
      this.logLlmCall({
        caller,
        model,
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        latencyMs: Date.now() - t0,
        success: true,
      });
      return content;
    }).catch((err) => {
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
      if (err instanceof HttpException) throw err;
      throw new HttpException('AI 服务调用失败（多次重试后仍失败）', HttpStatus.BAD_GATEWAY);
    });
  }

  /** 流式补全，返回上游响应体（Web ReadableStream），用于 SSE 转发 */
  async completeStream(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    const reqOpts = {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      stream: true,
      streamIncludeUsage: opts.streamIncludeUsage,
      enableThinking: opts.enableThinking,
    };
    // 用 p-limit 排队，避免并发流式请求打爆上游
    return this.limit(async () => {
      let res = await this.buildChatRequest(model, messages, reqOpts, 300_000, opts.signal);
      // 部分厂商拒绝 stream_options.include_usage → 去掉该参数容错重试一次
      if (!res.ok && opts.streamIncludeUsage) {
        const status = res.status;
        await res.body?.cancel().catch(() => undefined);
        this.logger.warn(`上游拒绝 stream_options.include_usage (HTTP ${status})，去掉该参数重试`);
        res = await this.buildChatRequest(
          model,
          messages,
          { temperature: opts.temperature, maxTokens: opts.maxTokens, stream: true, enableThinking: opts.enableThinking },
          300_000,
          opts.signal,
        );
      }
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: `HTTP ${res.status}` });
        throw new HttpException(`AI 流式调用失败 (${res.status}): ${errText.slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
      }
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: true });
      return res.body;
    });
  }

  /** 查询可用模型列表（OpenAI 兼容 /v1/models） */
  async listModels(): Promise<string[]> {
    this.assertConfigured();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as any;
      const ids: string[] = (data.data || []).map((m: any) => m.id).filter((id: string) => !id.includes('image') && !id.includes('video'));
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
      const res = await this.buildChatRequest(
        target,
        [{ role: 'user', content: '请只回复两个字：正常' }],
        // 推理型网关（u2-flash / DeepSeek-R1 兼容）会先消耗 token 在 reasoning_content 上；
        // max_tokens 太小会把正文挤成空串，误报「空回复」。给足预算，并在正文为空时回退 reasoning 佐证连通。
        { temperature: 0, maxTokens: 512, stream: false },
        30_000,
      );
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { ok: false, reply: `HTTP ${res.status}: ${err.slice(0, 200)}`, model: target, latencyMs: Date.now() - t0 };
      }
      const data = (await res.json()) as any;
      const msg = data.choices?.[0]?.message ?? {};
      const content: string = msg.content ?? '';
      // 正文非空直接回显；正文空但推理通道有内容，说明网关连通、只是预算被推理吃掉
      const reply = content.trim()
        ? content
        : msg.reasoning_content || msg.thinking
          ? '（连通正常：推理通道有输出，正文为空——可忽略）'
          : '（空回复）';
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
        .get() as { base_url?: string; api_key?: string; model?: string } | undefined;
      if (row?.base_url && row?.model) {
        this.baseUrl = String(row.base_url).replace(/\/$/, '');
        if (row.api_key) this.apiKey = String(row.api_key);
        this.fastModel = String(row.model);
        this.strongModel = String(row.model);
      }
    } catch {
      /* 表不存在时回退环境变量 */
    }
  }
}
