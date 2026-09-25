import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'sciflow.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

/** 建表 DDL（与 drizzle schema 保持一致，开箱即跑） */
sqlite.exec(`
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER DEFAULT 0
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

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
export { sqlite, DB_PATH };
