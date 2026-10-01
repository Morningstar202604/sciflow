import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sqlite } from '../db/database';
import { db } from '../db/database';
import { llmCallLogs, customPrompts, appSettings } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as prompts from './prompts';
import { startMockGateway } from './mock-gateway';

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

interface CompleteOptions {
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
}

/**
 * 统一 AI 服务：OpenAI 兼容协议（国内厂商：豆包火山方舟 / DeepSeek / 通义千问 / 智谱 / Kimi 等）
 * 通过环境变量切换：AI_BASE_URL / AI_API_KEY / AI_MODEL（默认豆包火山方舟）
 */
@Injectable()
export class AiService {
  private baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  private apiKey = process.env.AI_API_KEY || '';
  /** fast 档：轻量快速模型（默认） */
  private fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || 'agnes-3.0-flash';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  private strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  /**
   * 本地 mock 模式（AI_MOCK=1）：无 AI_API_KEY / 无外网环境下，把 baseUrl 指向进程内
   * 零依赖的 mock OpenAI 兼容网关（见 mock-gateway.ts），让全链路可端到端跑通。
   * 未设置 AI_MOCK 时，本类行为与逐字节一致（真实网关路径不变）。
   */
  private readonly mockMode = process.env.AI_MOCK === '1';

  constructor() {
    this.applyActiveProvider();
    // mock 模式优先于 DB 激活厂商：覆盖连接配置并惰性启动本地 mock 网关
    if (this.mockMode) {
      this.baseUrl = startMockGateway();
      this.apiKey = 'sk-mock-local-placeholder';
      this.fastModel = 'mock-model';
      this.strongModel = 'mock-model';
    }
  }

  /** 从 model_provider 表读取激活厂商并覆盖连接配置（LiteLLM 式多厂商切换） */
  private applyActiveProvider() {
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

  private resolveModel(opts: CompleteOptions): string {
    if (opts.modelName) return opts.modelName;
    return opts.model === 'strong' ? this.strongModel : this.fastModel;
  }

  private assertConfigured() {
    if (this.mockMode) return; // mock 模式无需真实密钥
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // ---------- LLM 调用成本追踪（token 用量审计，落 llm_call_log 表） ----------
  private logLlmCall(opts: { caller: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number; success: boolean; error?: string }) {
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

  /** zod 结构化输出校验：schema 校验通过返回解析值，失败返回 null（调用处走兜底，杜绝坏 JSON 反复补工） */
  /** 结构化输出校验：zod schema 解析 LLM 返回的 JSON */
  /** 自定义提示词查询：用户配置优先，未配置返回 null（调用方回退系统默认） */
  getCustomPrompt(toolKey: string): string | null {
    try {
      const row = db.select().from(customPrompts).where(eq(customPrompts.toolKey, toolKey)).get();
      return row?.enabled ? row.prompt : null;
    } catch {
      return null;
    }
  }

  safeParse<T>(text: string, schema: z.ZodType<T>): T | null {
    try {
      const obj = this.jsonOf<unknown>(text);
      const result = schema.safeParse(obj);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  // ---------- 全局令牌桶（适配免费版 RPM 限流：稳定排队，避免 429 风暴） ----------
  private static tokens = Number(process.env.AI_RPM_CAP || 5); // 桶容量（每分钟额度）
  private static lastRefill = Date.now();

  private async acquireToken() {
    const refillMs = 60_000;
    while (true) {
      const now = Date.now();
      const elapsed = now - AiService.lastRefill;
      if (elapsed >= refillMs) {
        const refills = Math.floor(elapsed / refillMs);
        AiService.tokens = Math.min(Number(process.env.AI_RPM_CAP || 5), AiService.tokens + refills);
        AiService.lastRefill = now;
      }
      if (AiService.tokens >= 1) {
        AiService.tokens -= 1;
        return;
      }
      // 等待下一次补充（下限 1s 防止负 delay 忙等空转，上限 30s 避免静默死锁）
      await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(refillMs - elapsed + 200, 30_000))));
    }
  }

  /** 统一构造 OpenAI 兼容补全请求（complete / completeStream / testConnection 共用） */
  private buildChatRequest(
    model: string,
    messages: ChatMessage[],
    opts: { temperature?: number; maxTokens?: number; stream?: boolean; streamIncludeUsage?: boolean; enableThinking?: boolean },
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
    // OpenAI 兼容流式：要求最后一个 chunk 带 usage 统计（厂商拒绝时由 completeStream 容错重试去掉）
    if (opts.stream && opts.streamIncludeUsage) body.stream_options = { include_usage: true };
    // 推理开关：仅显式开启时附加方舟/智谱系 thinking 参数；不支持的厂商静默忽略
    if (opts.enableThinking) body.thinking = { type: 'enabled' };
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

  /** 非流式补全（全局令牌桶排队 + 429 退避重试 + token 成本追踪） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.acquireToken();
      try {
        const res = await this.buildChatRequest(model, messages, { temperature: opts.temperature, maxTokens: opts.maxTokens, stream: false }, 180_000);
        if (res.status === 429 && attempt < maxAttempts) {
          const backoff = attempt * 10000;
          console.warn(`[AiService] 429 限流，${backoff / 1000}s 后重试 (${attempt}/${maxAttempts - 1})`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new HttpException(`AI 服务调用失败 (${res.status}): ${errText.slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
        }
        const data = (await res.json()) as any;
        const content = data.choices?.[0]?.message?.content ?? '';
        // 免费网关偶发返回 200 但内容为空 → 按失败重试
        if (!String(content).trim() && attempt < maxAttempts) {
          console.warn(`[AiService] 空响应重试 (${attempt}/${maxAttempts - 1})`);
          await new Promise((r) => setTimeout(r, attempt * 3000));
          continue;
        }
        const usage = (data.usage || {}) as any;
        this.logLlmCall({
          caller,
          model,
          promptTokens: Number(usage.prompt_tokens) || 0,
          completionTokens: Number(usage.completion_tokens) || 0,
          latencyMs: Date.now() - t0,
          success: true,
        });
        return String(content);
      } catch (e) {
        if (e instanceof HttpException) {
          if (attempt >= maxAttempts) {
            this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: e.message });
          }
          throw e;
        }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 3000));
          continue;
        }
        this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: (e as Error).message });
        throw e;
      }
    }
    this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: '多次重试后仍失败' });
    throw new HttpException('AI 服务调用失败（多次重试后仍失败）', HttpStatus.BAD_GATEWAY);
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
    let res = await this.buildChatRequest(model, messages, reqOpts, 300_000, opts.signal);
    // 部分厂商拒绝 stream_options.include_usage → 去掉该参数容错重试一次（拿不到 usage 也不阻断正文流）
    if (!res.ok && opts.streamIncludeUsage) {
      const status = res.status;
      await res.body?.cancel().catch(() => undefined);
      console.warn(`[AiService] 上游拒绝 stream_options.include_usage (HTTP ${status})，去掉该参数重试`);
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
    // 流式调用无法提前拿到 usage：至少记录调用发生与耗时（token 在非流式链路全覆盖）
    this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: true });
    return res.body;
  }

  private jsonOf<T>(text: string): T {
    let cleaned = String(text ?? '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    // 若 AI 在 JSON 前加了叙述文字，取第一个平衡 JSON 对象
    if (!cleaned.startsWith('{')) {
      const start = cleaned.indexOf('{');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < cleaned.length; i++) {
          const c = cleaned[i];
          if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
          } else if (c === '"') inStr = true;
          else if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) { cleaned = cleaned.slice(start, i + 1); break; }
          }
        }
      }
    }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('AI 输出不是有效 JSON');
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }

  // ---------- 科研任务封装 ----------

  /** 科研问答（非流式） */
  async chat(question: string, history: ChatMessage[] = [], opts: Pick<ChatStreamOptions, 'modelName'> = {}): Promise<string> {
    return this.complete([{ role: 'system', content: prompts.CHAT_SYSTEM }, ...history, { role: 'user', content: question }], { modelName: opts.modelName });
  }

  /** Agent 化问答：在系统提示中注入项目记忆 + 知识库上下文（RAG） */
  async chatWithContext(question: string, history: ChatMessage[] = [], context: string = '', opts: Pick<ChatStreamOptions, 'modelName'> = {}): Promise<string> {
    const sys = context
      ? `${prompts.CHAT_SYSTEM}\n\n【当前项目上下文】\n${context}\n\n请优先结合上下文回答；上下文不足以覆盖时，再用你的专业知识补充，并说明依据。`
      : prompts.CHAT_SYSTEM;
    return this.complete([{ role: 'system', content: sys }, ...history, { role: 'user', content: question }], { modelName: opts.modelName });
  }

  /** Agent 化问答（流式）：默认请求 include_usage 收尾块，并接线外部 AbortSignal */
  streamChatWithContext(question: string, history: ChatMessage[] = [], context: string = '', streamOpts: ChatStreamOptions = {}): Promise<ReadableStream<Uint8Array>> {
    const sys = context
      ? `${prompts.CHAT_SYSTEM}\n\n【当前项目上下文】\n${context}\n\n请优先结合上下文回答；上下文不足以覆盖时，再用你的专业知识补充，并说明依据。`
      : prompts.CHAT_SYSTEM;
    return this.completeStream([{ role: 'system', content: sys }, ...history, { role: 'user', content: question }], {
      context: 'chat',
      modelName: streamOpts.modelName,
      enableThinking: streamOpts.enableThinking,
      signal: streamOpts.signal,
      streamIncludeUsage: true,
    });
  }

  /** 科研问答（流式）：默认请求 include_usage 收尾块，并接线外部 AbortSignal */
  streamChat(question: string, history: ChatMessage[] = [], streamOpts: ChatStreamOptions = {}): Promise<ReadableStream<Uint8Array>> {
    return this.completeStream([{ role: 'system', content: prompts.CHAT_SYSTEM }, ...history, { role: 'user', content: question }], {
      context: 'chat',
      modelName: streamOpts.modelName,
      enableThinking: streamOpts.enableThinking,
      signal: streamOpts.signal,
      streamIncludeUsage: true,
    });
  }

  /** 选题建议 */
  async suggestTopics(field: string, context: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.SUGGEST_TOPICS(field, context) }], { temperature: 0.8, context: 'suggestTopics' });
  }

  /** 大纲生成（outline-first）；zod 校验失败时按纯文本标题兜底 */
  async writeOutline(topic: string, literatureSummary: string): Promise<{ title: string; sections: { title: string; subsections: string[] }[] }> {
    const raw = await this.complete([{ role: 'user', content: prompts.WRITE_OUTLINE(topic, literatureSummary) }], { temperature: 0.5, model: 'strong', context: 'writeOutline' });
    const schema = z.object({
      title: z.string().optional(),
      sections: z.array(z.object({ title: z.string(), subsections: z.array(z.string()).optional().default([]) })).optional(),
    });
    const parsed = this.safeParse(raw, schema);
    if (parsed && (parsed.title || parsed.sections?.length)) {
      return { title: parsed.title || topic, sections: parsed.sections || [] };
    }
    return { title: topic, sections: [{ title: '引言', subsections: [] }, { title: '相关工作', subsections: [] }, { title: '方法', subsections: [] }, { title: '实验与结果', subsections: [] }, { title: '讨论', subsections: [] }, { title: '结论', subsections: [] }] };
  }

  /** 章节起草 */
  async draftSection(sectionTitle: string, outline: string, references: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.DRAFT_SECTION(sectionTitle, outline, references) }], { temperature: 0.6, model: 'strong', context: 'draftSection' });
  }

  /** 三段式润色/降重：原文 + 润色文 + 理由（AI 输出缺字段或嵌套时递归回退，防止落库异常） */
  async polish(text: string, mode: 'polish' | 'reduce' = 'polish'): Promise<{ original: string; polished: string; reason: string }> {
    // 分段润色：按 ## 章节切分，逐段调用（长文单次输出必然截断——8192 tokens 不足以覆盖 1.7 万字）
    const parts = text.split(/(?=^## )/m).filter((s) => s.trim().length > 0);
    const target = parts.length > 1 ? parts : [text];
    const polishedParts: string[] = [];
    const reasons: string[] = [];
    for (const part of target) {
      const raw = await this.complete([{ role: 'user', content: prompts.POLISH(part, mode) }], { temperature: 0.4, maxTokens: 8192, context: 'polish' });
      let parsed: Partial<{ original: string; polished: string; reason: string }> = {};
      try {
        parsed = this.jsonOf<{ original: string; polished: string; reason: string }>(raw);
      } catch {
        parsed = { polished: raw };
      }
      let piece = String(parsed.polished || part || '').trim();
      // 处理 AI 嵌套输出：polished 字段本身又是 JSON 对象文本
      if (piece.startsWith('{') && (piece.includes('"original"') || piece.includes('"reason"') || piece.includes('"polished"'))) {
        try {
          const nested = this.jsonOf<{ original?: string; polished?: string; reason?: string }>(piece);
          piece = String(nested.polished || nested.original || piece).trim();
        } catch { /* 保持原样 */ }
      }
      polishedParts.push(piece);
      if (parsed.reason) reasons.push(String(parsed.reason).trim());
    }
    return {
      original: text.trim(),
      polished: polishedParts.join('\n\n'),
      reason: reasons.join('；') || '分段润色完成',
    };
  }

  /** 学术翻译 */
  async translate(text: string, targetLang: 'zh' | 'en'): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.TRANSLATE(text, targetLang) }], { temperature: 0.3 });
  }

  /** 7 维质量评审（AI 输出缺维度时按 0 分兜底，防止总分异常） */
  async reviewPaper(title: string, content: string): Promise<{
    scores: { literature: number; logic: number; citation: number; language: number; novelty: number; figures: number; format: number };
    feedback: string;
    totalScore: number;
  }> {
    // 评审用 fast 模型：思考型强模型输出带 reasoning 前缀会破坏 JSON 平衡解析（曾导致全 0 分）
    const raw = await this.complete([{ role: 'user', content: prompts.REVIEW_PAPER(title, content) }], { temperature: 0.3, model: 'fast', context: 'reviewPaper' });
    let parsed: { scores?: Record<string, number>; feedback?: string } = {};
    try {
      parsed = this.jsonOf<{ scores: Record<string, number>; feedback: string }>(raw);
    } catch {
      /* 保留空对象兜底 */
    }
    const dims = ['literature', 'logic', 'citation', 'language', 'novelty', 'figures', 'format'] as const;
    const scores = {} as Record<string, number>;
    for (const d of dims) scores[d] = Math.max(0, Math.min(100, Number(parsed.scores?.[d]) || 0));
    // 权重可自定义（用户可在设置页调整，默认等权）
    let weights: Record<string, number> = {};
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'quality_weights')).get();
      weights = JSON.parse(row?.value || '{}');
    } catch {
      /* 使用默认等权 */
    }
    const total = Math.round(
      dims.reduce((sum, d) => sum + scores[d] * (weights[d] ?? 1), 0) /
        dims.reduce((sum, d) => sum + (weights[d] ?? 1), 0),
    );
    return { scores: scores as any, feedback: String(parsed.feedback || '').trim(), totalScore: total };
  }

  /** 文献综述 */
  async summarizeLiterature(topic: string, papers: string): Promise<string> {
    const custom = this.getCustomPrompt('summarizeLiterature');
    const content = custom ? `${custom}\n\n研究主题：${topic}\n\n待综述文献列表（必须严格基于这些文献）：\n${papers}` : prompts.SUMMARIZE_LITERATURE(topic, papers);
    return this.complete([{ role: 'user', content }], { temperature: 0.5, context: 'summarizeLiterature' });
  }

  /** 期刊推荐 */
  async recommendJournal(title: string, abstract: string, field: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.RECOMMEND_JOURNAL(title, abstract, field) }], { temperature: 0.5, context: 'recommendJournal' });
  }

  /** Cover Letter */
  async coverLetter(title: string, abstract: string, journal: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.COVER_LETTER(title, abstract, journal) }], { temperature: 0.5, context: 'coverLetter' });
  }

  /** 审稿回复 */
  async replyReview(reviewComments: string, response: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.REPLY_REVIEW(reviewComments, response) }], { temperature: 0.5, context: 'replyReview' });
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
      return { ok: true, reply: reply, model: target, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, reply: e.message || String(e), model: target, latencyMs: Date.now() - t0 };
    }
  }

  /** Elicit 式：文献结构化提取（字段统一字符串化） */
  async extractPaperTable(papers: string): Promise<{ ref: string; title: string; year: number; method: string; results: string; contribution: string; limitations: string }[]> {
    const custom = this.getCustomPrompt('extractPaperTable');
    const content = custom ? `${custom}\n\n待提取文献：\n${papers}` : prompts.EXTRACT_PAPER_TABLE(papers);
    const raw = await this.complete([{ role: 'user', content }], { temperature: 0.2, context: 'extractPaperTable' });
    try {
      const parsed = this.jsonOf<{ papers: any[] }>(raw);
      return (parsed.papers || []).slice(0, 12).map((p: any) => ({
        ref: String(p?.ref ?? ''),
        title: String(p?.title ?? ''),
        year: Number(p?.year) || 0,
        method: String(p?.method ?? ''),
        results: String(p?.results ?? ''),
        contribution: String(p?.contribution ?? ''),
        limitations: String(p?.limitations ?? ''),
      }));
    } catch {
      return [];
    }
  }

  /** Consensus 式：证据综合（字段统一字符串化） */
  async evidenceSynthesis(
    question: string,
    papers: string,
  ): Promise<{ summary: string; stances: { claim: string; stance: string; count: number; refs: string[]; note: string }[] }> {
    const custom = this.getCustomPrompt('evidenceSynthesis');
    const content = custom ? `${custom}\n\n研究问题：${question}\n\n证据文献：\n${papers}` : prompts.EVIDENCE_SYNTHESIS(question, papers);
    const raw = await this.complete([{ role: 'user', content }], { temperature: 0.3, context: 'evidenceSynthesis' });
    try {
      const parsed = this.jsonOf<{ summary: string; stances: any[] }>(raw);
      return {
        summary: String(parsed.summary || ''),
        stances: (parsed.stances || []).map((s: any) => ({
          claim: String(s?.claim ?? ''),
          stance: String(s?.stance ?? '证据不足'),
          count: Number(s?.count) || 0,
          refs: Array.isArray(s?.refs) ? s.refs.map(String) : [],
          note: String(s?.note ?? ''),
        })),
      };
    } catch {
      return { summary: '证据综合失败：模型输出无法解析，请重试。', stances: [] };
    }
  }

  /** NotebookLM 式：知识库检索增强问答 */
  async knowledgeQa(question: string, chunks: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.KNOWLEDGE_QA(question, chunks) }], { temperature: 0.3, maxTokens: 2048, context: 'knowledgeQa' });
  }

  // ---------- Phase 1：Planner / ReAct / Reflexion ----------

  /** 研究计划生成（对标 GPT Researcher planner）：zod 校验失败时回退标准计划 */
  async generatePlan(topic: string, preface = ''): Promise<{
    objective: string;
    researchQuestions: string[];
    searchStrategy: { keywords: string[]; minPapers: number; depth: string };
    draftingPlan: { sections: string[]; wordCount: number };
    risks: string[];
  }> {
    // preface 为空时 effTopic === topic，行为与之前完全一致；仅 Planner 首轮注入项目要求（差距 #22）
    const effTopic = preface ? `项目要求：${preface}\n\n研究主题：${topic}` : topic;
    const raw = await this.complete([{ role: 'user', content: prompts.PLAN_RESEARCH(effTopic) }], { temperature: 0.4, model: 'strong', context: 'generatePlan' });
    const fallback = {
      objective: `围绕「${topic}」完成一篇系统性综述`,
      researchQuestions: [topic],
      searchStrategy: { keywords: [topic], minPapers: 8, depth: 'overview' },
      draftingPlan: { sections: ['引言', '相关工作', '方法', '实验与结果', '讨论', '结论'], wordCount: 6000 },
      risks: [],
    };
    const schema = z.object({
      objective: z.string().optional(),
      researchQuestions: z.array(z.string()).optional(),
      searchStrategy: z.object({
        keywords: z.array(z.string()).optional(),
        minPapers: z.number().optional(),
        depth: z.string().optional(),
      }).optional(),
      draftingPlan: z.object({
        sections: z.array(z.string()).optional(),
        wordCount: z.number().optional(),
      }).optional(),
      risks: z.array(z.string()).optional(),
    });
    const p = this.safeParse(raw, schema);
    if (!p) return fallback;
    return {
      objective: String(p.objective || fallback.objective),
      researchQuestions: (p.researchQuestions?.length ? p.researchQuestions : fallback.researchQuestions).slice(0, 5).map(String),
      searchStrategy: {
        keywords: (p.searchStrategy?.keywords?.length ? p.searchStrategy.keywords : [topic]).slice(0, 8).map(String),
        minPapers: Number(p.searchStrategy?.minPapers) || 8,
        depth: String(p.searchStrategy?.depth || 'overview'),
      },
      draftingPlan: {
        sections: (p.draftingPlan?.sections?.length ? p.draftingPlan.sections : fallback.draftingPlan.sections).map(String),
        wordCount: Number(p.draftingPlan?.wordCount) || 6000,
      },
      risks: (p.risks || []).map(String),
    };
  }

  /** ReAct 思考步：决定检索或收尾（对标 ReAct think-act-observe）；zod 校验失败兜底继续检索 */
  async reactThink(
    topic: string,
    questions: string[],
    past: { round: number; query: string; found: number }[],
  ): Promise<{ thought: string; action: 'search' | 'done'; query: string; coverage: number }> {
    const pastText = past
      .map((p) => `第${p.round}轮：检索词「${p.query}」→ 获得 ${p.found} 条文献`)
      .join('\n');
    const raw = await this.complete([{ role: 'user', content: prompts.REACT_THINK(topic, questions, pastText) }], { temperature: 0.3, model: 'fast', context: 'reactThink' });
    const schema = z.object({
      thought: z.string().optional(),
      action: z.enum(['search', 'done']).optional(),
      query: z.string().optional(),
      coverage: z.number().optional(),
    });
    const r = this.safeParse(raw, schema);
    if (r) {
      return {
        thought: String(r.thought || ''),
        action: r.action === 'done' ? 'done' : 'search',
        query: String(r.query || ''),
        coverage: Math.max(0, Math.min(100, Number(r.coverage) || 0)),
      };
    }
    return { thought: '（解析失败，进入下一轮检索）', action: 'search', query: '', coverage: 0 };
  }

  /** Reflexion：把评审反馈提炼为可执行修改指令（对标 Reflexion 语义梯度）；zod 校验失败兜底 */
  async reflect(topic: string, feedback: string, pastReflections: string): Promise<{ note: string; instructions: string[] }> {
    const raw = await this.complete(
      [{ role: 'user', content: prompts.REFLEXION_PROMPT(topic, feedback, pastReflections) }],
      { temperature: 0.3, context: 'reflect' },
    );
    const schema = z.object({
      note: z.string().optional(),
      instructions: z.array(z.string()).optional(),
    });
    const r = this.safeParse(raw, schema);
    if (r && (r.note || r.instructions?.length)) {
      return {
        note: String(r.note || '改进论文质量'),
        instructions: (r.instructions || []).map(String).slice(0, 5),
      };
    }
    return { note: '改进论文质量', instructions: [] };
  }

  // ---------- Phase 2：记忆 ----------

  /** 情景记忆压缩（从完成的任务中提炼可复用要点） */
  async extractEpisodic(projectName: string, docTitle: string, outline: string, score: number): Promise<{ content: string; keywords: string[] }> {
    const raw = await this.complete(
      [{ role: 'user', content: prompts.EPISODIC_EXTRACT(projectName, docTitle, outline, score) }],
      { temperature: 0.2, context: 'extractEpisodic' },
    );
    try {
      const r = this.jsonOf<any>(raw);
      return {
        content: String(r.content || ''),
        keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(String).slice(0, 6),
      };
    } catch {
      return { content: '', keywords: [] };
    }
  }

  // ---------- Phase 6：科研专门加强 ----------

  /** 论文摘要 + 关键词生成（zod 结构化校验） */
  /** 综述自动配图：生成 2-3 个 mermaid 学术图表（技术路线/分类对比/框架总览） */
  async generateFigures(topic: string, outline: string, content: string): Promise<{ title: string; caption: string; mermaid: string }[]> {
    const custom = this.getCustomPrompt('generateFigures');
    const content2 = custom ? `${custom}\n\n论文主题：${topic}\n\n论文大纲：${outline}\n\n正文开头：\n${content.slice(0, 1200)}` : prompts.GENERATE_FIGURES(topic, outline, content);
    // 解析失败重试一次（fast 模型偶发输出非严格 JSON）；两次失败返回空并告警
    let parsed: { figures?: { figureType: string; title: string; caption: string; mermaid: string }[] } | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const raw = await this.complete([{ role: 'user', content: content2 }], { temperature: 0.3, model: 'fast', context: 'generateFigures' });
      try {
        parsed = this.jsonOf<{ figures?: { figureType: string; title: string; caption: string; mermaid: string }[] }>(raw);
      } catch {
        console.warn(`[sciflow] 配图 JSON 解析失败（第 ${attempt + 1} 次），重试…`);
      }
    }
    if (!parsed) {
      console.warn('[sciflow] 配图两次解析均失败，本轮跳过图表生成');
      return [];
    }
    return (parsed.figures || []).slice(0, 3).map((f) => ({
      title: String(f.title || ''),
      caption: String(f.caption || ''),
      mermaid: String(f.mermaid || '').trim(),
    })).filter((f) => f.mermaid && f.title);
  }

  async generateAbstract(title: string, content: string): Promise<{ abstract: string; keywords: string[] }> {
    const schema = z.object({ abstract: z.string().min(10), keywords: z.array(z.string()).min(1).max(8) });
    const custom = this.getCustomPrompt('generateAbstract');
    const userContent = custom ? `${custom}\n\n论文标题：${title}\n\n论文正文：\n${content.slice(0, 4000)}` : prompts.GENERATE_ABSTRACT(title, content);
    const raw = await this.complete([{ role: 'user', content: userContent }], {
      temperature: 0.3,
      context: 'generateAbstract',
    });
    const parsed = this.safeParse(raw, schema);
    if (parsed) return parsed;
    return { abstract: '摘要生成失败：模型输出无法解析，请重试。', keywords: [] };
  }

  /** 单篇文献深度精读（zod 结构化校验） */
  async deepDivePaper(paper: string): Promise<{
    title: string;
    oneLine: string;
    researchQuestion: string;
    motivation: string;
    method: string;
    keyFindings: string[];
    limitations: string[];
    futureWork: string;
    takeaway: string;
  }> {
    const schema = z.object({
      title: z.string(),
      oneLine: z.string(),
      researchQuestion: z.string(),
      motivation: z.string(),
      method: z.string(),
      keyFindings: z.array(z.string()).min(1),
      limitations: z.array(z.string()),
      futureWork: z.string(),
      takeaway: z.string(),
    });
    const custom = this.getCustomPrompt('deepDivePaper');
    const content = custom ? `${custom}\n\n待精读论文：\n${paper}` : prompts.DEEP_DIVE_PAPER(paper);
    const raw = await this.complete([{ role: 'user', content }], {
      temperature: 0.2,
      context: 'deepDivePaper',
    });
    const parsed = this.safeParse(raw, schema);
    if (parsed) return parsed;
    return { title: '', oneLine: '', researchQuestion: '', motivation: '', method: '', keyFindings: [], limitations: [], futureWork: '', takeaway: '精读失败：模型输出无法解析，请重试。' };
  }

  /** 研究缺口定位（zod 结构化校验） */
  async researchGap(topic: string, papers: string): Promise<{
    gaps: { gap: string; evidence: string; opportunity: string; feasibility: string }[];
    recommendedTopic: string;
  }> {
    const schema = z.object({
      gaps: z
        .array(z.object({ gap: z.string(), evidence: z.string(), opportunity: z.string(), feasibility: z.string() }))
        .min(1),
      recommendedTopic: z.string(),
    });
    const custom = this.getCustomPrompt('researchGap');
    const content = custom ? `${custom}\n\n研究主题：${topic}\n\n已有文献：\n${papers}` : prompts.RESEARCH_GAP(topic, papers);
    const raw = await this.complete([{ role: 'user', content }], {
      temperature: 0.3,
      context: 'researchGap',
    });
    const parsed = this.safeParse(raw, schema);
    if (parsed) return parsed;
    return { gaps: [], recommendedTopic: '缺口分析失败：模型输出无法解析，请重试。' };
  }
}

export type ReviewResult = Awaited<ReturnType<AiService['reviewPaper']>>;
