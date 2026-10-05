/**
 * DAG Step Registry — lightweight sequential executor for the writing pipeline.
 *
 * Each step is a self-contained function that receives an immutable context
 * snapshot and returns a partial context to be merged.  The executor handles
 * persistence of step state (running/done/skipped/failed), error routing
 * (abort / skip / retry), and upstream onStep notifications.
 */

export interface PipelineContext {
  task: any;               // full pipeline_task row (always fresh)
  verifiedTopic?: string;
  plan?: any;              // Planner 输出的 ResearchPlan
  researchTrace?: any[];   // Research ReAct 轨迹
  enrichedLibHits?: any[]; // 跨库增强文献命中
  enrichedKnHits?: any[];  // 跨库增强知识库命中
  researchNotice?: string;
  documentId?: string;     // 产物文档 ID
  outline?: any;           // { title, sections }
  literatureSummary?: string;
  qualityRetryCount?: number;
  report?: { totalScore: number; feedback: string };
}

export interface PipelineStep {
  key: string;
  label: string;
  run: (ctx: PipelineContext) => Promise<Partial<PipelineContext> | void>;
  onError?: (ctx: PipelineContext, err: Error) => Promise<'abort' | 'skip' | 'retry'>;
}

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
      if (err?.cause === AWAITING_CONFIRMATION || err === AWAITING_CONFIRMATION) {
        await notify(step, { status: 'awaiting_confirmation' });
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
