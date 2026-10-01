import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/** 项目 */
export const projects = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  status: text('status').default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** 项目级系统提示（projectPreface）：写作/规划时注入 system prompt 开头（差距 #22） */
  preface: text('preface').default(''),
});

/** 文档（论文草稿，多版本历史以 JSON 保存在 versions） */
export const documents = sqliteTable('document', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  content: text('content').default(''),
  outline: text('outline').default('[]'), // JSON: [{id,title,children:[...]}]
  version: integer('version').default(1),
  versions: text('versions').default('[]'), // JSON: [{version,content,updatedAt}]
  status: text('status').default('draft'), // draft | reviewing | polished | final
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 文献库 */
export const references = sqliteTable('reference', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  authors: text('authors').default('[]'), // JSON: string[]
  year: integer('year'),
  venue: text('venue').default(''),
  doi: text('doi').default(''),
  url: text('url').default(''),
  abstract: text('abstract').default(''),
  source: text('source').default('manual'), // manual（本地文献库，已移除国外在线源）
  tags: text('tags').default('[]'), // JSON: string[]
  citationCount: integer('citation_count').default(0),
  // 科研高级功能：阅读状态 / 去重指纹 / 重复指向
  readingStatus: text('reading_status').default('unread'), // unread | reading | read | cited
  fingerprint: text('fingerprint').default(''), // 标题归一化后哈希（项目内去重依据）
  isDuplicateOf: text('is_duplicate_of').default(''), // 重复时指向已存在文献 id
  notes: text('notes').default(''), // 文献笔记（路线图差距 #11）
  createdAt: integer('created_at').notNull(),
});

/** 引用关系（文档 -> 文献） */
export const citations = sqliteTable('citation', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  referenceId: text('reference_id').notNull(),
  location: text('location').default(''), // 章节/段落位置
  context: text('context').default(''), // 引用上下文句
  format: text('format').default('apa'), // apa | ieee | vancouver
  verified: integer('verified').default(0), // DOI 核验 0/1
  createdAt: integer('created_at').notNull(),
});

/** 质量评分报告（7 维，0-100） */
export const qualityReports = sqliteTable('quality_report', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  totalScore: integer('total_score').notNull(),
  scores: text('scores').notNull(), // JSON: {literature,logic,citation,language,novelty,figures,format}
  feedback: text('feedback').default(''), // 改进建议
  createdAt: integer('created_at').notNull(),
});

/** 流水线任务（8 步状态机） */
export const pipelineTasks = sqliteTable('pipeline_task', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id'), // 产物文档（大纲确认后创建）
  topic: text('topic').notNull(),
  currentStep: text('current_step').default(''),
  status: text('status').default('running'), // running | awaiting_confirmation | completed | failed
  steps: text('steps').default('[]'), // JSON: [{key,label,status,output,retryCount}]
  retryCount: integer('retry_count').default(0),
  trace: text('trace').default('[]'), // JSON: ReAct 轨迹 [{round,thought,action,observation}]
  lastError: text('last_error').default(''),
  // 流水线 Research 阶段跨库检索增强：
  // researchNotice —— 跨库（文献库+知识库）命中 0 时的结构化引导文案，命中>0 时为 null（前端可读）
  researchNotice: text('research_notice'),
  // researchMeta —— 命中>0 时持久化的跨库命中摘要 JSON：{ lib:[{title,score}], kn:PaperHit[] }，供产物参考文献块回标来源/匹配度
  researchMeta: text('research_meta').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 润色/改写记录（原文 + 润色文 + 理由） */
export const polishRecords = sqliteTable('polish_record', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  type: text('type').notNull(), // polish | translate | reduce
  original: text('original').notNull(),
  polished: text('polished').notNull(),
  reason: text('reason').default(''),
  createdAt: integer('created_at').notNull(),
});

/** 知识库文档（NotebookLM 式 RAG：上传的资料原文） */
export const knowledgeDocs = sqliteTable('knowledge_doc', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  type: text('type').default('text'), // text | pdf | markdown
  chunkCount: integer('chunk_count').default(0),
  // 文献库↔知识库打通（#5）：可空外键，指向同项目 reference.id；不强绑，可手动绑定/解除
  referenceId: text('reference_id'),
  createdAt: integer('created_at').notNull(),
});

/** 知识库分块（检索单元；context=Contextual Retrieval 文档上下文前缀，vector=TF 向量 JSON） */
export const knowledgeChunks = sqliteTable('knowledge_chunk', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  content: text('content').notNull(),
  seq: integer('seq').default(0),
  context: text('context').default(''), // 文档级上下文描述（检索时拼在块前，+35-50% 精度）
  vector: text('vector').default('[]'), // JSON: 归一化 TF 向量 {term: weight}
});

export type Project = typeof projects.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type QualityReport = typeof qualityReports.$inferSelect;
export type PipelineTask = typeof pipelineTasks.$inferSelect;
export type PolishRecord = typeof polishRecords.$inferSelect;
export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
/** Reflexion 反思日志（质量门回炉的语义梯度，注入下一轮起草） */
export const reflexionLogs = sqliteTable('reflexion_log', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  round: integer('round').default(1),
  note: text('note').notNull(),
  instructions: text('instructions').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

/** 记忆库（Phase 2：情景记忆 episodic / 程序记忆 procedural） */
export const memoryLogs = sqliteTable('memory_log', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // episodic | procedural
  projectId: text('project_id'),
  content: text('content').notNull(),
  keywords: text('keywords').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type ReflexionLog = typeof reflexionLogs.$inferSelect;
export type MemoryLog = typeof memoryLogs.$inferSelect;

/** Phase 3：子 Agent 执行单元（Supervisor 编排的独立任务记录） */
export const agentRuns = sqliteTable('agent_run', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(), // 所属流水线任务
  agentType: text('agent_type').notNull(), // planner | research | writer | reviewer | polisher
  agentName: text('agent_name').notNull(), // 实例名（如 research#1、writer#intro）
  status: text('status').default('running'), // pending | running | done | failed
  input: text('input').default(''), // 输入（摘要）
  output: text('output').default(''), // 输出摘要
  detail: text('detail').default(''), // JSON：完整输入/输出/思考
  error: text('error').default(''),
  durationMs: integer('duration_ms').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type AgentRun = typeof agentRuns.$inferSelect;

/** 模型厂商（可插拔多模型：OpenAI/DeepSeek/通义/豆包/Agnes 等，LiteLLM 式） */
export const modelProviders = sqliteTable('model_provider', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').default(''),
  model: text('model').notNull(),
  isActive: integer('is_active').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type ModelProvider = typeof modelProviders.$inferSelect;

/** 外部 MCP 服务器（工具生态互通：可接入任意 MCP 兼容服务） */
export const mcpServers = sqliteTable('mcp_server', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  enabled: integer('enabled').default(1),
  createdAt: integer('created_at').notNull(),
});

export type McpServer = typeof mcpServers.$inferSelect;

/** LLM 调用日志（token 成本追踪：每一次补全/流式调用的用量审计） */
export const customIntents = sqliteTable('custom_intent', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  route: text('route').notNull(),
  keywords: text('keywords').notNull(),
  enabled: integer('enabled').default(1),
  isCustom: integer('is_custom').default(1),
  createdAt: integer('created_at').notNull(),
});

export const pipelineConfigs = sqliteTable('pipeline_config', {
  stepKey: text('step_key').primaryKey(),
  enabled: integer('enabled').default(1),
  stepOrder: integer('step_order').default(0),
});

export const appSettings = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const customPrompts = sqliteTable('custom_prompt', {
  id: text('id').primaryKey(),
  toolKey: text('tool_key').notNull().unique(),
  toolLabel: text('tool_label').notNull(),
  prompt: text('prompt').notNull(),
  enabled: integer('enabled').default(1),
  updatedAt: integer('updated_at').notNull(),
});

export const llmCallLogs = sqliteTable('llm_call_log', {
  id: text('id').primaryKey(),
  caller: text('caller').default('general'), // 调用方标识（pipeline/chat/orchestrator 等）
  model: text('model').default(''),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  latencyMs: integer('latency_ms').default(0),
  success: integer('success').default(1),
  error: text('error').default(''),
  createdAt: integer('created_at').notNull(),
});

export type LlmCallLog = typeof llmCallLogs.$inferSelect;

/** 系统综述·筛选队列（题录筛选：纳入/排除/待定） */
export const screeningQueue = sqliteTable('screening_queue', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  referenceId: text('reference_id').notNull(),
  status: text('status').default('pending'), // pending | included | excluded | uncertain
  reason: text('reason').default(''),
  reviewer: text('reviewer').default('me'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 系统综述·文献编码抽取字段（一列一个编码维度） */
export const extractionFields = sqliteTable('extraction_field', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  key: text('key').notNull(), // 小写字母数字下划线，项目内唯一
  label: text('label').notNull(),
  kind: text('kind').default('text'), // text | select
  options: text('options').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

/** 系统综述·抽取值（field × reference 交叉单元格） */
export const extractionValues = sqliteTable('extraction_value', {
  id: text('id').primaryKey(),
  fieldId: text('field_id').notNull(),
  referenceId: text('reference_id').notNull(),
  value: text('value').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 审稿意见闭环（按文档逐条记录） */
export const reviewComments = sqliteTable('review_comment', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  reviewer: text('reviewer').notNull(),
  commentText: text('comment_text').notNull(),
  category: text('category').default(''),
  status: text('status').default('open'), // open | resolved | deferred
  responseText: text('response_text').default(''),
  sectionRef: text('section_ref').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 自建期刊库（全局共享，不随项目级联删除） */
export const journals = sqliteTable('journal', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  issn: text('issn').default(''),
  publisher: text('publisher').default(''),
  scopeText: text('scope_text').default(''),
  if2024: real('if2024'), // REAL NULL（不确定指标一律 NULL，禁止编造）
  quartile: text('quartile').default(''),
  firstDecisionWeeks: integer('first_decision_weeks'),
  acceptanceRate: real('acceptance_rate'), // REAL NULL
  oa: text('oa').default(''),
  createdAt: integer('created_at').notNull(),
});

export type ScreeningQueue = typeof screeningQueue.$inferSelect;
export type ExtractionField = typeof extractionFields.$inferSelect;
export type ExtractionValue = typeof extractionValues.$inferSelect;
export type ReviewCommentRow = typeof reviewComments.$inferSelect;
export type Journal = typeof journals.$inferSelect;

/** 投稿流程状态机：13 个统一状态码（见投稿跟踪调研 §2.2） */
export const SUBMISSION_STATUSES = [
  'submitted',       // 收稿/已投稿
  'initial_review',  // 初审中
  'external_review', // 外审中
  'review_returned', // 外审意见已回
  'minor_revision',  // 小修
  'major_revision',  // 大修
  're_review',       // 复审中
  'final_review',    // 终审中
  'accepted',        // 已录用
  'in_production',   // 编辑加工/待见刊
  'rejected',        // 退稿（终态）
  'withdrawn',       // 主动撤稿（终态）
  'transferred',     // 转投他刊
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 投稿记录（一条 = 一次投向某刊） */
export const submissions = sqliteTable('submission', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id').default(''), // 可选：关联 sciflow 里的论文文档
  journalId: text('journal_id').default(''), // 可选：关联 journal 表（拿 firstDecisionWeeks）
  journalName: text('journal_name').notNull(), // 冗余存名，未入期刊库也能记
  manuscriptNo: text('manuscript_no').default(''), // 稿号（编辑部给的编号）
  title: text('title').default(''), // 稿件标题（冗余，便于列表显示）
  submittedAt: integer('submitted_at'), // 投稿日期（核心，驱动超期推断）
  currentStatus: text('current_status').default('submitted'), // 当前状态码
  statusUpdatedAt: integer('status_updated_at'), // 当前状态最近变更时间
  revisionDeadline: integer('revision_deadline'), // 修回/缴费截止（来自邮件）
  previousSubmissionId: text('previous_submission_id').default(''), // 转投他刊时指回旧记录
  source: text('source').default('manual'), // manual | email_ai
  notes: text('notes').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 投稿状态历史流水（append-only；submissions.currentStatus 为最新 event 的冗余缓存） */
export const submissionStatusEvents = sqliteTable('submission_status_event', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull(),
  fromStatus: text('from_status').default(''), // 变更前状态
  toStatus: text('to_status').notNull(), // 变更后状态
  eventAt: integer('event_at').notNull(), // 该状态实际发生日期（可早于录入时间）
  source: text('source').default('manual'), // manual | email_ai | system
  rawEmailText: text('raw_email_text').default(''), // 若来自邮件，存原文片段（可追溯/可重解析）
  confidence: real('confidence').default(1), // 邮件解析置信度；手动=1
  note: text('note').default(''),
  createdAt: integer('created_at').notNull(), // 录入时间
});

export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmissionStatusEventRow = typeof submissionStatusEvents.$inferSelect;

/** 轻量实验沙箱：本机 python3 执行记录（单用户本地威胁模型，临时目录+超时+进程组强杀） */
export const experiments = sqliteTable('experiment', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id'), // 可空：关联到具体论文草稿
  goal: text('goal').default(''), // 实验目的/假设
  code: text('code').notNull(), // 用户提交的 python 源码
  stdout: text('stdout').default(''), // 截断后标准输出（≤64KB）
  stderr: text('stderr').default(''), // 截断后标准错误（≤64KB）
  stdoutTruncated: integer('stdout_truncated').default(0),
  stderrTruncated: integer('stderr_truncated').default(0),
  figures: text('figures').default('[]'), // JSON: string[] matplotlib 产出的 png（base64 data URL）
  conclusion: text('conclusion').default(''), // 实验结论（人工回填）
  runtimeMs: integer('runtime_ms').default(0),
  status: text('status').default('ok'), // ok | error | timeout
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Experiment = typeof experiments.$inferSelect;
