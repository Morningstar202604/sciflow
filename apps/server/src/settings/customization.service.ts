import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings, customIntents, customPrompts } from '../db/schema';

/** 高度自定义：意图库 + 提示词 用户可配置（系统默认仅作兜底） */

@Injectable()
export class CustomizationService {
  // ---------- 自定义意图 ----------

  listIntents() {
    return db.select().from(customIntents).orderBy(customIntents.createdAt).all();
  }

  createIntent(body: { key: string; label: string; route: string; keywords: string[] }) {
    if (!body.key?.trim() || !body.label?.trim()) throw new BadRequestException('意图标识与标签必填');
    const key = body.key.trim().toLowerCase();
    if (!/^[a-z_0-9]+$/.test(key)) throw new BadRequestException('意图标识只允许小写字母/数字/下划线');
    const existing = db.select().from(customIntents).where(eq(customIntents.key, key)).get();
    if (existing) throw new BadRequestException(`意图 ${key} 已存在`);
    const row = {
      id: randomUUID(),
      key,
      label: body.label.trim(),
      route: body.route || '/chat',
      keywords: JSON.stringify((body.keywords || []).map((k) => String(k).trim()).filter(Boolean)),
      enabled: 1,
      isCustom: 1,
      createdAt: Date.now(),
    };
    db.insert(customIntents).values(row).run();
    return row;
  }

  updateIntent(id: string, patch: Partial<{ label: string; route: string; keywords: string[]; enabled: number }>) {
    const row = db.select().from(customIntents).where(eq(customIntents.id, id)).get();
    if (!row) throw new NotFoundException('意图不存在');
    const next: Record<string, unknown> = {};
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.route !== undefined) next.route = patch.route;
    if (patch.keywords !== undefined) next.keywords = JSON.stringify(patch.keywords.map((k) => String(k).trim()).filter(Boolean));
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    db.update(customIntents).set(next).where(eq(customIntents.id, id)).run();
    return this.listIntents();
  }

  deleteIntent(id: string) {
    const row = db.select().from(customIntents).where(eq(customIntents.id, id)).get();
    if (!row) throw new NotFoundException('意图不存在');
    db.delete(customIntents).where(eq(customIntents.id, id)).run();
    return { ok: true };
  }

  /** 恢复全部自定义意图（清空） */
  resetIntents() {
    db.delete(customIntents).run();
    return { ok: true };
  }

  // ---------- 意图判断模式 ----------
  /** 模式：auto(默认,规则优先+LLM兜底) / rule_first / llm_first / rule_only */
  getJudgmentMode(): string {
    const row = db.select().from(appSettings).where(eq(appSettings.key, 'judgment_mode')).get();
    return row?.value ?? 'auto';
  }

  setJudgmentMode(mode: string) {
    if (!['auto', 'rule_first', 'llm_first', 'rule_only'].includes(mode)) throw new BadRequestException('非法判断模式');
    const existing = db.select().from(appSettings).where(eq(appSettings.key, 'judgment_mode')).get();
    if (existing) db.update(appSettings).set({ value: mode }).where(eq(appSettings.key, 'judgment_mode')).run();
    else db.insert(appSettings).values({ key: 'judgment_mode', value: mode }).run();
    return { mode };
  }

  // ---------- 自定义提示词 ----------

  /** 系统工具清单（可自定义提示词的科研工具） */
  listTools() {
    return [
      { key: 'summarizeLiterature', label: '文献综述' },
      { key: 'extractPaperTable', label: '结构化提取' },
      { key: 'evidenceSynthesis', label: '证据综合' },
      { key: 'deepDivePaper', label: '单篇精读' },
      { key: 'researchGap', label: '研究缺口' },
      { key: 'generateAbstract', label: '摘要关键词' },
      { key: 'designReview', label: '研究设计诊断' },
      { key: 'paperComparison', label: '文献对比' },
      { key: 'simulatedReview', label: '模拟同行评审' },
      { key: 'writeOutline', label: '大纲生成' },
      { key: 'draftSection', label: '章节起草' },
      { key: 'polish', label: '润色降重' },
      { key: 'translate', label: '学术翻译' },
    ];
  }

  listPrompts() {
    const rows = db.select().from(customPrompts).orderBy(customPrompts.updatedAt).all();
    return this.listTools().map((t) => {
      const c = rows.find((r) => r.toolKey === t.key);
      return { toolKey: t.key, toolLabel: t.label, prompt: c?.prompt ?? '', enabled: c?.enabled ?? 1, customized: !!c };
    });
  }

  upsertPrompt(toolKey: string, body: { prompt: string; enabled?: number }) {
    const tool = this.listTools().find((t) => t.key === toolKey);
    if (!tool) throw new BadRequestException(`未知工具 ${toolKey}`);
    if (!body.prompt?.trim()) throw new BadRequestException('提示词不能为空');
    const existing = db.select().from(customPrompts).where(eq(customPrompts.toolKey, toolKey)).get();
    if (existing) {
      db.update(customPrompts)
        .set({ prompt: body.prompt, enabled: body.enabled ?? 1, updatedAt: Date.now() })
        .where(eq(customPrompts.toolKey, toolKey))
        .run();
    } else {
      db.insert(customPrompts)
        .values({ id: randomUUID(), toolKey, toolLabel: tool.label, prompt: body.prompt, enabled: body.enabled ?? 1, updatedAt: Date.now() })
        .run();
    }
    return this.listPrompts();
  }

  deletePrompt(toolKey: string) {
    db.delete(customPrompts).where(eq(customPrompts.toolKey, toolKey)).run();
    return { ok: true };
  }
}
