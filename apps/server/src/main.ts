import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // ---------- 全局兜底：异步任务（流水线 fire-and-forget）漏网异常不再崩进程 ----------
  process.on('unhandledRejection', (reason) => {
    console.error(`[SciFlow] unhandledRejection 已兜底: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`[SciFlow] uncaughtException 已兜底: ${err.stack || err.message}`);
  });

  // ---------- 优雅关闭：SIGTERM/SIGINT 时安全落盘（WAL check point）+ 退出 ----------
  let app: any;
  const shutdown = async (signal: string) => {
    console.log(`[SciFlow] 收到 ${signal}，正在优雅关闭…`);
    try {
      if (app) await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  app = await NestFactory.create(AppModule);
  // CORS：默认仅放行本地开发来源，可通过 CORS_ORIGIN 配置（如逗号分隔多个域名；* 表示全放行）
  const corsOrigin = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigin.length === 1 && corsOrigin[0] === '*' ? true : corsOrigin,
    credentials: true,
  });
  app.setGlobalPrefix('api');
  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`[SciFlow] API 已启动: http://localhost:${port}/api/health`);

  // ---------- Checkpoint 断点续跑：重启后恢复中断的流水线任务（对标 LangGraph checkpointer） ----------
  try {
    const { PipelineService } = await import('./pipeline/pipeline.service');
    const pipeline = app.get(PipelineService);
    const resumed = pipeline.resumeInterrupted();
    if (resumed > 0) console.log(`[SciFlow] checkpoint 恢复完成：${resumed} 个中断任务已处理`);
  } catch (e: any) {
    console.warn(`[SciFlow] checkpoint 恢复失败（不影响启动）: ${e.message}`);
  }
}

bootstrap();
