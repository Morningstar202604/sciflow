import { Injectable, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/database';
import { journals } from '../db/schema';
import { AiService } from '../ai/ai.service';

/** AI 期刊匹配结构化输出：{ journals: [{ name, score, reason, gap }] } */
const journalMatchSchema = z.object({
  journals: z
    .array(
      z.object({
        name: z.string(),
        score: z.number(),
        reason: z.string(),
        gap: z.string(),
      }),
    )
    .min(1),
});

@Injectable()
export class SubmissionService {
  constructor(private readonly ai: AiService) {}

  /** 期刊推荐 */
  recommendJournals(title: string, abstract: string, field: string) {
    if (!title && !abstract) throw new BadRequestException('请提供论文标题或摘要');
    return this.ai.recommendJournal(title || '(未命名)', abstract || '(未提供摘要)', field || '通用');
  }

  /** Cover Letter */
  coverLetter(title: string, abstract: string, journal: string) {
    if (!journal) throw new BadRequestException('请指定目标期刊');
    return this.ai.coverLetter(title || '(未命名)', abstract || '', journal);
  }

  /** 审稿意见回复 */
  replyReview(reviewComments: string, response = '') {
    if (!reviewComments) throw new BadRequestException('请粘贴审稿意见');
    return this.ai.replyReview(reviewComments, response);
  }

  // ---------- 自建期刊库 ----------

  /** 列出全部期刊 */
  listJournals() {
    return db.select().from(journals).orderBy(journals.name).all();
  }

  /** 新增期刊（指标类字段缺失即 NULL，禁止编造） */
  addJournal(body: {
    name: string;
    issn?: string;
    publisher?: string;
    scopeText?: string;
    if2024?: number | null;
    quartile?: string;
    firstDecisionWeeks?: number | null;
    acceptanceRate?: number | null;
    oa?: string;
  }) {
    if (!body.name?.trim()) throw new BadRequestException('期刊名必填');
    const row = {
      id: randomUUID(),
      name: body.name.trim(),
      issn: body.issn || '',
      publisher: body.publisher || '',
      scopeText: body.scopeText || '',
      if2024: body.if2024 ?? null,
      quartile: body.quartile || '',
      firstDecisionWeeks: body.firstDecisionWeeks ?? null,
      acceptanceRate: body.acceptanceRate ?? null,
      oa: body.oa || '',
      createdAt: Date.now(),
    };
    db.insert(journals).values(row).run();
    return row;
  }

  /** 删除期刊 */
  deleteJournal(id: string) {
    db.delete(journals).where(eq(journals.id, id)).run();
    return { ok: true };
  }

  /** 结构化期刊推荐：AI 给 3-6 条候选，命中库内期刊则补充指标并标记 isInLibrary */
  async matchJournals(title: string, abstract: string) {
    if (!title.trim() && !abstract.trim()) throw new BadRequestException('请提供论文标题或摘要');
    const custom = this.ai.getCustomPrompt('journalsMatch');
    const userContent =
      custom ??
      `你是学术投稿顾问。请根据下面这篇论文的标题与摘要，推荐 3-6 本最适合投稿的学术期刊（中文期刊优先，兼顾国际中文圈常见方向）。` +
        `严格只输出 JSON 对象：{"journals":[{"name":"期刊名","score":0到100的匹配分,"reason":"为什么匹配","gap":"还需补强/注意什么"}]}。\n\n` +
        `论文标题：${title || '(未提供)'}\n摘要：${(abstract || '(未提供)').slice(0, 1500)}`;
    let parsed: z.infer<typeof journalMatchSchema> | null;
    try {
      const raw = await this.ai.complete([{ role: 'user', content: userContent }], {
        temperature: 0.4,
        model: 'strong',
        context: 'journalsMatch',
      });
      parsed = this.ai.safeParse(raw, journalMatchSchema);
    } catch {
      throw new BadRequestException('期刊推荐失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
    if (!parsed) throw new BadRequestException('期刊推荐结果解析失败，请重试');

    // 库内期刊按名称（忽略大小写/空白）建索引，用于补充指标
    const lib = this.listJournals();
    const byName = new Map<string, (typeof lib)[number]>();
    for (const j of lib) byName.set(j.name.trim().toLowerCase(), j);

    const items = parsed.journals.slice(0, 6).map((j) => {
      const hit = byName.get(j.name.trim().toLowerCase());
      return {
        name: j.name,
        score: Math.max(0, Math.min(100, Number(j.score) || 0)),
        reason: j.reason || '',
        gap: j.gap || '',
        isInLibrary: Boolean(hit),
        if2024: hit?.if2024 ?? null,
        quartile: hit?.quartile ?? '',
        firstDecisionWeeks: hit?.firstDecisionWeeks ?? null,
        acceptanceRate: hit?.acceptanceRate ?? null,
        oa: hit?.oa ?? '',
      };
    });
    return { journals: items };
  }
}
