import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import * as prompts from './prompts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * 统一 AI 服务：OpenAI 兼容协议（支持 OpenAI / DeepSeek / 通义千问 / 豆包 等）
 * 通过环境变量切换：AI_BASE_URL / AI_API_KEY / AI_MODEL
 */
@Injectable()
export class AiService {
  private baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  private apiKey = process.env.AI_API_KEY || '';
  private model = process.env.AI_MODEL || 'gpt-4o-mini';

  /** 是否已配置真实 AI 密钥 */
  get configured(): boolean {
    return !!this.apiKey;
  }

  get config(): { baseUrl: string; model: string; configured: boolean } {
    return { baseUrl: this.baseUrl, model: this.model, configured: this.configured };
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** 非流式补全 */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 4096,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new HttpException(`AI 服务调用失败 (${res.status}): ${errText.slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
    }
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content ?? '';
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
        model: this.model,
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
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
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

  /** 大纲生成（outline-first） */
  async writeOutline(topic: string, literatureSummary: string): Promise<{ title: string; sections: { title: string; subsections: string[] }[] }> {
    const raw = await this.complete([{ role: 'user', content: prompts.WRITE_OUTLINE(topic, literatureSummary) }], { temperature: 0.5 });
    return this.jsonOf<{ title: string; sections: { title: string; subsections: string[] }[] }>(raw);
  }

  /** 章节起草 */
  async draftSection(sectionTitle: string, outline: string, references: string): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.DRAFT_SECTION(sectionTitle, outline, references) }], { temperature: 0.6 });
  }

  /** 三段式润色/降重：原文 + 润色文 + 理由 */
  async polish(text: string, mode: 'polish' | 'reduce' = 'polish'): Promise<{ original: string; polished: string; reason: string }> {
    const raw = await this.complete([{ role: 'user', content: prompts.POLISH(text, mode) }], { temperature: 0.4 });
    return this.jsonOf<{ original: string; polished: string; reason: string }>(raw);
  }

  /** 学术翻译 */
  async translate(text: string, targetLang: 'zh' | 'en'): Promise<string> {
    return this.complete([{ role: 'user', content: prompts.TRANSLATE(text, targetLang) }], { temperature: 0.3 });
  }

  /** 7 维质量评审 */
  async reviewPaper(title: string, content: string): Promise<{
    scores: { literature: number; logic: number; citation: number; language: number; novelty: number; figures: number; format: number };
    feedback: string;
    totalScore: number;
  }> {
    const raw = await this.complete([{ role: 'user', content: prompts.REVIEW_PAPER(title, content) }], { temperature: 0.3 });
    const parsed = this.jsonOf<{ scores: Record<string, number>; feedback: string }>(raw);
    const scores = parsed.scores;
    const total = Math.round(
      (scores.literature + scores.logic + scores.citation + scores.language + scores.novelty + scores.figures + scores.format) / 7,
    );
    return { scores: scores as any, feedback: parsed.feedback, totalScore: total };
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
}

export type ReviewResult = Awaited<ReturnType<AiService['reviewPaper']>>;
