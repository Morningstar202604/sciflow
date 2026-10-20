#!/usr/bin/env node
/**
 * CLI 入口（headless 批处理，对标 Cursor CLI / Cline headless / Codex CLI）
 *
 * 用法（编译后）：
 *   node apps/server/dist/cli.js <command> [options]
 *   sciflow health | project list | pipeline run|status | doc export | chat sessions | mcp serve
 *
 * `mcp serve` 以 stdio 启动真 MCP Server（官方 @modelcontextprotocol/sdk），
 * 供 Claude Desktop / Cursor 等 MCP 客户端直接接入：
 *   {"mcpServers":{"sciflow":{"command":"node","args":["<repo>/apps/server/dist/cli.js","mcp","serve"]}}}
 *
 * 解析由 commander 承担（替代原手写 argv 解析）。
 */

import 'dotenv/config';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env') });

import { Command } from 'commander';
import { NestFactory } from '@nestjs/core';
import { SpawnSyncOptions, spawnSync } from 'node:child_process';

const CLI_VERSION = '0.6.0';

/** 单次同步 HTTP 请求（复用已启动的本地服务，避免 CLI 自身启 server） */
function localApi(path: string, opts?: { method?: string; body?: unknown }): any {
  const base = process.env.SCIFLOW_BASE || 'http://127.0.0.1:3000';
  const res = spawnSync('node', ['-e', `
    const fetch = globalThis.fetch;
    fetch('${base}${path}', {
      method: '${opts?.method || 'GET'}',
      headers: { 'Content-Type': 'application/json' },
      body: ${opts?.body ? `JSON.stringify(${JSON.stringify(opts.body)})` : 'undefined'},
    }).then(r => r.text()).then(t => process.stdout.write(t)).catch(e => { process.stderr.write(String(e)); process.exit(1); });
  `], { encoding: 'utf-8', timeout: 30000 } as SpawnSyncOptions);
  if (res.error) throw res.error;
  try { return JSON.parse(res.stdout as string); } catch { return res.stdout as string; }
}

let app: any;
/**
 * 惰性创建 Nest 应用上下文。
 *
 * AppModule 用动态 import：静态导入会在模块加载期就拉起 db/database.ts 的顶层初始化
 * （建表、加载 sqlite-vec），导致 `sciflow --help` 也去建库并往 stdout 打日志。
 */
async function getApp() {
  if (!app) {
    const { AppModule } = await import('./app.module');
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  }
  return app;
}
async function closeApp() {
  if (app) { await app.close(); app = null; }
}

const program = new Command();
program
  .name('sciflow')
  .description('SciFlow CLI — headless 批处理入口')
  .version(CLI_VERSION, '--version', '显示版本');

program
  .command('health')
  .description('健康检查（需后端已启动）')
  .action(async () => {
    try {
      const r = localApi('/api/health');
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = r?.status === 'ok' ? 0 : 1;
    } catch (e: any) {
      console.error('服务不可达，请先启动后端：pnpm dev:server');
      console.error(`  详情：${e.message}`);
      process.exitCode = 1;
    }
  });

const project = program.command('project').description('项目管理');
project
  .command('list')
  .description('列出所有项目（直读 SQLite，无需后端）')
  .action(async () => {
    const { db } = await import('./db/database');
    const { projects } = await import('./db/schema');
    const list = db.select().from(projects).all();
    console.table(list.map((p: any) => ({ id: p.id, name: p.name, status: p.status })));
  });

const pipeline = program.command('pipeline').description('流水线（LangGraph 编排）');
pipeline
  .command('run')
  .description('创建流水线任务（异步执行；用 pipeline status 跟踪）')
  .requiredOption('--project <id>', '项目 ID')
  .requiredOption('--topic <text>', '研究主题')
  .action(async (opts) => {
    const ctx = await getApp();
    const { PipelineService } = await import('./pipeline/pipeline.service');
    const ps = ctx.get(PipelineService);
    const task = await ps.create(opts.project, opts.topic);
    console.log(`[pipeline] 已创建任务 ${task.id}，主题：${opts.topic}`);
    console.log(`[pipeline] 跟踪进度：node cli.js pipeline status --id ${task.id}`);
    await closeApp();
  });
pipeline
  .command('status')
  .description('查询流水线任务进度')
  .requiredOption('--id <taskId>', '任务 ID')
  .action(async (opts) => {
    const { db } = await import('./db/database');
    const { pipelineTasks } = await import('./db/schema');
    const { eq } = await import('drizzle-orm');
    const task = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, opts.id)).get() as any;
    if (!task) { console.error(`任务不存在：${opts.id}`); process.exitCode = 1; return; }
    console.log(JSON.stringify({
      id: task.id,
      topic: task.topic,
      status: task.status,
      currentStep: task.currentStep,
      retryCount: task.retryCount,
      documentId: task.documentId,
      lastError: task.lastError,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    }, null, 2));
  });

const doc = program.command('doc').description('文档导出');
doc
  .command('export')
  .description('导出文档（md 输出到 stdout；docx 输出 Base64）')
  .requiredOption('--doc <id>', '文档 ID')
  .option('--project <id>', '项目 ID（保留参数，导出不需要）')
  .option('--format <fmt>', 'md | docx', 'md')
  .action(async (opts) => {
    const ctx = await getApp();
    const { DocumentsService } = await import('./documents/documents.service');
    const ds = ctx.get(DocumentsService);
    if (String(opts.format).toLowerCase() === 'docx') {
      const r = await ds.exportDocx(opts.doc);
      console.log(r.base64);
    } else {
      const r = ds.exportMarkdown(opts.doc);
      console.log(r.markdown);
    }
    await closeApp();
  });

const chat = program.command('chat').description('科研问答');
chat
  .command('sessions')
  .description('列出最近对话摘要')
  .requiredOption('--project <id>', '项目 ID')
  .action(async (opts) => {
    const ctx = await getApp();
    const { ChatService } = await import('./chat/chat.service');
    const cs = ctx.get(ChatService);
    const sessions = cs.listSessionSummaries(opts.project);
    console.table(sessions.map((s: any) => ({
      id: s.id.slice(0, 8),
      summary: s.summary ? (s.summary.length > 60 ? s.summary.slice(0, 60) + '…' : s.summary) : '(empty)',
      messages: s.messageCount,
      tokens: s.totalTokens,
      at: new Date(s.createdAt).toLocaleString(),
    })));
    await closeApp();
  });

const mcp = program.command('mcp').description('MCP 协议');
mcp
  .command('serve')
  .description('以 stdio 启动真 MCP Server（官方 SDK；供 Claude Desktop 等客户端接入）')
  .action(async () => {
    const ctx = await getApp();
    const { McpService } = await import('./mcp/mcp.service');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const mcps = ctx.get(McpService);
    const server = mcps.buildSdkServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stderr 输出协议日志（stdout 保留给 JSON-RPC）
    console.error('[sciflow-mcp] stdio server 已就绪，等待客户端握手（Ctrl+C 退出）');
    const shutdown = async () => { try { await server.close(); } finally { await closeApp(); process.exit(0); } };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parseAsync(process.argv).catch(async (e) => {
  console.error(`命令执行失败：${e?.message || e}`);
  await closeApp();
  process.exit(1);
});
