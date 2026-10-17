import { Injectable, Logger } from '@nestjs/common';
import { sqlite } from '../db/database';

interface UsageRow {
  caller: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  avg_latency_ms: number;
  success_rate: number;
}

interface UsageSummary {
  total: UsageRow;
  byCaller: UsageRow[];
  byDay: { day: string; calls: number; total_tokens: number }[];
  byModel: { model: string; calls: number; total_tokens: number }[];
  budgetTokens: number;
}

/** LLM 用量分析：汇总 + 按调用方分组 + 按天分布（成本追踪仪表盘数据源） */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  summary(): UsageSummary {
    try {
      const total = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             CAST(AVG(latency_ms) AS INT) AS avg_latency_ms,
             ROUND(100.0 * SUM(success) / COUNT(*), 1) AS success_rate
           FROM llm_call_log`,
        )
        .get() as UsageRow;
      const byCaller = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             CAST(AVG(latency_ms) AS INT) AS avg_latency_ms,
             ROUND(100.0 * SUM(success) / COUNT(*), 1) AS success_rate
           FROM llm_call_log GROUP BY caller ORDER BY total_tokens DESC`,
        )
        .all() as UsageRow[];
      const byDay = sqlite
        .prepare(
          `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM llm_call_log GROUP BY day ORDER BY day DESC LIMIT 14`,
        )
        .all() as { day: string; calls: number; total_tokens: number }[];
      const byModel = sqlite
        .prepare(
          `SELECT model, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM llm_call_log GROUP BY model ORDER BY total_tokens DESC LIMIT 6`,
        )
        .all() as { model: string; calls: number; total_tokens: number }[];
      // B-2.2 预算上限透出（app_setting pipeline_token_budget，0=不限）
      const budgetRow = sqlite.prepare(`SELECT value FROM app_setting WHERE key='pipeline_token_budget'`).get() as { value?: string } | undefined;
      const budgetTokens = budgetRow ? Number(budgetRow.value) || 0 : 300_000;
      return {
        byModel,
        budgetTokens,
        total: total || { caller: 'all', calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, avg_latency_ms: 0, success_rate: 100 },
        byCaller,
        byDay,
      };
    } catch {
      // 表不存在（首次部署无调用）时返回零值
      this.logger.debug('llm_call_log 表不存在或查询失败，返回零值');
      return {
        total: { caller: 'all', calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, avg_latency_ms: 0, success_rate: 100 },
        byCaller: [],
        byDay: [],
        byModel: [],
        budgetTokens: 300_000,
      };
    }
  }
}
