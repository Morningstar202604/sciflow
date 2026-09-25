import { Controller, Get, Post, Body } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** 应用配置总览（AI 配置/模型列表/环境/数据源） */
  @Get()
  getSettings() {
    return this.settings.getSettings();
  }

  /** 环境自检：数据库 + AI 连通性 */
  @Get('check')
  selfCheck() {
    return this.settings.selfCheck();
  }

  /** 指定模型连接测试 */
  @Post('test')
  testModel(@Body() body: { model?: string }) {
    return this.settings.testModel(body.model || '');
  }
}
