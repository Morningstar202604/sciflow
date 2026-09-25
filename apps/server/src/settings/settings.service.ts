import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { DB_PATH, sqlite } from '../db/database';

export interface AppSettings {
  ai: { baseUrl: string; model: string; configured: boolean; models: string[] };
  env: { node: string; database: string; port: number };
  sources: { literature: string[] };
}

const FALLBACK_MODELS = ['agnes-3.0-flash', 'agnes-2.5-flash', 'agnes-2.5-pro', 'agnes-2.0-flash'];

@Injectable()
export class SettingsService {
  constructor(private readonly ai: AiService) {}

  async getSettings(): Promise<AppSettings> {
    let models: string[] = [];
    try {
      models = await this.ai.listModels();
    } catch {
      /* 忽略 */
    }
    if (models.length === 0) models = FALLBACK_MODELS;
    const cfg = this.ai.config;
    return {
      ai: { ...cfg, models },
      env: {
        node: process.version,
        database: DB_PATH,
        port: Number(process.env.PORT || 3000),
      },
      sources: { literature: ['OpenAlex', 'arXiv', 'Semantic Scholar'] },
    };
  }

  /** 连接自检：数据库读写 + AI 连通性 */
  async selfCheck() {
    const dbOk = (() => {
      try {
        sqlite.prepare('SELECT 1 AS ok').get();
        return true;
      } catch {
        return false;
      }
    })();
    const aiTest = await this.ai.testConnection();
    return {
      database: { ok: dbOk, path: DB_PATH },
      ai: { configured: this.ai.configured, ok: aiTest.ok, model: aiTest.model, latencyMs: aiTest.latencyMs, detail: aiTest.reply },
      timestamp: Date.now(),
    };
  }

  /** 指定模型连接测试 */
  testModel(model: string) {
    return this.ai.testConnection(model);
  }
}
