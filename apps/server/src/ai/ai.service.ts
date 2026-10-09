import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as prompts from './prompts';
import { AiTransportService, ChatMessage, ChatStreamOptions, CompleteOptions } from './ai-transport.service';
import { safeParse as safeParseFromUtils } from './json-utils';
import { parseJson } from '../common/json-guard';

/**
 * 统一 AI 服务（domain 编排层）
 *
 * 所有 HTTP 协议、重试、限流、成本落库、多厂商切换都抽到了
 * AiTransportService —— 这里只负责把领域问题翻译成 prompt、掉用 transport、
 * 把 LLM 输出 parse 回业务对象。
 *
 * 公共 API 保持逐字节兼容（方法名、参数、返回类型都和重构前一样）。
 */
@Injectable()
export class AiService extends AiTransportService {
  /** 委托给 json-utils（保留此方法以兼容现有调用点，语义 1:1 等价于重构前的 private 实现） */
  safeParse<T>(text: string, schema: z.ZodType<T>): T | null {
    return safeParseFromUtils(text, schema);
  }

  /** 便捷访问：显式透传给下游的安全 parse（与 this.safeParse 等价，便于未来迁移） */
  jsonOf<T>(text: string): T {
    // jsonOf 与重构前 private 行为完全一致：解析失败抛错
    return JSON.parse(stripFencesAndExtract(text)) as T;
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

  /** 7 维质量评审（结构化输出：response_format json_schema 保证 JSON 合法，无需手工 strip 修复） */
  async reviewPaper(title: string, content: string): Promise<{
    scores: { literature: number; logic: number; citation: number; language: number; novelty: number; figures: number; format: number };
    feedback: string;
    totalScore: number;
  }> {
    // JSON Schema：强制模型输出合法 JSON，避免 reasoning 前缀/多余文本/不平衡括号等问题
    const reviewSchema = {
      name: 'review_result',
      schema: {
        type: 'object',
        properties: {
          scores: {
            type: 'object',
            properties: {
              literature: { type: 'number', minimum: 0, maximum: 100 },
              logic: { type: 'number', minimum: 0, maximum: 100 },
              citation: { type: 'number', minimum: 0, maximum: 100 },
              language: { type: 'number', minimum: 0, maximum: 100 },
              novelty: { type: 'number', minimum: 0, maximum: 100 },
              figures: { type: 'number', minimum: 0, maximum: 100 },
              format: { type: 'number', minimum: 0, maximum: 100 },
            },
            required: ['literature', 'logic', 'citation', 'language', 'novelty', 'figures', 'format'],
            additionalProperties: false,
          },
          feedback: { type: 'string' },
        },
        required: ['scores', 'feedback'],
        additionalProperties: false,
      },
    };
    const raw = await this.complete(
      [{ role: 'user', content: prompts.REVIEW_PAPER(title, content) }],
      { temperature: 0.3, model: 'fast', context: 'reviewPaper', jsonSchema: reviewSchema },
    );
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
      weights = parseJson<Record<string, number>>(row?.value, {});
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
        this.logger.warn(`配图 JSON 解析失败（第 ${attempt + 1} 次），重试…`);
      }
    }
    if (!parsed) {
      this.logger.warn('配图两次解析均失败，本轮跳过图表生成');
      return [];
    }
    return (parsed.figures || []).slice(0, 3).map((f) => ({
      title: String(f.title || ''),
      caption: String(f.caption || ''),
      mermaid: String(f.mermaid || '').trim(),
    })).filter((f) => f.mermaid && f.title);
  }

  /** 论文摘要 + 关键词生成（zod 结构化校验） */
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

/**
 * 剥离 markdown 代码围栏 + 提取第一个平衡 JSON 对象文本。
 * 仅给 jsonOf 用 — 与重构前 private jsonOf 行为等价。
 */
function stripFencesAndExtract(text: string): string {
  let cleaned = String(text ?? '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
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
  return cleaned;
}

export type ReviewResult = Awaited<ReturnType<AiService['reviewPaper']>>;
export { ChatMessage, ChatStreamOptions, CompleteOptions } from './ai-transport.service';
