import type { PaperHit } from '../references/references.service';

// ─── Types shared across graph nodes ─────────────────────────────

/** pipeline_task row shape (drizzle $inferSelect subset) */
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

export interface ResearchPlan {
  searchStrategy?: { keywords?: string[] };
}

export interface ResearchTraceEntry {
  step: string;
  query: string;
  count: number;
}

/**
 * LangGraph 流水线状态。
 * 各字段由对应 node 写入；reducer 为覆盖式（最后写入者胜）。
 */
export interface PipelineState {
  taskId: string;
  task: PipelineTaskRow;
  verifiedTopic: string;
  plan: ResearchPlan;
  researchTrace: ResearchTraceEntry[];
  enrichedLibHits: PaperHit[];
  enrichedKnHits: PaperHit[];
  researchNotice?: string;
  literatureSummary: string;
  outline?: Outline;
  documentId?: string;
  report?: QualityReport;
}

export const PIPELINE_STEP_LABELS: Record<string, string> = {
  'topic-verify': '主题验证',
  literature: '文献调研',
  outline: '大纲生成',
  drafting: '分章起草',
  'quality-gate': '质量门评分',
  polish: '润色定稿',
  'citation-format': '引用格式化',
  complete: '完成',
};

export type { PaperHit };
