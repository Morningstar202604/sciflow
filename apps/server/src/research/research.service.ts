import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import * as prompts from '../ai/prompts';

/** 科研增强模块：研究设计诊断 / 多文献对比 / 多角色模拟审稿 */

const designReviewSchema = z.object({
  noveltyScore: z.number(),
  noveltyFeedback: z.string(),
  feasibilityScore: z.number(),
  feasibilityFeedback: z.string(),
  methods: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

const comparisonSchema = z.object({
  summary: z.string(),
  rows: z.array(
    z.object({
      paper: z.string(),
      研究问题: z.string(),
      方法: z.string(),
      主要结论: z.string(),
      局限: z.string(),
    }),
  ),
});

const simulatedReviewSchema = z.object({
  reviewers: z.array(
    z.object({
      role: z.string(),
      score: z.number(),
      strengths: z.array(z.string()),
      concerns: z.array(z.string()),
      suggestion: z.string(),
    }),
  ),
  verdict: z.string(),
  overall: z.string(),
});

export interface ResearchPaperInput {
  title: string;
  year?: number | null;
  venue?: string;
  abstract?: string;
  method?: string;
  conclusion?: string;
}

@Injectable()
export class ResearchService {
  constructor(private readonly ai: AiService) {}

  /** 研究设计诊断：想法 + 相关文献 → 新颖性/可行性/方法/风险/下一步 */
  async designReview(idea: string, papers: ResearchPaperInput[] = []) {
    if (!idea.trim()) {
      return { error: '请先描述研究想法' };
    }
    const paperText = papers
      .map(
        (p, i) =>
          `${i + 1}. ${p.title}${p.year ? `（${p.year}）` : ''}${p.venue ? ` [${p.venue}]` : ''}` +
          (p.abstract ? ` | 摘要：${p.abstract.slice(0, 200)}` : ''),
      )
      .join('\n');
    const raw = await this.ai.complete(
      [{ role: 'user', content: prompts.DESIGN_REVIEW(idea, paperText) }],
      { temperature: 0.5, model: 'strong', context: 'designReview' },
    );
    const parsed = this.ai.safeParse(raw, designReviewSchema);
    if (!parsed) {
      return { error: '诊断结果解析失败，请重试', raw };
    }
    return { ...parsed, paperCount: papers.length };
  }

  /** 多文献对比：多篇论文 → 横向对比表 */
  async comparePapers(papers: ResearchPaperInput[]) {
    if (!papers.length) {
      return { error: '请至少选择两篇论文进行对比' };
    }
    const paperText = papers
      .map(
        (p, i) =>
          `${i + 1}. ${p.title} | ${p.year ?? 'N/A'} | ${p.venue || 'N/A'} | ` +
          `方法：${p.method || p.abstract?.slice(0, 120) || 'N/A'} | ` +
          `结论：${p.conclusion || p.abstract?.slice(120, 240) || 'N/A'}`,
      )
      .join('\n');
    const raw = await this.ai.complete(
      [{ role: 'user', content: prompts.PAPER_COMPARISON(paperText) }],
      { temperature: 0.4, model: 'strong', context: 'paperComparison' },
    );
    const parsed = this.ai.safeParse(raw, comparisonSchema);
    if (!parsed) {
      return { error: '对比结果解析失败，请重试', raw };
    }
    return parsed;
  }

  /** 多角色模拟同行评审：3 位审稿人 + 主编综合决定 */
  async simulatedReview(title: string, content: string) {
    if (content.trim().length < 50) {
      return { error: '论文内容过短（至少 50 字），暂无法评审' };
    }
    const raw = await this.ai.complete(
      [{ role: 'user', content: prompts.SIMULATED_REVIEW(title, content.slice(0, 8000)) }],
      { temperature: 0.4, model: 'strong', context: 'simulatedReview' },
    );
    const parsed = this.ai.safeParse(raw, simulatedReviewSchema);
    if (!parsed) {
      return { error: '审稿意见解析失败，请重试', raw };
    }
    return parsed;
  }
}
