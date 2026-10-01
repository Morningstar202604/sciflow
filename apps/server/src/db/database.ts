import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'sciflow.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// 写锁等待上限：并发写入排队而非立即报错（默认 5000ms）
sqlite.pragma('busy_timeout = 5000');

/** 建表 DDL（与 drizzle schema 保持一致，开箱即跑） */
sqlite.exec(`
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  preface TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  outline TEXT DEFAULT '[]',
  version INTEGER DEFAULT 1,
  versions TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reference (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT DEFAULT '[]',
  year INTEGER,
  venue TEXT DEFAULT '',
  doi TEXT DEFAULT '',
  url TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  tags TEXT DEFAULT '[]',
  citation_count INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS citation (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  location TEXT DEFAULT '',
  context TEXT DEFAULT '',
  format TEXT DEFAULT 'apa',
  verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_report (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  total_score INTEGER NOT NULL,
  scores TEXT NOT NULL,
  feedback TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  topic TEXT NOT NULL,
  current_step TEXT DEFAULT '',
  status TEXT DEFAULT 'running',
  steps TEXT DEFAULT '[]',
  retry_count INTEGER DEFAULT 0,
  trace TEXT DEFAULT '[]',
  last_error TEXT DEFAULT '',
  research_notice TEXT,
  research_meta TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polish_record (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  original TEXT NOT NULL,
  polished TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_doc (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  chunk_count INTEGER DEFAULT 0,
  reference_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER DEFAULT 0,
  context TEXT DEFAULT '',
  vector TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS reflexion_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  round INTEGER DEFAULT 1,
  note TEXT NOT NULL,
  instructions TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT,
  content TEXT NOT NULL,
  keywords TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_project ON document(project_id);
CREATE INDEX IF NOT EXISTS idx_reference_project ON reference(project_id);
CREATE INDEX IF NOT EXISTS idx_citation_document ON citation(document_id);
CREATE INDEX IF NOT EXISTS idx_quality_document ON quality_report(document_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline_task(project_id);
CREATE INDEX IF NOT EXISTS idx_polish_document ON polish_record(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_doc(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_doc ON knowledge_chunk(doc_id);
CREATE INDEX IF NOT EXISTS idx_reflexion_task ON reflexion_log(task_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_log(type);
CREATE TABLE IF NOT EXISTS agent_run (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  input TEXT DEFAULT '',
  output TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  error TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_task ON agent_run(task_id);
CREATE TABLE IF NOT EXISTS model_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  model TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_intent (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  route TEXT NOT NULL,
  keywords TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  is_custom INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_config (
  step_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  step_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_prompt (
  id TEXT PRIMARY KEY,
  tool_key TEXT NOT NULL UNIQUE,
  tool_label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_call_log (
  id TEXT PRIMARY KEY,
  caller TEXT DEFAULT 'general',
  model TEXT DEFAULT '',
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_caller ON llm_call_log(caller);
CREATE INDEX IF NOT EXISTS idx_llm_created ON llm_call_log(created_at);

-- 科研高级功能：系统综述筛选队列
CREATE TABLE IF NOT EXISTS screening_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reason TEXT DEFAULT '',
  reviewer TEXT DEFAULT 'me',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_screening_project ON screening_queue(project_id);

-- 科研高级功能：文献编码抽取字段与取值
CREATE TABLE IF NOT EXISTS extraction_field (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT DEFAULT 'text',
  options TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extraction_field_project ON extraction_field(project_id);

CREATE TABLE IF NOT EXISTS extraction_value (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  value TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extraction_value_field ON extraction_value(field_id);

-- 科研高级功能：审稿意见闭环
CREATE TABLE IF NOT EXISTS review_comment (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  category TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  response_text TEXT DEFAULT '',
  section_ref TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_comment_document ON review_comment(document_id);

-- 科研高级功能：自建期刊库（全局共享）
CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issn TEXT DEFAULT '',
  publisher TEXT DEFAULT '',
  scope_text TEXT DEFAULT '',
  if2024 REAL,
  quartile TEXT DEFAULT '',
  first_decision_weeks INTEGER,
  acceptance_rate REAL,
  oa TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

-- 轻量实验沙箱：本机 python3 执行记录
CREATE TABLE IF NOT EXISTS experiment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  goal TEXT DEFAULT '',
  code TEXT NOT NULL,
  stdout TEXT DEFAULT '',
  stderr TEXT DEFAULT '',
  stdout_truncated INTEGER DEFAULT 0,
  stderr_truncated INTEGER DEFAULT 0,
  figures TEXT DEFAULT '[]',
  conclusion TEXT DEFAULT '',
  runtime_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_project ON experiment(project_id);

-- 投稿流程状态跟踪：投稿记录 + 状态历史流水
CREATE TABLE IF NOT EXISTS submission (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT DEFAULT '',
  journal_id TEXT DEFAULT '',
  journal_name TEXT NOT NULL,
  manuscript_no TEXT DEFAULT '',
  title TEXT DEFAULT '',
  submitted_at INTEGER,
  current_status TEXT DEFAULT 'submitted',
  status_updated_at INTEGER,
  revision_deadline INTEGER,
  previous_submission_id TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_project ON submission(project_id);

CREATE TABLE IF NOT EXISTS submission_status_event (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  source TEXT DEFAULT 'manual',
  raw_email_text TEXT DEFAULT '',
  confidence REAL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_event_submission ON submission_status_event(submission_id);
`);

/** 轻量迁移：为旧库补齐新列（CREATE TABLE IF NOT EXISTS 不会修改已有表） */
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`[DB] 迁移：${table} 新增列 ${column}`);
  }
}
ensureColumn('pipeline_task', 'trace', "TEXT DEFAULT '[]'");
// Research 阶段跨库检索增强：命中 0 引导文案（null）+ 命中>0 命中摘要 JSON（''）
ensureColumn('pipeline_task', 'research_notice', "TEXT");
ensureColumn('pipeline_task', 'research_meta', "TEXT DEFAULT ''");
// 知识库 Contextual Retrieval 升级：旧库补齐 context/vector 列（RAG 混合检索依赖）
ensureColumn('knowledge_chunk', 'context', "TEXT DEFAULT ''");
ensureColumn('knowledge_chunk', 'vector', "TEXT DEFAULT '[]'");
// 文献库↔知识库打通（#5）：旧库补齐 reference_id 可空外键列
ensureColumn('knowledge_doc', 'reference_id', "TEXT");
// 科研高级功能：reference 阅读状态 / 去重指纹 / 重复指向
ensureColumn('reference', 'reading_status', "TEXT DEFAULT 'unread'");
ensureColumn('reference', 'fingerprint', "TEXT DEFAULT ''");
ensureColumn('reference', 'is_duplicate_of', "TEXT DEFAULT ''");
// 路线图差距 #11：文献笔记
ensureColumn('reference', 'notes', "TEXT DEFAULT ''");
// 路线图差距 #22：项目级系统提示 projectPreface
ensureColumn('project', 'preface', "TEXT DEFAULT ''");

/** 期刊库种子：内置国内主流期刊（仅写领域定位等事实描述；ISSN/IF/分区等不确定指标一律 NULL，禁止编造） */
const seedJournals = [
  ['计算机学报', '中国计算机学会（CCF）会刊，中国科学院计算技术研究所主办。刊登计算机科学理论、系统结构、软件、人工智能、计算机网络等方向的原创性研究论文。'],
  ['软件学报', 'CCF 会刊，中国科学院软件研究所主办。聚焦软件工程、程序设计语言、系统软件、形式化方法、智能化软件工程等方向的高水平研究。'],
  ['电子学报', '中国电子学会主办。覆盖电子科学与技术、信号与信息处理、通信、微电子、雷达与遥感等电子信息领域的基础与应用研究。'],
  ['自动化学报', '中国自动化学会与中国科学院自动化研究所主办。聚焦控制理论与控制工程、模式识别、智能系统、机器人、复杂系统等方向。'],
  ['中文信息学报', '中国中文信息学会主办。聚焦自然语言处理、中文信息处理、机器翻译、信息抽取、文本挖掘、计算语言学等方向。'],
  ['计算机研究与发展', 'CCF 会刊，中国科学院计算技术研究所主办。刊登计算机系统、体系结构、算法、数据库、人工智能、信息安全等方向的研究成果。'],
];
const journalCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM journal').get() as { c: number }).c;
if (journalCount === 0) {
  const insert = sqlite.prepare(
    'INSERT INTO journal (id, name, issn, publisher, scope_text, if2024, quartile, first_decision_weeks, acceptance_rate, oa, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)',
  );
  const now = Date.now();
  for (const [name, scope] of seedJournals) {
    insert.run(randomUUID(), name, '', '', scope, '', '', now);
  }
  console.log(`[DB] 期刊库种子：已写入 ${seedJournals.length} 个国内期刊`);
}

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
export { sqlite, DB_PATH };
