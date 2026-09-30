export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface Doc {
  id: string;
  projectId: string;
  title: string;
  content: string;
  outline: string;
  version: number;
  versions: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutlineSection {
  title: string;
  subsections: string[];
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface Reference {
  id: string;
  projectId: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: string;
  tags: string;
  citationCount: number;
  createdAt: number;
  /** 科研高级功能扩展字段（后端返回） */
  readingStatus?: 'unread' | 'reading' | 'read' | 'cited';
  fingerprint?: string;
  isDuplicateOf?: string;
}

/** 文献录入入参（authors 兼容数组与 JSON 字符串两种形态） */
export type ReferenceInput = {
  title: string;
  authors?: string[] | string;
  year?: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  source?: string;
  citationCount?: number;
};

export interface CitationRow {
  id: string;
  documentId: string;
  referenceId: string;
  location: string;
  context: string;
  format: string;
  verified: number;
  createdAt: number;
  reference: Reference;
}

export interface QualityReport {
  id: string;
  documentId: string;
  totalScore: number;
  scores: string;
  feedback: string;
  createdAt: number;
}

export interface PipelineStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'retry' | 'failed';
  output?: string;
  retryCount: number;
}

export interface AgentRun {
  id: string;
  taskId: string;
  agentType: string; // planner | research | writer | reviewer | polisher
  agentName: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  input: string;
  output: string;
  detail: Record<string, any> | null;
  error: string;
  durationMs: number;
  createdAt: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: number;
  createdAt: number;
}

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  enabled: number;
  createdAt: number;
}

export interface ReactTraceStep {
  round: number;
  thought: string;
  action: string;
  query: string;
  found: number;
}

export interface PipelineTask {
  id: string;
  projectId: string;
  documentId: string | null;
  topic: string;
  currentStep: string;
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'failed';
  steps: PipelineStep[];
  retryCount: number;
  trace: string; // JSON: ReactTraceStep[]
  lastError: string;
  createdAt: number;
  updatedAt: number;
}

export interface PolishRecord {
  id: string;
  documentId: string;
  type: string;
  original: string;
  polished: string;
  reason: string;
  createdAt: number;
}

/** 知识库文档绑定的文献摘要（文献库↔知识库打通 #5，list/bind 响应内嵌） */
export interface KnowledgeRefSummary {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
}

export interface KnowledgeDoc {
  id: string;
  projectId: string;
  name: string;
  type: string;
  chunkCount: number;
  /** 可空外键：绑定的文献 id（#5） */
  referenceId: string | null;
  /** 绑定文献的摘要，未绑定时为 null */
  reference: KnowledgeRefSummary | null;
  createdAt: number;
}

export interface KnowledgeSource {
  docName: string;
  snippet: string;
  score: number;
  /** RAG 引用可点（#17）：块 id + 完整块文本，前端"展开原文" */
  chunkId: string;
  chunkText: string;
  /** 命中块绑定的文献（#5） */
  referenceId: string | null;
  referenceTitle: string | null;
}

export interface KnowledgeQueryResult {
  answer: string;
  sources: KnowledgeSource[];
}

export interface ExtractedPaper {
  ref: string;
  title: string;
  year: number;
  method: string;
  results: string;
  contribution: string;
  limitations: string;
}

export interface EvidenceStance {
  claim: string;
  stance: string;
  count: number;
  refs: string[];
  note: string;
}

export interface CustomIntent {
  id: string;
  key: string;
  label: string;
  route: string;
  keywords: string;
  enabled: number;
  isCustom: number;
  createdAt: number;
}

export interface CustomPromptTool {
  toolKey: string;
  toolLabel: string;
  prompt: string;
  enabled: number;
  customized: boolean;
}

export interface PipelineStepConfig {
  key: string;
  label: string;
  core: boolean;
  enabled: number;
  customized: boolean;
}

export interface QualityWeightItem {
  key: string;
  label: string;
  weight: number;
}

export interface IntentResult {
  intent: string;
  label: string;
  confidence: number;
  topic: string;
  route: string;
  matchedBy: 'rule' | 'llm';
}

export interface ResearchDesignResult {
  noveltyScore: number;
  noveltyFeedback: string;
  feasibilityScore: number;
  feasibilityFeedback: string;
  methods: string[];
  risks: string[];
  nextSteps: string[];
  paperCount: number;
}

export interface PaperComparisonResult {
  summary: string;
  rows: { paper: string; 研究问题: string; 方法: string; 主要结论: string; 局限: string }[];
}

export interface SimulatedReviewResult {
  reviewers: { role: string; score: number; strengths: string[]; concerns: string[]; suggestion: string }[];
  verdict: string;
  overall: string;
}

export interface DeepDiveResult {
  title: string;
  oneLine: string;
  researchQuestion: string;
  motivation: string;
  method: string;
  keyFindings: string[];
  limitations: string[];
  futureWork: string;
  takeaway: string;
}

export interface GapResult {
  gaps: { gap: string; evidence: string; opportunity: string; feasibility: string }[];
  recommendedTopic: string;
}

export interface EvidenceResult {
  summary: string;
  stances: EvidenceStance[];
}

export interface AppSettings {
  ai: { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[] };
  env: { node: string; database: string; port: number };
  sources: { literature: string[] };
}

export interface SelfCheck {
  database: { ok: boolean; path: string };
  ai: { configured: boolean; ok: boolean; model: string; latencyMs: number; detail: string };
  timestamp: number;
}

export interface MemoryItem {
  id: string;
  type: 'episodic' | 'procedural';
  projectId: string | null;
  content: string;
  keywords: string[];
  createdAt: number;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/* =====================================================================
 * 科研高级功能契约类型（系统综述 / 审稿闭环 / 期刊库）
 * 与后端 B1 实现的 API 一一对应，前端页面按此消费
 * ===================================================================== */

/** 系统综述·筛选队列条目（join reference 元数据） */
export interface ScreeningItem {
  id: string;
  projectId: string;
  referenceId: string;
  status: 'pending' | 'included' | 'excluded' | 'uncertain';
  reason: string;
  reviewer: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  year: number | null;
  venue: string;
  authors: string;
}

/** 系统综述·文献编码抽取字段 */
export interface ExtractionField {
  id: string;
  projectId: string;
  key: string;
  label: string;
  kind: 'text' | 'select';
  options: string[];
  createdAt: number;
}

/** 系统综述·抽取表（跨文献编码矩阵） */
export interface ExtractionTableResult {
  fields: ExtractionField[];
  rows: { referenceId: string; title: string; year: number | null; venue: string; values: Record<string, string> }[];
}

/** 审稿意见闭环 */
export interface ReviewComment {
  id: string;
  documentId: string;
  reviewer: string;
  commentText: string;
  category: string;
  status: 'open' | 'resolved' | 'deferred';
  responseText: string;
  sectionRef: string;
  createdAt: number;
  updatedAt: number;
}

/** 自建期刊库 */
export interface Journal {
  id: string;
  name: string;
  issn: string;
  publisher: string;
  scopeText: string;
  if2024: number | null;
  quartile: string;
  firstDecisionWeeks: number | null;
  acceptanceRate: number | null;
  oa: string;
  createdAt: number;
}

/** 期刊匹配推荐结果（结构化） */
export interface JournalMatchItem {
  name: string;
  score: number;
  reason: string;
  gap: string;
  isInLibrary: boolean;
  if2024: number | null;
  quartile: string;
  firstDecisionWeeks: number | null;
  acceptanceRate: number | null;
  oa: string;
}

export interface JournalMatchResult {
  journals: JournalMatchItem[];
}

/** 轻量实验沙箱：本机 python3 执行记录 */
export interface Experiment {
  id: string;
  projectId: string;
  documentId: string | null;
  goal: string;
  code: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** matplotlib 产出的 png（base64 data URL） */
  figures: string[];
  conclusion: string;
  runtimeMs: number;
  status: 'ok' | 'error' | 'timeout';
  createdAt: number;
  updatedAt: number;
}

/* =====================================================================
 * 投稿流程状态跟踪（13 状态码 + 事件流 + 周期推断）
 * ===================================================================== */

/** 13 个统一状态码（后端 SUBMISSION_STATUSES） */
export type SubmissionStatus =
  | 'submitted'
  | 'initial_review'
  | 'external_review'
  | 'review_returned'
  | 'minor_revision'
  | 'major_revision'
  | 're_review'
  | 'final_review'
  | 'accepted'
  | 'in_production'
  | 'rejected'
  | 'withdrawn'
  | 'transferred';

/** 投稿状态历史事件（append-only 流水） */
export interface SubmissionStatusEvent {
  id: string;
  submissionId: string;
  fromStatus: string;
  toStatus: string;
  eventAt: number;
  source: string; // manual | email_ai | system
  rawEmailText: string;
  confidence: number;
  note: string;
  createdAt: number;
}

/** 一条投稿记录（含全部事件 + L3 推断字段） */
export interface SubmissionTrack {
  id: string;
  projectId: string;
  documentId: string;
  journalId: string;
  journalName: string;
  manuscriptNo: string;
  title: string;
  submittedAt: number | null;
  currentStatus: SubmissionStatus;
  statusUpdatedAt: number | null;
  revisionDeadline: number | null;
  previousSubmissionId: string;
  source: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  events: SubmissionStatusEvent[];
  /** L3 周期推断（journal.firstDecisionWeeks 存在时才有值） */
  dueAt: number | null;
  overdue: boolean;
  overdueDays: number;
  estimatedStage: SubmissionStatus | null;
}

/** AI 解析编辑部邮件的建议（不改库，用户确认后走 event 端点） */
export interface ParseEmailResult {
  suggestedStatus: SubmissionStatus;
  confidence: number;
  reason: string;
  date?: string;
}

/* =====================================================================
 * 引用网络图 + BibTeX/RIS 导入导出
 * ===================================================================== */

/** 引用网络节点（后端聚合，供前端力导向布局） */
export interface GraphNode {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
  tags: string[];
  readingStatus?: string;
  isDuplicateOf?: string;
}

/** 引用网络边：a/b 为节点 id，weight=共引文档数（dup 边固定高亮） */
export interface GraphEdge {
  a: string;
  b: string;
  weight: number;
  type?: 'co-cite' | 'dup';
}

export interface ReferenceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** BibTeX 导入结果 */
export interface BibtexImportResult {
  imported: number;
  skipped: number;
  total: number;
}
