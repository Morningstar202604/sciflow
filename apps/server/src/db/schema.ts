import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** 项目 */
export const projects = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  status: text('status').default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
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
  source: text('source').default('manual'), // semantic-scholar | arxiv | openalex | pubmed | manual
  tags: text('tags').default('[]'), // JSON: string[]
  citationCount: integer('citation_count').default(0),
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
  createdAt: integer('created_at').notNull(),
});

/** 知识库分块（检索单元） */
export const knowledgeChunks = sqliteTable('knowledge_chunk', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  content: text('content').notNull(),
  seq: integer('seq').default(0),
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
