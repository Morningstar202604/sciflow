import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { sqlite } from '../db/database';
import * as prompts from './prompts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** 模型档位：fast=轻量快速（默认），strong=强模型（长文/评审/规划等高难任务） */
  model?: 'fast' | 'strong';
}

/**
 * 统一 AI 服务：OpenAI 兼容协议（支持 OpenAI / DeepSeek / 通义千问 / 豆包 等）
 * 通过环境变量切换：AI_BASE_URL / AI_API_KEY / AI_MODEL
 */
@Injectable()
export class AiService {
  private baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  private apiKey = process.env.AI_API_KEY || '';
  /** fast 档：轻量快速模型（默认） */
  private fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || 'agnes-3.0-flash';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  private strongModel = process.env.AI_MODEL_STRONG || this.fastModel;

  constructor() {
    this.applyActiveProvider();
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

  /** 是否已配置真实 AI 密钥 */
  get configured(): boolean {
    return !!this.apiKey;
  }

  get config(): { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean } {
    return { baseUrl: this.baseUrl, model: this.fastModel, fastModel: this.fastModel, strongModel: this.strongModel, configured: this.configured };
  }

  private resolveModel(opts: CompleteOptions): string {
    return opts.model === 'strong' ? this.strongModel : this.fastModel;
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
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
      // 等待下一次补充（最长等 30s，避免静默死锁）
      await new Promise((r) => setTimeout(r, Math.min(refillMs - elapsed + 200, 30_000)));
    }
  }

  /** 非流式补全（全局令牌桶排队 + 429 退避重试） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.acquireToken();
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.resolveModel(opts),
            messages,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.maxTokens ?? 4096,
            stream: false,
          }),
          signal: AbortSignal.timeout(180_000),
        });
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
        return data.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        if (e instanceof HttpException) throw e;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, attempt * 3000));
          continue;
        }
        throw e;
      }
    }
    throw new HttpException('AI 服务调用失败（多次重试后仍失败）', HttpStatus.BAD_GATEWAY);
  }

  /** 流式补全，返回上游响应体（Web ReadableStream），用于 SSE 转发 */
  async completeStream(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.resolveModel(opts),
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        stream: true,
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new HttpException(`AI 流式调用失败 (${res.status}): ${errText.slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
    }
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
  async chat(question: string, history: ChatMessage[] = []): Promise<string> {
    return this.complete([{ role: 'system', content: prompts.CHAT_SYSTEM }, ...history, { role: 'user', content: question }]);
  }

  /** 科研问答（流式） */
  streamChat(question: string, history: ChatMessage[] = []): Promise<ReadableStream<Uint8Array>> {
    return this.completeStream([{ role: 'system', content: prompts.CHAT_SYSTEM }, ...history, { role: 'user', content: question }]);
  }

  /** 选题建议 */
  async suggestTopics(field: string, context: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.SUGGEST_TOPICS(field, context) }], { temperature: 0.8 });
  }

  /** 大纲生成（outline-first）；解析失败时按纯文本标题兜底 */
  async writeOutline(topic: string, literatureSummary: string): Promise<{ title: string; sections: { title: string; subsections: string[] }[] }> {
    const raw = await this.complete([{ role: 'user', content: prompts.WRITE_OUTLINE(topic, literatureSummary) }], { temperature: 0.5, model: 'strong' });
    try {
      const parsed = this.jsonOf<{ title: string; sections: { title: string; subsections: string[] }[] }>(raw);
      return { title: parsed.title || topic, sections: Array.isArray(parsed.sections) ? parsed.sections : [] };
    } catch {
      return { title: topic, sections: [{ title: '引言', subsections: [] }, { title: '相关工作', subsections: [] }, { title: '方法', subsections: [] }, { title: '实验与结果', subsections: [] }, { title: '讨论', subsections: [] }, { title: '结论', subsections: [] }] };
    }
  }

  /** 章节起草 */
  async draftSection(sectionTitle: string, outline: string, references: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.DRAFT_SECTION(sectionTitle, outline, references) }], { temperature: 0.6, model: 'strong' });
  }

  /** 三段式润色/降重：原文 + 润色文 + 理由（AI 输出缺字段或嵌套时递归回退，防止落库异常） */
  async polish(text: string, mode: 'polish' | 'reduce' = 'polish'): Promise<{ original: string; polished: string; reason: string }> {
    const raw = await this.complete([{ role: 'user', content: prompts.POLISH(text, mode) }], { temperature: 0.4 });
    let parsed: Partial<{ original: string; polished: string; reason: string }> = {};
    try {
      parsed = this.jsonOf<{ original: string; polished: string; reason: string }>(raw);
    } catch {
      parsed = { polished: raw };
    }
    let polishedText = String(parsed.polished || text || '').trim();
    // 处理 AI 嵌套输出：polished 字段本身又是 JSON 对象文本（含 original/reason 键）
    if (polishedText.startsWith('{') && (polishedText.includes('"original"') || polishedText.includes('"reason"'))) {
      try {
        const nested = this.jsonOf<{ original?: string; polished?: string; reason?: string }>(polishedText);
        polishedText = String(nested.polished || nested.original || polishedText).trim();
      } catch {
        /* 保持原样 */
      }
    }
    return {
      original: String(parsed.original || text || '').trim(),
      polished: polishedText,
      reason: String(parsed.reason || '').trim(),
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
    const raw = await this.complete([{ role: 'user', content: prompts.REVIEW_PAPER(title, content) }], { temperature: 0.3, model: 'strong' });
    let parsed: { scores?: Record<string, number>; feedback?: string } = {};
    try {
      parsed = this.jsonOf<{ scores: Record<string, number>; feedback: string }>(raw);
    } catch {
      /* 保留空对象兜底 */
    }
    const dims = ['literature', 'logic', 'citation', 'language', 'novelty', 'figures', 'format'] as const;
    const scores = {} as Record<string, number>;
    for (const d of dims) scores[d] = Math.max(0, Math.min(100, Number(parsed.scores?.[d]) || 0));
    const total = Math.round(dims.reduce((sum, d) => sum + scores[d], 0) / dims.length);
    return { scores: scores as any, feedback: String(parsed.feedback || '').trim(), totalScore: total };
  }

  /** 文献综述 */
  async summarizeLiterature(topic: string, papers: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.SUMMARIZE_LITERATURE(topic, papers) }], { temperature: 0.5 });
  }

  /** 期刊推荐 */
  async recommendJournal(title: string, abstract: string, field: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.RECOMMEND_JOURNAL(title, abstract, field) }], { temperature: 0.5 });
  }

  /** Cover Letter */
  async coverLetter(title: string, abstract: string, journal: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.COVER_LETTER(title, abstract, journal) }], { temperature: 0.5 });
  }

  /** 审稿回复 */
  async replyReview(reviewComments: string, response: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.REPLY_REVIEW(reviewComments, response) }], { temperature: 0.5 });
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
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: target,
          messages: [{ role: 'user', content: '请只回复两个字：正常' }],
          max_tokens: 16,
          stream: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { ok: false, reply: `HTTP ${res.status}: ${err.slice(0, 200)}`, model: target, latencyMs: Date.now() - t0 };
      }
      const data = (await res.json()) as any;
      return { ok: true, reply: data.choices?.[0]?.message?.content ?? '（空回复）', model: target, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, reply: e.message || String(e), model: target, latencyMs: Date.now() - t0 };
    }
  }

  /** Elicit 式：文献结构化提取（字段统一字符串化） */
  async extractPaperTable(papers: string): Promise<{ ref: string; title: string; year: number; method: string; results: string; contribution: string; limitations: string }[]> {
    const raw = await this.complete([{ role: 'user', content: prompts.EXTRACT_PAPER_TABLE(papers) }], { temperature: 0.2 });
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
    const raw = await this.complete([{ role: 'user', content: prompts.EVIDENCE_SYNTHESIS(question, papers) }], { temperature: 0.3 });
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
    return this.complete([{ role: 'user', content: prompts.KNOWLEDGE_QA(question, chunks) }], { temperature: 0.3, maxTokens: 2048 });
  }

  // ---------- Phase 1：Planner / ReAct / Reflexion ----------

  /** 研究计划生成（对标 GPT Researcher planner）：解析失败时回退标准计划 */
  async generatePlan(topic: string): Promise<{
    objective: string;
    researchQuestions: string[];
    searchStrategy: { keywords: string[]; minPapers: number; depth: string };
    draftingPlan: { sections: string[]; wordCount: number };
    risks: string[];
  }> {
    const raw = await this.complete([{ role: 'user', content: prompts.PLAN_RESEARCH(topic) }], { temperature: 0.4, model: 'strong' });
    try {
      const p = this.jsonOf<any>(raw);
      return {
        objective: String(p.objective || `围绕「${topic}」完成一篇系统性综述`),
        researchQuestions: (Array.isArray(p.researchQuestions) ? p.researchQuestions : [topic]).slice(0, 5).map(String),
        searchStrategy: {
          keywords: (Array.isArray(p.searchStrategy?.keywords) ? p.searchStrategy.keywords : [topic]).slice(0, 8).map(String),
          minPapers: Number(p.searchStrategy?.minPapers) || 8,
          depth: String(p.searchStrategy?.depth || 'overview'),
        },
        draftingPlan: {
          sections: (Array.isArray(p.draftingPlan?.sections) ? p.draftingPlan.sections : ['引言', '相关工作', '方法', '实验与结果', '讨论', '结论']).map(String),
          wordCount: Number(p.draftingPlan?.wordCount) || 6000,
        },
        risks: (Array.isArray(p.risks) ? p.risks : []).map(String),
      };
    } catch {
      return {
        objective: `围绕「${topic}」完成一篇系统性综述`,
        researchQuestions: [topic],
        searchStrategy: { keywords: [topic], minPapers: 8, depth: 'overview' },
        draftingPlan: { sections: ['引言', '相关工作', '方法', '实验与结果', '讨论', '结论'], wordCount: 6000 },
        risks: [],
      };
    }
  }

  /** ReAct 思考步：决定检索或收尾（对标 ReAct think-act-observe） */
  async reactThink(
    topic: string,
    questions: string[],
    past: { round: number; query: string; found: number }[],
  ): Promise<{ thought: string; action: 'search' | 'done'; query: string; coverage: number }> {
    const pastText = past
      .map((p) => `第${p.round}轮：检索词「${p.query}」→ 获得 ${p.found} 条文献`)
      .join('\n');
    const raw = await this.complete([{ role: 'user', content: prompts.REACT_THINK(topic, questions, pastText) }], { temperature: 0.3 });
    try {
      const r = this.jsonOf<any>(raw);
      return {
        thought: String(r.thought || ''),
        action: r.action === 'done' ? 'done' : 'search',
        query: String(r.query || ''),
        coverage: Math.max(0, Math.min(100, Number(r.coverage) || 0)),
      };
    } catch {
      return { thought: '（解析失败，进入下一轮检索）', action: 'search', query: '', coverage: 0 };
    }
  }

  /** Reflexion：把评审反馈提炼为可执行修改指令（对标 Reflexion 语义梯度） */
  async reflect(topic: string, feedback: string, pastReflections: string): Promise<{ note: string; instructions: string[] }> {
    const raw = await this.complete(
      [{ role: 'user', content: prompts.REFLEXION_PROMPT(topic, feedback, pastReflections) }],
      { temperature: 0.3 },
    );
    try {
      const r = this.jsonOf<any>(raw);
      return {
        note: String(r.note || '改进论文质量'),
        instructions: (Array.isArray(r.instructions) ? r.instructions : []).map(String).slice(0, 5),
      };
    } catch {
      return { note: '改进论文质量', instructions: [] };
    }
  }

  // ---------- Phase 2：记忆 ----------

  /** 情景记忆压缩（从完成的任务中提炼可复用要点） */
  async extractEpisodic(projectName: string, docTitle: string, outline: string, score: number): Promise<{ content: string; keywords: string[] }> {
    const raw = await this.complete(
      [{ role: 'user', content: prompts.EPISODIC_EXTRACT(projectName, docTitle, outline, score) }],
      { temperature: 0.2 },
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
}

export type ReviewResult = Awaited<ReturnType<AiService['reviewPaper']>>;
