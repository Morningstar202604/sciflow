import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** 全链路总览：待确认大纲 / 超期投稿 / 未决意见 / 低分文档 + 计数，字段缺失降级为空数组/0 */
  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }
}
