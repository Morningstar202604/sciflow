/**
 * DAG Step Registry — lightweight sequential executor for the writing pipeline.
 *
 * Each step is a self-contained function that receives an immutable context
 * snapshot and returns a partial context to be merged.  The executor handles
 * persistence of step state (running/done/skipped/failed), error routing
 * (abort / skip / retry), and upstream onStep notifications.
 */

import type { PaperHit } from '../references/references.service';

// ─── Typed context interfaces ─────────────────────────────────────

/** pipeline_task row shape (matches db/schema.ts pipelineTasks table produced by drizzle $inferSelect) */
export interface PipelineTaskRow {
  id: string;
  projectId: string;
  documentId: string | null;
  topic: string;
  currentStep: string | null;
  status: string | null;
  retryCount: number | null;
  lastError: string | null;
  researchNotice: string | null;
  researchMeta: string | null;
}

export interface OutlineSection {
  title: string;
  subsections?: string[];
}

export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface QualityReport {
  totalScore: number;
  feedback: string;
}

/** Cross-library hit enriched during cross-enrichment step. */
export interface LibraryHit {
  doi?: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  url?: string;
}

/** Knowledge-base hit during cross-enrichment step. */
export interface KnowledgeHit {
  docId: string;
  docName: string;
  chunk: string;
  score: number;
}

/** Result of a Polish step. */
export interface PolishResult {
  polished: string;
  delta?: number;
}

export interface ResearchPlan {
  searchStrategy?: { keywords?: string[] };
}

export interface ResearchTraceEntry {
  step: string;
  query: string;
  count: number;
}

/**
 * Mutable context that flows through the DAG.
 * All fields that were previously `any` are now typed.
 */
export interface PipelineContext {
  // ── Specified fields ────────────────────────────────────────
  task: PipelineTaskRow;
  outline?: Outline;
  libraryHits?: LibraryHit[];
  knowledgeHits?: KnowledgeHit[];
  libExpanded?: boolean;
  draftContent?: string;
  polishResult?: PolishResult;
  qualityResult?: QualityReport;
  qualityRetryCount: number;
  finalText?: string;
  memoryNote?: string;

  // ── Legacy fields still accessed by PipelineService ─────────
  verifiedTopic?: string;
  plan?: ResearchPlan;
  researchTrace?: ResearchTraceEntry[];
  enrichedLibHits?: PaperHit[];
  enrichedKnHits?: PaperHit[];
  researchNotice?: string;
  documentId?: string;
  literatureSummary?: string;
  report?: QualityReport;
}

export interface PipelineStep {
  key: string;
  label: string;
  run: (ctx: PipelineContext) => Promise<Partial<PipelineContext> | void>;
  onError?: (ctx: PipelineContext, err: Error) => Promise<'abort' | 'skip' | 'retry'>;
}

// ─── Symbols / constants ──────────────────────────────────────────

/** human-in-the-loop 等待确认哨兵（outline 步骤抛出以中断前段 DAG） */
export const AWAITING_CONFIRMATION = Symbol('AWAITING_CONFIRMATION');

/** 最大单步重试次数 */
const MAX_DAG_RETRY = 3;

export type StepNotification =
  | { status: 'running' }
  | { status: 'done'; output?: string }
  | { status: 'skipped'; output?: string }
  | { status: 'failed'; error: string }
  | { status: 'awaiting_confirmation'; output?: string };

/**
 * 顺序执行步骤组。
 * @param steps   当前段要运行的步骤子集
 * @param ctx     入链上下文（会被逐步合并）
 * @param notify  每一步完成时的回调（通知持久化层）
 * @param warn    可选的日志警告函数
 */
export async function executeDAG(
  steps: PipelineStep[],
  ctx: PipelineContext,
  notify: (step: PipelineStep, n: StepNotification) => Promise<void>,
  warn?: (msg: string) => void,
): Promise<PipelineContext> {
  let current = { ...ctx };
  for (const step of steps) {
    await notify(step, { status: 'running' });
    try {
      const partial = await step.run(current);
      if (partial) current = { ...current, ...partial };
      await notify(step, { status: 'done' });
    } catch (err: any) {
      // human gate 信号不视为错误，向上透传以中断前段 DAG
      if (err?.cause === AWAITING_CONFIRMATION) {
        await notify(step, { status: 'awaiting_confirmation', output: (err as any)?._outline ? JSON.stringify((err as any)._outline) : undefined });
        throw err;
      }
      const action = step.onError
        ? await step.onError(current, err as Error)
        : 'abort';
      if (action === 'retry') {
        let attempt = 0;
        let retryCtx = current;
        while (attempt < MAX_DAG_RETRY) {
          attempt += 1;
          try {
            const partial = await step.run(retryCtx);
            if (partial) retryCtx = { ...retryCtx, ...partial };
            current = retryCtx;
            await notify(step, { status: 'done' });
            break;
          } catch (retryErr: any) {
            if (attempt >= MAX_DAG_RETRY) {
              await notify(step, { status: 'failed', error: retryErr.message || String(retryErr) });
              warn?.(`[DAG] step "${step.key}" 重试 ${MAX_DAG_RETRY} 次后仍失败，abort`);
              throw retryErr;
            }
          }
        }
        continue;
      }
      if (action === 'skip') {
        await notify(step, { status: 'skipped', output: err.message });
        continue;
      }
      await notify(step, { status: 'failed', error: err.message || String(err) });
      throw err;
    }
  }
  return current;
}
