import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { agentRuns, pipelineTasks, projects } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { ReferencesService, PaperHit } from '../references/references.service';
import { QualityService } from '../research/quality.service';

export interface ResearchPlan {
  objective: string;
  researchQuestions: string[];
  searchStrategy: { keywords: string[] };
  draftingPlan: { sections: string[] };
  risks: string[];
}

export interface ReActTrace {
  round: number;
  thought: string;
  action: string;
  query: string;
  found: number;
}

/**
 * Phase 3：Supervisor 多 Agent 编排器
 * 把流水线改造成「规划 → 并行研究 → 写作 → 评审 → 润色」的专业 Agent 协作：
 * - 每个子 Agent 是独立执行单元（agent_run 表可观测、可追踪、单点失败不拖垮全局）
 * - 研究阶段按子问题拆成 3 路 ResearchAgent 并行执行（Promise.allSettled）
 * - 编排器负责调度、聚合、回炉（对标 AutoGen/Claude Agent SDK 的 Supervisor 模式）
 */
@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly ai: AiService,
    private readonly references: ReferencesService,
    private readonly quality: QualityService,
  ) {}

  /** 通用子 Agent 执行包装：落 agent_run 记录、计时、失败兜底 */
  private async runAgent(
    taskId: string,
    agentType: string,
    agentName: string,
    inputSummary: string,
    fn: () => Promise<{ output: string; detail: unknown }>,
  ): Promise<{ ok: boolean; output: string; error?: string }> {
    const id = randomUUID();
    const now = Date.now();
    db.insert(agentRuns)
      .values({ id, taskId, agentType, agentName, status: 'running', input: inputSummary, createdAt: now, updatedAt: now })
      .run();
    try {
      const res = await fn();
      db.update(agentRuns)
        .set({
          status: 'done',
          output: res.output.slice(0, 2000),
          detail: JSON.stringify(res.detail),
          durationMs: Date.now() - now,
          updatedAt: Date.now(),
        })
        .where(eq(agentRuns.id, id))
        .run();
      return { ok: true, output: res.output };
    } catch (e: any) {
      this.logger.warn(`[Agent:${agentName}] 失败: ${e.message}`);
      db.update(agentRuns)
        .set({ status: 'failed', error: String(e.message || e).slice(0, 500), durationMs: Date.now() - now, updatedAt: Date.now() })
        .where(eq(agentRuns.id, id))
        .run();
      return { ok: false, output: '', error: String(e.message || e).slice(0, 500) };
    }
  }

  /** 查询某流水线的全部子 Agent 执行记录 */
  listRuns(taskId: string) {
    return db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.taskId, taskId))
      .orderBy(agentRuns.createdAt)
      .all()
      .map((r) => ({ ...r, detail: safeParse(r.detail) }));
  }

  // ---------- ① Planner Agent：研究计划 ----------
  /** 差距 #22：按 taskId → projectId 取项目级系统提示 projectPreface（空串表示不注入） */
  private projectPreface(taskId: string): string {
    try {
      const task = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get();
      if (!task) return '';
      const proj = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
      return proj?.preface?.trim() || '';
    } catch {
      return '';
    }
  }

  /** taskId → projectId（研究阶段文献/知识库检索均限定本项目，避免跨项目串数据） */
  private projectIdOf(taskId: string): string | null {
    try {
      const task = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get();
      return task?.projectId || null;
    } catch {
      return null;
    }
  }

  async plannerAgent(taskId: string, topic: string): Promise<{ verifiedTopic: string; plan: ResearchPlan }> {
    const preface = this.projectPreface(taskId);
    const res = await this.runAgent(taskId, 'planner', 'planner#research-plan', `主题：${topic}`, async () => {
      const verifiedTopic = await this.ai.chat(
        `请把以下研究主题提炼为一句可执行的研究题目（直接输出题目本身，不要解释）：\n${topic}`,
      );
      // 仅 Planner 首轮系统提示注入项目要求（preface 为空时 generatePlan 行为完全不变）
      const plan = await this.ai.generatePlan(topic, preface);
      return {
        output: `目标：${plan.objective}；子问题 ${plan.researchQuestions.length} 个；章节 ${plan.draftingPlan.sections.length} 个`,
        detail: { verifiedTopic, objective: plan.objective, researchQuestions: plan.researchQuestions, searchStrategy: plan.searchStrategy, draftingPlan: plan.draftingPlan, risks: plan.risks },
      };
    });
    if (!res.ok) throw new Error(`Planner Agent 失败: ${res.error}`);
    const verifiedTopic = topic;
    // 由于 runAgent 把 detail 转成字符串，此处需从 agent_run 重新读取完整 detail
    const row = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentType, 'planner'))
      .all()
      .reverse()
      .find((r) => r.taskId === taskId && r.agentName === 'planner#research-plan');
    const full = safeParse(row?.detail ?? '{}') as { verifiedTopic: string; objective: string; researchQuestions: string[]; searchStrategy: { keywords: string[] }; draftingPlan: { sections: string[] }; risks: string[] };
    return {
      verifiedTopic: full.verifiedTopic || verifiedTopic,
      plan: {
        objective: full.objective || '',
        researchQuestions: full.researchQuestions || [],
        searchStrategy: { keywords: full.searchStrategy?.keywords || [] },
        draftingPlan: { sections: full.draftingPlan?.sections || [] },
        risks: full.risks || [],
      },
    };
  }

  // ---------- ② Research Agents：按子问题拆 3 路并行 ReAct ----------
  async researchAgents(
    taskId: string,
    topic: string,
    plan: ResearchPlan,
  ): Promise<{ hits: PaperHit[]; trace: ReActTrace[] }> {
    const projectId = this.projectIdOf(taskId);
    const seeds = [...new Set([...plan.searchStrategy.keywords, ...plan.researchQuestions].filter(Boolean))].slice(0, 6);
    // 分成 3 组（对应 3 路并行 ResearchAgent，各组聚焦不同子问题）
    const groups: string[][] = [[], [], []];
    seeds.forEach((q, i) => groups[i % 3].push(q));
    if (groups.every((g) => g.length === 0)) groups[0].push(topic);

    const results = await Promise.allSettled(
      groups.map((qs, idx) =>
        this.runAgent(taskId, 'research', `research#${idx + 1}`, `子问题组：${qs.join(' / ')}`, async () => {
          const { hits, trace } = await this.reactLoop(taskId, projectId, topic, plan, qs);
          return {
            output: `检索 ${trace.length} 轮，命中 ${hits.length} 篇`,
            detail: { queries: trace.filter((t) => t.action === 'search').map((t) => t.query), trace, hits: hits.slice(0, 30).map((h) => ({ title: h.title, authors: h.authors, year: h.year, venue: h.venue, doi: h.doi, url: h.url, abstract: (h.abstract || '').slice(0, 400), source: h.source, citationCount: h.citationCount })) },
          };
        }),
      ),
    );

    // 聚合 3 路结果（去重）
    const seen = new Set<string>();
    const hits: PaperHit[] = [];
    const trace: ReActTrace[] = [];
    const runs = db.select().from(agentRuns).where(eq(agentRuns.taskId, taskId)).all();
    for (let i = 1; i <= 3; i++) {
      const run = runs.find((r) => r.agentName === `research#${i}`);
      if (!run || run.status !== 'done') continue;
      const detail = safeParse(run.detail ?? '{}') as { trace?: ReActTrace[]; hits?: PaperHit[] } | null;
      for (const t of detail?.trace || []) {
        trace.push({ ...t, round: trace.length + 1 });
      }
      for (const h of detail?.hits || []) {
        if (h?.title && !seen.has(h.title)) {
          seen.add(h.title);
          hits.push(h);
        }
      }
    }
    return { hits, trace };
  }

  /** 单路 ReAct 循环（think → act → observe）；文献检索限定 projectId（本项目文献库） */
  private async reactLoop(
    taskId: string,
    projectId: string | null,
    topic: string,
    plan: ResearchPlan,
    seeds: string[],
  ): Promise<{ hits: PaperHit[]; trace: ReActTrace[] }> {
    const trace: ReActTrace[] = [];
    const seen = new Set<string>();
    const hits: PaperHit[] = [];
    for (const q of seeds) {
      try {
        const res = await this.references.search(q, 5, projectId ?? undefined);
        for (const h of res) {
          if (!seen.has(h.title)) {
            seen.add(h.title);
            hits.push({ ...h, origin: 'library' as const });
          }
        }
        trace.push({ round: trace.length + 1, thought: '按研究计划覆盖信息缺口', action: 'search', query: q, found: res.length });
      } catch (e: any) {
        this.logger.warn(`初始检索失败 [${q}]: ${e.message}`);
      }
    }
    const maxRounds = 3;
    for (let r = 0; r < maxRounds && hits.length < 24; r++) {
      const past = trace.map((t) => ({ round: t.round, query: t.query, found: t.found }));
      const decision = await this.ai.reactThink(topic, plan.researchQuestions, past);
      if (decision.action === 'done' || decision.coverage >= 85 || !decision.query) {
        trace.push({ round: trace.length + 1, thought: decision.thought || '信息已覆盖充分', action: 'done', query: '', found: hits.length });
        break;
      }
      try {
        const res = await this.references.search(decision.query, 6, projectId ?? undefined);
        const added = res.filter((h) => !seen.has(h.title));
        for (const h of added) {
          seen.add(h.title);
          hits.push({ ...h, origin: 'library' as const });
        }
        trace.push({ round: trace.length + 1, thought: decision.thought, action: 'search', query: decision.query, found: added.length });
      } catch (e: any) {
        this.logger.warn(`ReAct 补充检索失败 [${decision.query}]: ${e.message}`);
      }
    }
    if (trace[trace.length - 1]?.action !== 'done') {
      trace.push({ round: trace.length + 1, thought: '达到检索轮次上限，进入综合', action: 'done', query: '', found: hits.length });
    }
    return { hits, trace };
  }

  // ---------- ③ Writer Agent：分章起草（Phase 4 Agentic RAG：边写边查 + 注入记忆/反思） ----------
  /** 剥 JSON 围栏 / 整篇 JSON 对象，返回正文（起草模型偶发输出 ````json {...}```` 或思考前缀） */
  private stripJsonWrapper(s: string): string {
    let t = s.trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const o = JSON.parse(t);
        if (o && typeof o === 'object') {
          const body = o.content || o.polished || o.body || o.original || (Array.isArray(o) ? o[0]?.content : null);
          if (typeof body === 'string' && body.length > 100) return body;
        }
      } catch { /* 非 JSON，原样保留 */ }
    }
    return s;
  }

  async writerAgent(
    taskId: string,
    documentId: string,
    title: string,
    outline: { sections: { title: string; subsections: string[] }[] },
    ctx: { refsPrompt: string; styleHint: string; reflexion: string },
    opts: { skipAgenticSearch?: boolean } = {},
  ): Promise<{ output: string; content: string }> {
    const res = await this.runAgent(taskId, 'writer', 'writer#draft', `章节 ${outline.sections.length} 个：${outline.sections.map((s) => s.title).join(' / ')}`, async () => {
      let content = '';
      // 补充引用全局序号：Agentic RAG 检索到的文献按全局去重顺序编号（正文 [补充Ref:N] 与文末列表一一对应）
      let supplementCounter = 0;
      const sectionResults: { title: string; chars: number; agenticRounds: number; supplementalHits: { title: string; authors: string[]; year: number | null; venue: string; doi: string; url: string; abstract: string; source: string; citationCount: number }[] }[] = [];
      const seen = new Set<string>();
      for (const section of outline.sections) {
        // Phase 4：Agentic RAG —— 每章起草前按章节主题自定向补检索（回炉时不重复补检，省额度）
        const { hits, rounds } = opts.skipAgenticSearch
          ? { hits: [] as PaperHit[], rounds: 0 }
          : await this.agenticSearch(taskId, section.title, title);
        const fresh = hits.filter((h) => h.title && !seen.has(h.title));
        for (const h of fresh) seen.add(h.title);
        const extraRefs = fresh
          .slice(0, 4)
          .map((h) => `[补充Ref:${++supplementCounter}] ${h.title}（${(h.authors || []).slice(0, 2).join(', ')}，${h.year || 'n.d.'}，${h.source}）`)
          .join('\n');
        const sectionText = await this.ai.draftSection(
          section.title,
          JSON.stringify(outline),
          `${ctx.refsPrompt}${extraRefs ? `\n本节补充检索到的文献（Agentic RAG）：\n${extraRefs}` : ''}${ctx.styleHint}\n${ctx.reflexion ? `质量评审反馈（回炉改进指令）：${ctx.reflexion}` : ''}`,
        );
        content += `## ${section.title}\n\n${sectionText}\n\n`;
        sectionResults.push({
          title: section.title,
          chars: sectionText.length,
          agenticRounds: rounds,
          supplementalHits: fresh.slice(0, 5).map((h) => ({
            title: h.title,
            authors: h.authors || [],
            year: h.year ?? null,
            venue: h.venue || '',
            doi: h.doi || '',
            url: h.url || '',
            abstract: (h.abstract || '').slice(0, 400),
            source: h.source,
            citationCount: h.citationCount || 0,
          })),
        });
      }
      // 清洗：剥 ```json 围栏 / 整篇 JSON 对象（2.5-flash 偶发输出漂移），避免原始 JSON 污染正文
      content = this.stripJsonWrapper(content);
      return {
        output: `已起草 ${outline.sections.length} 个章节，共 ${content.length} 字（每章经 Agentic RAG 补检）`,
        detail: { sectionResults, fullContent: content },
      };
    });
    if (!res.ok) throw new Error(`Writer Agent 失败: ${res.error}`);
    const row = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentType, 'writer'))
      .all()
      .reverse()
      .find((r) => r.taskId === taskId && r.status === 'done');
    const detail = safeParse(row?.detail ?? '{}') as { fullContent?: string } | null;
    return { output: res.output, content: detail?.fullContent || '' };
  }

  /** 汇总 Writer Agent 补充检索到的文献标题（供流水线回填文献库） */
  extractWriterHits(taskId: string): PaperHit[] {
    const run = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentType, 'writer'))
      .all()
      .reverse()
      .find((r) => r.taskId === taskId && r.status === 'done');
    if (!run) return [];
    const detail = safeParse(run.detail ?? '{}') as {
      sectionResults?: {
        supplementalHits?: { title: string; authors: string[]; year: number | null; venue: string; doi: string; url: string; abstract: string; source: string; citationCount: number }[]
      }[]
    } | null;
    const seen = new Set<string>();
    const out: PaperHit[] = [];
    for (const s of detail?.sectionResults || []) {
      for (const h of s.supplementalHits || []) {
        if (!h?.title || seen.has(h.title)) continue;
        seen.add(h.title);
        out.push({ title: h.title, authors: h.authors || [], year: h.year, venue: h.venue, doi: h.doi, url: h.url, abstract: h.abstract, source: h.source as PaperHit['source'], citationCount: h.citationCount });
      }
    }
    return out;
  }

  /**
   * Phase 4：Agentic RAG 自定向检索
   * 不再一次性检索，而是「检索 → 评估缺口 → 补检 → 收尾」的迭代循环（对标 Deep Research 的迭代式研究）
   */
  private async agenticSearch(taskId: string, question: string, topic: string): Promise<{ hits: PaperHit[]; rounds: number }> {
    const projectId = this.projectIdOf(taskId);
    const seen = new Set<string>();
    const hits: PaperHit[] = [];
    const budget = 2;
    let rounds = 0;
    for (let r = 0; r < budget; r++) {
      rounds += 1;
      let res: PaperHit[] = [];
      try {
        res = (await this.references.search(question, 5, projectId ?? undefined)).map((h) => ({ ...h, origin: 'library' as const }));
      } catch {
        /* 源限流时跳过本路 */
      }
      for (const h of res) {
        if (h.title && !seen.has(h.title)) {
          seen.add(h.title);
          hits.push(h);
        }
      }
      if (r < budget - 1) {
        try {
          const decision = await this.ai.reactThink(`${topic}（当前章节：${question}）`, [], [{ round: r + 1, query: question, found: hits.length }]);
          if (decision.action === 'done' || decision.coverage >= 85 || !decision.query) break;
          const next = (await this.references.search(decision.query, 4, projectId ?? undefined)).map((h) => ({ ...h, origin: 'library' as const }));
          for (const h of next) {
            if (h.title && !seen.has(h.title)) {
              seen.add(h.title);
              hits.push(h);
            }
          }
          rounds += 1;
          break;
        } catch {
          break;
        }
      }
    }
    return { hits, rounds };
  }

  // ---------- ④ Reviewer Agent：质量评审 + Reflexion 反思 ----------
  async reviewerAgent(
    taskId: string,
    documentId: string,
    title: string,
    content: string,
    topic: string,
    pastReflexion: string[],
  ): Promise<{ report: { totalScore: number; feedback: string }; reflexion: { note: string; instructions: string[] } | null }> {
    const review = await this.runAgent(taskId, 'reviewer', 'reviewer#quality-gate', `7 维评审，正文 ${content.length} 字`, async () => {
      const report = await this.quality.review(documentId, title, content);
      let reflexion: { note: string; instructions: string[] } | null = null;
      if (report.totalScore < 80) {
        reflexion = await this.ai.reflect(topic, report.feedback, pastReflexion.join('\n'));
      }
      return {
        output: `总分 ${report.totalScore}/100${reflexion ? `，提炼反思指令 ${reflexion.instructions.length} 条` : '，达标'}`,
        detail: { report, reflexion },
      };
    });
    if (!review.ok) throw new Error(`Reviewer Agent 失败: ${review.error}`);
    const row = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentType, 'reviewer'))
      .all()
      .reverse()
      .find((r) => r.taskId === taskId && r.status === 'done');
    const full = safeParse(row?.detail ?? '{}') as { report: { totalScore: number; feedback: string }; reflexion: { note: string; instructions: string[] } | null };
    return { report: full.report, reflexion: full.reflexion || null };
  }

  // ---------- ⑤ Polisher Agent：润色定稿 ----------
  async polisherAgent(taskId: string, content: string): Promise<{ original: string; polished: string; reason: string }> {
    const res = await this.runAgent(taskId, 'polisher', 'polisher#final', `润色全文 ${content.length} 字`, async () => {
      const polished = await this.ai.polish(content, 'polish');
      return { output: '润色完成（原文+润色文+理由已存档）', detail: polished };
    });
    if (!res.ok) throw new Error(`Polisher Agent 失败: ${res.error}`);
    const row = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentType, 'polisher'))
      .all()
      .reverse()
      .find((r) => r.taskId === taskId && r.status === 'done');
    const full = safeParse(row?.detail ?? '{}') as { original: string; polished: string; reason: string };
    return { original: full.original || '', polished: full.polished || '', reason: full.reason || '' };
  }
}

function safeParse(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
