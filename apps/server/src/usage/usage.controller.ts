import { Controller, Get } from '@nestjs/common';
import { sqlite } from '../db/database';

interface Row {
  caller: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  avg_latency_ms: number;
  success_rate: number;
}

@Controller('usage')
export class UsageController {
  /** LLM 调用成本汇总：总量 + 按调用方分组 + 按天分布（成本追踪仪表盘数据源） */
  @Get('summary')
  summary() {
    let total: Row | undefined;
    let byCaller: Row[] = [];
    let byDay: { day: string; calls: number; total_tokens: number }[] = [];
    try {
      total = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             CAST(AVG(latency_ms) AS INT) AS avg_latency_ms,
             ROUND(100.0 * SUM(success) / COUNT(*), 1) AS success_rate
           FROM llm_call_log`,
        )
        .get() as Row;
      byCaller = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             CAST(AVG(latency_ms) AS INT) AS avg_latency_ms,
             ROUND(100.0 * SUM(success) / COUNT(*), 1) AS success_rate
           FROM llm_call_log GROUP BY caller ORDER BY total_tokens DESC`,
        )
        .all() as Row[];
      byDay = sqlite
        .prepare(
          `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM llm_call_log GROUP BY day ORDER BY day DESC LIMIT 14`,
        )
        .all() as { day: string; calls: number; total_tokens: number }[];
    } catch {
      /* 表不存在（首次部署无调用）时返回零值 */
    }
    return {
      total: total || { caller: 'all', calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, avg_latency_ms: 0, success_rate: 100 },
      byCaller,
      byDay,
    };
  }
}
