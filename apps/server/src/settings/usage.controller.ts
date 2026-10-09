import { Controller, Get } from '@nestjs/common';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** LLM 调用成本汇总：总量 + 按调用方分组 + 按天分布（成本追踪仪表盘数据源） */
  @Get('summary')
  summary() {
    return this.usage.summary();
  }
}
