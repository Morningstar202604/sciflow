/**
 * CLI 入口模式（headless 批处理，对标 Cursor CLI / Cline headless / Codex CLI）
 *
 * 用途：
 *   - 无界面服务器上直接调用流水线、导出文档、查询 Agent 轨迹
 *   - CI/CD 集成、定时任务、批处理脚本
 *
 * 用法（编译后）：
 *   node apps/server/dist/cli.js <command> [options]
 *
 * 命令列表（v0.2.1）：
 *   health                              — 健康检查
 *   project list                        — 列出所有项目
 *   pipeline run   --project <id> --topic <text>   — 触发流水线并等待完成
 *   doc export     --project <id> --doc <id> --format md|docx — 导出文档（Base64）
 *   chat sessions  --project <id>       — 列出最近对话摘要
 */

import 'dotenv/config';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SpawnSyncOptions, spawnSync } from 'node:child_process';

const CLI_VERSION = '0.3.0';

interface CliCommand {
  name: string;
  description: string;
  usage?: string;
  run: (args: Record<string, string>, services: any) => Promise<number>;
}

function parseArgs(argv: string[]): { command: string[]; args: Record<string, string> } {
  const args: Record<string, string> = {};
  const command: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = val;
    } else {
      command.push(a);
    }
  }
  return { command, args };
}

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

const commands: CliCommand[] = [
  {
    name: 'health',
    description: '健康检查',
    run: async () => {
      try {
        const r = localApi('/api/health');
        console.log(JSON.stringify(r, null, 2));
        return r.status === 'ok' ? 0 : 1;
      } catch (e: any) {
        console.error('服务不可达，请先启动后端：pnpm server:dev');
        console.error(`  详情：${e.message}`);
        return 1;
      }
    },
  },
  {
    name: 'project list',
    description: '列出所有项目',
    run: async () => {
      // 直接查 DB（CLI 自身可不启 server）
      const { db } = await import('./db/database');
      const { projects } = await import('./db/schema');
      const list = db.select().from(projects).all();
      console.table(list.map((p: any) => ({ id: p.id, name: p.name, status: p.status })));
      return 0;
    },
  },
  {
    name: 'pipeline run',
    description: '触发流水线并等待（阻塞直到完成或失败）',
    run: async (args) => {
      if (!args.project || !args.topic) {
        console.error('缺少参数：--project <id> --topic <text>');
        return 1;
      }
      const { PipelineService } = await import('./pipeline/pipeline.service');
      const ps = app.get(PipelineService);
      const task = await ps.create(args.project, args.topic);
      console.log(`[pipeline] 已创建任务 ${task.id}，主题：${args.topic}`);
      console.log('[pipeline] 流水线为异步执行，请用以下命令跟踪进度：');
      console.log(`  node cli.js pipeline status --id ${task.id}`);
      return 0;
    },
  },
  {
    name: 'pipeline status',
    description: '查询流水线任务进度',
    usage: 'node cli.js pipeline status --id <taskId>',
    run: async (args) => {
      if (!args.id) { console.error('缺少参数：--id <taskId>'); return 1; }
      const { db } = await import('./db/database');
      const { pipelineTasks } = await import('./db/schema');
      const { eq } = await import('drizzle-orm');
      const task = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, args.id)).get() as any;
      if (!task) { console.error(`任务不存在：${args.id}`); return 1; }
      console.log(JSON.stringify({
        id: task.id,
        topic: task.topic,
        status: task.status,
        currentStep: task.current_step,
        retryCount: task.retry_count,
        createdAt: new Date(task.created_at).toISOString(),
        updatedAt: new Date(task.updated_at).toISOString(),
      }, null, 2));
      return 0;
    },
  },
  {
    name: 'doc export',
    description: '导出文档（Base64；--format md|docx）',
    run: async (args) => {
      if (!args.doc || !args.project) {
        console.error('缺少参数：--project <id> --doc <id> [--format md|docx]');
        return 1;
      }
      const { DocumentsService } = await import('./documents/documents.service');
      const ds = app.get(DocumentsService);
      const format = (args.format || 'md').toLowerCase();
      if (format === 'docx') {
        const r = await ds.exportDocx(args.doc);
        console.log(r.base64);
      } else {
        const r = ds.exportMarkdown(args.doc);
        console.log(r.markdown);
      }
      return 0;
    },
  },
  {
    name: 'chat sessions',
    description: '列出最近对话摘要',
    run: async (args) => {
      if (!args.project) { console.error('缺少参数：--project <id>'); return 1; }
      const { ChatService } = await import('./chat/chat.service');
      const cs = app.get(ChatService);
      const sessions = cs.listSessionSummaries(args.project);
      console.table(sessions.map((s: any) => ({
        id: s.id.slice(0, 8),
        summary: s.summary ? (s.summary.length > 60 ? s.summary.slice(0, 60) + '…' : s.summary) : '(empty)',
        messages: s.messageCount,
        tokens: s.totalTokens,
        at: new Date(s.createdAt).toLocaleString(),
      })));
      return 0;
    },
  },
];

let app: any;

async function bootstrap() {
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { command, args } = parseArgs(process.argv.slice(2));
  const cmdName = command.join(' ');
  if (!cmdName || args.help || args.h) {
    console.log(`SciFlow CLI v${CLI_VERSION} — headless 批处理入口\n`);
    console.log('用法：node apps/server/dist/cli.js <command> [--options]\n');
    console.log('可用命令：');
    for (const c of commands) {
      console.log(`  ${c.name.padEnd(22)} ${c.description}`);
      if (c.usage) console.log(`  ${' '.repeat(22)} → ${c.usage}`);
    }
    console.log('\n通用选项：--help, -h   显示此帮助');
    console.log('退出码：0=成功，1=失败/缺参');
    await app.close();
    return;
  }
  const cmd = commands.find((c) => c.name === cmdName);
  if (!cmd) {
    console.error(`未知命令：${cmdName}`);
    console.error(`可用命令：${commands.map((c) => c.name).join(' | ')}`);
    console.error('提示：加 --help 查看完整帮助');
    await app.close();
    process.exit(1);
  }
  try {
    const exitCode = await cmd.run(args, app);
    await app.close();
    process.exit(exitCode ?? 0);
  } catch (e: any) {
    console.error(`命令执行失败：${e?.message || e}`);
    await app.close();
    process.exit(1);
  }
}

void bootstrap();
