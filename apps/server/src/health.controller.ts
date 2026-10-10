import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { Public } from './auth/public.decorator';
import { sqlite } from './db/database';

@Controller()
export class HealthController {
  constructor(private readonly ai: AiService) {}

  @Public()
  @Get('health')
  health() {
    // 数据库可用性自检（轻量 SELECT，失败不阻断 health 返回—— degraded 状态上报）
    let dbOk = true;
    try {
      sqlite.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? 'ok' : 'degraded',
      time: Date.now(),
      uptime: Math.floor(process.uptime()),
      authMode: process.env.AUTH_MODE || 'none',
      db: dbOk,
      desktop: process.env.SCIFLOW_DESKTOP === '1',
      ai: this.ai.config,
    };
  }
}
