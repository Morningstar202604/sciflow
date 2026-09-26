import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiService } from '../ai/ai.service';
import { DB_PATH, sqlite } from '../db/database';

export interface AppSettings {
  ai: { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[] };
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

  // ---------- 模型厂商管理（LiteLLM 式多厂商） ----------
  listProviders() {
    return sqlite.prepare('SELECT id, name, base_url AS baseUrl, api_key AS apiKey, model, is_active AS isActive, created_at AS createdAt FROM model_provider ORDER BY created_at').all();
  }

  saveProvider(body: { id?: string; name: string; baseUrl: string; apiKey?: string; model: string }) {
    if (!body?.name?.trim() || !body?.baseUrl?.trim() || !body?.model?.trim()) {
      throw new BadRequestException('厂商名称、Base URL、模型名不能为空');
    }
    const now = Date.now();
    if (body.id) {
      sqlite
        .prepare('UPDATE model_provider SET name=?, base_url=?, api_key=?, model=?, updated_at=? WHERE id=?')
        .run(body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), body.apiKey?.trim() || '', body.model.trim(), now, body.id);
      return { ok: true, id: body.id };
    }
    const id = randomUUID();
    sqlite
      .prepare('INSERT INTO model_provider (id, name, base_url, api_key, model, is_active, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)')
      .run(id, body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), body.apiKey?.trim() || '', body.model.trim(), now, now);
    return { ok: true, id };
  }

  removeProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as { is_active?: number } | undefined;
    if (!row) throw new NotFoundException('厂商不存在');
    sqlite.prepare('DELETE FROM model_provider WHERE id = ?').run(id);
    // 删除的是激活中的厂商 → AI 服务回退到环境变量配置，避免内存残留失效厂商
    if (row.is_active === 1) this.ai.resetToEnv();
    return { ok: true };
  }

  /** 切换激活厂商（立即影响所有 AI 调用） */
  activateProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('厂商不存在');
    this.ai.switchProvider(id);
    return { ok: true, active: id };
  }

  // ---------- 外部 MCP 服务器 ----------
  listMcpServers() {
    return sqlite.prepare('SELECT id, name, url, enabled, created_at AS createdAt FROM mcp_server ORDER BY created_at').all();
  }

  saveMcpServer(body: { id?: string; name: string; url: string; enabled?: number }) {
    if (!body?.name?.trim() || !body?.url?.trim()) throw new BadRequestException('名称与 URL 不能为空');
    if (!/^https?:\/\//.test(body.url.trim())) throw new BadRequestException('URL 需以 http(s):// 开头');
    if (body.id) {
      sqlite.prepare('UPDATE mcp_server SET name=?, url=?, enabled=? WHERE id=?').run(body.name.trim(), body.url.trim().replace(/\/$/, ''), body.enabled === 0 ? 0 : 1, body.id);
      return { ok: true, id: body.id };
    }
    const id = randomUUID();
    sqlite.prepare('INSERT INTO mcp_server (id, name, url, enabled, created_at) VALUES (?,?,?,?,?)').run(id, body.name.trim(), body.url.trim().replace(/\/$/, ''), body.enabled === 0 ? 0 : 1, Date.now());
    return { ok: true, id };
  }

  removeMcpServer(id: string) {
    const row = sqlite.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('MCP 服务器不存在');
    sqlite.prepare('DELETE FROM mcp_server WHERE id = ?').run(id);
    return { ok: true };
  }
}
