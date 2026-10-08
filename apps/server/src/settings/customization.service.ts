import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings, customIntents, customPrompts, pipelineConfigs } from '../db/schema';

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

  // ---------- 流水线步骤自定义 ----------
  /** 8 步流水线（topic-verify/complete 为骨架不可禁用） */
  listPipelineSteps() {
    const STEPS = [
      { key: 'topic-verify', label: '主题验证', core: true },
      { key: 'literature', label: '文献调研', core: false },
      { key: 'outline', label: '大纲生成', core: false },
      { key: 'drafting', label: '分章起草', core: false },
      { key: 'quality-gate', label: '质量门评分', core: false },
      { key: 'polish', label: '润色定稿', core: false },
      { key: 'citation-format', label: '引用格式化', core: false },
      { key: 'complete', label: '完成', core: true },
    ];
    const rows = db.select().from(pipelineConfigs).all();
    return STEPS.map((st) => {
      const r = rows.find((x) => x.stepKey === st.key);
      return { key: st.key, label: st.label, core: st.core, enabled: r ? (r.enabled ?? 1) : 1, customized: !!r };
    });
  }

  updatePipelineStep(stepKey: string, enabled: number) {
    const step = this.listPipelineSteps().find((s) => s.key === stepKey);
    if (!step) throw new BadRequestException('未知步骤');
    if (step.core && !enabled) throw new BadRequestException('骨架步骤不可禁用');
    const existing = db.select().from(pipelineConfigs).where(eq(pipelineConfigs.stepKey, stepKey)).get();
    if (existing) db.update(pipelineConfigs).set({ enabled }).where(eq(pipelineConfigs.stepKey, stepKey)).run();
    else db.insert(pipelineConfigs).values({ stepKey, enabled, stepOrder: 0 }).run();
    return this.listPipelineSteps();
  }

  resetPipelineSteps() {
    db.delete(pipelineConfigs).run();
    return { ok: true };
  }

  // ---------- 质量评分权重 ----------
  listQualityWeights() {
    const DIMS = [
      { key: 'literature', label: '文献' },
      { key: 'logic', label: '逻辑' },
      { key: 'citation', label: '引用' },
      { key: 'language', label: '语言' },
      { key: 'novelty', label: '新颖' },
      { key: 'figures', label: '图表' },
      { key: 'format', label: '格式' },
    ];
    const row = db.select().from(appSettings).where(eq(appSettings.key, 'quality_weights')).get();
    let weights: Record<string, number> = {};
    try { weights = JSON.parse(row?.value || '{}'); } catch { /* 忽略 */ }
    return DIMS.map((d) => ({ key: d.key, label: d.label, weight: weights[d.key] ?? 1 }));
  }

  setQualityWeights(weights: Record<string, number>) {
    const valid = ['literature', 'logic', 'citation', 'language', 'novelty', 'figures', 'format'];
    for (const k of Object.keys(weights)) {
      if (!valid.includes(k)) throw new BadRequestException(`未知维度 ${k}`);
      const w = Number(weights[k]);
      if (!Number.isFinite(w) || w <= 0 || w > 5) throw new BadRequestException(`${k} 权重需在 (0,5]`);
    }
    const existing = db.select().from(appSettings).where(eq(appSettings.key, 'quality_weights')).get();
    if (existing) db.update(appSettings).set({ value: JSON.stringify(weights) }).where(eq(appSettings.key, 'quality_weights')).run();
    else db.insert(appSettings).values({ key: 'quality_weights', value: JSON.stringify(weights) }).run();
    return this.listQualityWeights();
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
