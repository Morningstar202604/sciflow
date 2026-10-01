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

/** 模型列表 TTL 缓存：避免每次进设置页都实时请求网关（5 分钟内复用） */
const MODELS_TTL_MS = 5 * 60 * 1000;

/**
 * API Key 掩码：列表/详情接口回显时绝不返回明文。
 *  - sk- 开头的 key：保留 "sk-" 前缀 + "****" + 尾4，如 sk-abcd…wxyz → sk-****wxyz
 *  - 其他 key：等长星号掩码，仅保留尾4（等长便于前端判断"已配置"且不泄露长度语义之外的内容）
 *  - 空值原样返回空串
 */
export function maskApiKey(key: unknown): string {
  const k = String(key ?? '');
  if (!k) return '';
  const tail = k.slice(-4);
  if (k.startsWith('sk-')) return `sk-****${tail}`;
  return '*'.repeat(Math.max(k.length - 4, 0)) + tail;
}

/** 判断提交上来的 apiKey 是否为列表接口下发的掩码回显（含 * 即视为掩码，真实 LLM key 不含星号） */
function isMaskedKey(key: string): boolean {
  return key.includes('*');
}

@Injectable()
export class SettingsService {
  private modelsCache: { at: number; models: string[] } | null = null;

  constructor(private readonly ai: AiService) {}

  async getSettings(): Promise<AppSettings> {
    let models: string[] = [];
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) {
      models = this.modelsCache.models;
    } else {
      try {
        models = await this.ai.listModels();
        this.modelsCache = { at: Date.now(), models };
      } catch {
        /* 忽略 */
      }
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
      sources: { literature: ['本地文献库（手动添加 / 项目导入）'] },
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
  /**
   * 列表接口：api_key 在 DB 中为明文，但回传给前端时必须掩码（sk-****尾4）。
   * 前端设置页仅用于展示厂商名/模型/BaseURL，无需明文 key；
   * 若用户要改 key，在输入框重新输入明文即可（留空/掩码回显=不修改原 key）。
   */
  listProviders() {
    const rows = sqlite
      .prepare(
        'SELECT id, name, base_url AS baseUrl, api_key AS apiKey, model, is_active AS isActive, created_at AS createdAt FROM model_provider ORDER BY created_at',
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, apiKey: maskApiKey(r.apiKey) }));
  }

  saveProvider(body: { id?: string; name: string; baseUrl: string; apiKey?: string; model: string }) {
    if (!body?.name?.trim() || !body?.baseUrl?.trim() || !body?.model?.trim()) {
      throw new BadRequestException('厂商名称、Base URL、模型名不能为空');
    }
    const now = Date.now();
    if (body.id) {
      // 更新：若提交的 apiKey 为空或是掩码回显（含 *），保留 DB 原明文 key 不覆盖；
      // 只有用户输入了新的明文 key 才写回。防止掩码字符串被误存为真实 key。
      const existing = sqlite
        .prepare('SELECT api_key FROM model_provider WHERE id = ?')
        .get(body.id) as { api_key?: string } | undefined;
      const submitted = body.apiKey?.trim() ?? '';
      const finalKey = submitted && !isMaskedKey(submitted) ? submitted : existing?.api_key ?? '';
      sqlite
        .prepare('UPDATE model_provider SET name=?, base_url=?, api_key=?, model=?, updated_at=? WHERE id=?')
        .run(body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), finalKey, body.model.trim(), now, body.id);
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
