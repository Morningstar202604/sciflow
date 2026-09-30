import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db } from '../db/database';
import { experiments, projects } from '../db/schema';

/** 沙箱威胁模型：单用户本机。边界 = 独立临时目录 + 超时杀进程组 + 输出截断 + env 白名单 + 数组参数（不走 shell） */
const RUN_TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS || 10_000);
const MAX_STREAM_BYTES = 64 * 1024; // stdout / stderr 各截断阈值
const MAX_MEMORY_MB = 1024; // RSS 监控上限（约 1GB）
const MAX_FIGURES = 8; // 最多保留的 matplotlib 出图数
const MAX_FIGURE_BYTES = 800 * 1024; // 单张 png 上限

const runSchema = z.object({
  projectId: z.string().min(1),
  goal: z.string().max(2000).optional().default(''),
  code: z.string().min(1, '代码不能为空').refine((v) => v.trim().length > 0, '代码不能为空'),
  documentId: z.string().nullish(),
});

const updateSchema = z.object({
  goal: z.string().max(2000).optional(),
  conclusion: z.string().max(20_000).optional(),
});

/** env 白名单：只放行基础环境变量，避免把服务侧密钥透传给用户代码 */
function sandboxEnv(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'USER', 'SHELL'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of allowed) if (process.env[k]) env[k] = process.env[k];
  env['MPLBACKEND'] = 'Agg'; // 无界面后端，matplotlib 直接存 png
  env['PYTHONIOENCODING'] = 'utf-8';
  env['PYTHONUTF8'] = '1';
  return env;
}

@Injectable()
export class ExperimentsService {
  private pythonAvailable: boolean | null = null;

  /** 探测本机 python3（结果缓存；无则返回友好错误） */
  private hasPython(): boolean {
    if (this.pythonAvailable !== null) return this.pythonAvailable;
    const r = spawnSync('python3', ['--version'], { timeout: 3000, env: sandboxEnv() });
    this.pythonAvailable = !r.error;
    return this.pythonAvailable;
  }

  list(projectId: string) {
    return db
      .select()
      .from(experiments)
      .where(eq(experiments.projectId, projectId))
      .orderBy(desc(experiments.updatedAt))
      .all()
      .map((row) => this.toDto(row));
  }

  get(id: string) {
    const row = db.select().from(experiments).where(eq(experiments.id, id)).get();
    if (!row) throw new NotFoundException('实验记录不存在');
    return this.toDto(row);
  }

  /** 保存实验行并在临时目录中执行 python3 */
  async run(input: unknown) {
    const parsed = this.parse(runSchema, input);
    const project = db.select().from(projects).where(eq(projects.id, parsed.projectId)).get();
    if (!project) throw new NotFoundException('项目不存在');

    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId: parsed.projectId,
      documentId: parsed.documentId || null,
      goal: parsed.goal || '',
      code: parsed.code,
      stdout: '',
      stderr: '',
      stdoutTruncated: 0,
      stderrTruncated: 0,
      figures: '[]',
      conclusion: '',
      runtimeMs: 0,
      status: 'ok' as 'ok' | 'error' | 'timeout',
      createdAt: now,
      updatedAt: now,
    };

    // 无 python3：落一条 error 行，友好降级而非 500
    if (!this.hasPython()) {
      row.status = 'error';
      row.stderr = '未检测到 python3：请先在本机安装 Python 3（沙箱依赖本机解释器）。';
      db.insert(experiments).values(row).run();
      return this.get(row.id);
    }

    const result = await this.executePython(parsed.code);
    row.stdout = result.stdout;
    row.stderr = result.stderr;
    row.stdoutTruncated = result.stdoutTruncated ? 1 : 0;
    row.stderrTruncated = result.stderrTruncated ? 1 : 0;
    row.figures = JSON.stringify(result.figures);
    row.runtimeMs = result.runtimeMs;
    row.status = result.status;
    row.updatedAt = Date.now();
    db.insert(experiments).values(row).run();
    return this.get(row.id);
  }

  /** PATCH：仅允许改 goal / conclusion（zod 校验） */
  update(id: string, patch: unknown) {
    this.get(id); // 不存在则 404
    const parsed = this.parse(updateSchema, patch);
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (parsed.goal !== undefined) set.goal = parsed.goal;
    if (parsed.conclusion !== undefined) set.conclusion = parsed.conclusion;
    db.update(experiments).set(set).where(eq(experiments.id, id)).run();
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    db.delete(experiments).where(eq(experiments.id, id)).run();
    return { ok: true };
  }

  // ---------- 沙箱执行核心 ----------

  /** zod 校验失败转友好 400（与项目既有 BadRequestException 风格一致） */
  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data);
    if (!r.success) {
      throw new BadRequestException(r.error.issues.map((i) => i.message).join('；') || '请求参数有误');
    }
    return r.data;
  }

  private async executePython(code: string): Promise<{
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    figures: string[];
    runtimeMs: number;
    status: 'ok' | 'error' | 'timeout';
  }> {
    const workDir = mkdtempSync(path.join(tmpdir(), 'sciflow-exp-'));
    writeFileSync(path.join(workDir, 'main.py'), code, 'utf-8');
    const started = Date.now();
    let status: 'ok' | 'error' | 'timeout' = 'ok';
    let memoryKilled = false;

    try {
      const child = spawn('python3', ['main.py'], {
        cwd: workDir,
        env: sandboxEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // 独立进程组：超时可整组强杀
      });

      const outChunks: Buffer[] = [];
      let outLen = 0;
      let stdoutTruncated = false;
      child.stdout!.on('data', (c: Buffer) => {
        if (stdoutTruncated) return;
        if (outLen + c.length > MAX_STREAM_BYTES) {
          outChunks.push(c.subarray(0, MAX_STREAM_BYTES - outLen));
          outLen = MAX_STREAM_BYTES;
          stdoutTruncated = true;
          return;
        }
        outChunks.push(c);
        outLen += c.length;
      });
      const errChunks: Buffer[] = [];
      let errLen = 0;
      let stderrTruncated = false;
      child.stderr!.on('data', (c: Buffer) => {
        if (stderrTruncated) return;
        if (errLen + c.length > MAX_STREAM_BYTES) {
          errChunks.push(c.subarray(0, MAX_STREAM_BYTES - errLen));
          errLen = MAX_STREAM_BYTES;
          stderrTruncated = true;
          return;
        }
        errChunks.push(c);
        errLen += c.length;
      });

      const killGroup = () => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* 进程可能已退出 */
        }
      };

      // 超时杀进程组
      const timer = setTimeout(() => {
        if (status === 'ok') status = 'timeout';
        killGroup();
      }, RUN_TIMEOUT_MS);

      // RSS 内存监控（Linux /proc；其他平台静默跳过）
      const memTimer = setInterval(() => {
        try {
          const s = readFileSync(`/proc/${child.pid}/status`, 'utf-8');
          const m = s.match(/VmRSS:\s+(\d+)\s+kB/);
          if (m && Number(m[1]) > MAX_MEMORY_MB * 1024) {
            memoryKilled = true;
            killGroup();
          }
        } catch {
          /* 非 Linux / 进程已退出 */
        }
      }, 400);

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on('close', (codeNum) => {
          clearTimeout(timer);
          clearInterval(memTimer);
          resolve(codeNum);
        });
        child.on('error', () => {
          clearTimeout(timer);
          clearInterval(memTimer);
          resolve(null);
        });
      });

      let stdout = Buffer.concat(outChunks).toString('utf-8');
      let stderr = Buffer.concat(errChunks).toString('utf-8');
      if (stdoutTruncated) stdout += '\n…[输出过长，已截断]';
      if (stderrTruncated) stderr += '\n…[错误输出过长，已截断]';
      if (memoryKilled) {
        status = 'error';
        stderr += `\n[SciFlow] 内存超限（> ${MAX_MEMORY_MB}MB），进程已被终止。`;
      } else if (status !== ('timeout' as typeof status) && exitCode !== 0) {
        status = 'error';
      }

      return {
        stdout,
        stderr,
        stdoutTruncated,
        stderrTruncated,
        figures: this.collectFigures(workDir),
        runtimeMs: Date.now() - started,
        status,
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** 扫描临时目录中的 png，转 base64 data URL（按修改时间排序） */
  private collectFigures(workDir: string): string[] {
    let names: string[] = [];
    try {
      names = readdirSync(workDir).filter((n) => n.toLowerCase().endsWith('.png'));
    } catch {
      return [];
    }
    names.sort((a, b) => {
      try {
        return statSync(path.join(workDir, a)).mtimeMs - statSync(path.join(workDir, b)).mtimeMs;
      } catch {
        return 0;
      }
    });
    const figures: string[] = [];
    for (const name of names.slice(0, MAX_FIGURES)) {
      try {
        const buf = readFileSync(path.join(workDir, name));
        if (buf.length > MAX_FIGURE_BYTES) continue;
        figures.push(`data:image/png;base64,${buf.toString('base64')}`);
      } catch {
        /* 忽略读失败的图 */
      }
    }
    return figures;
  }

  private toDto(row: typeof experiments.$inferSelect) {
    let figures: string[] = [];
    try {
      const parsed = JSON.parse(row.figures || '[]');
      if (Array.isArray(parsed)) figures = parsed.map(String);
    } catch {
      figures = [];
    }
    return {
      id: row.id,
      projectId: row.projectId,
      documentId: row.documentId,
      goal: row.goal ?? '',
      code: row.code,
      stdout: row.stdout ?? '',
      stderr: row.stderr ?? '',
      stdoutTruncated: row.stdoutTruncated === 1,
      stderrTruncated: row.stderrTruncated === 1,
      figures,
      conclusion: row.conclusion ?? '',
      runtimeMs: row.runtimeMs ?? 0,
      status: (row.status || 'ok') as 'ok' | 'error' | 'timeout',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
