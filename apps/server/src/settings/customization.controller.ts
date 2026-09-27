import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CustomizationService } from './customization.service';

@Controller('customization')
export class CustomizationController {
  constructor(private readonly customization: CustomizationService) {}

  // 意图库
  @Get('intents')
  listIntents() {
    return this.customization.listIntents();
  }

  @Post('intents')
  createIntent(@Body() body: { key: string; label: string; route: string; keywords: string[] }) {
    return this.customization.createIntent(body);
  }

  @Post('intents/:id')
  updateIntent(@Param('id') id: string, @Body() body: { label?: string; route?: string; keywords?: string[]; enabled?: number }) {
    return this.customization.updateIntent(id, body);
  }

  @Delete('intents/:id')
  deleteIntent(@Param('id') id: string) {
    return this.customization.deleteIntent(id);
  }

  @Delete('intents')
  resetIntents() {
    return this.customization.resetIntents();
  }

  // 意图判断模式
  @Get('judgment-mode')
  getJudgmentMode() {
    return { mode: this.customization.getJudgmentMode() };
  }

  @Post('judgment-mode')
  setJudgmentMode(@Body() body: { mode: string }) {
    return this.customization.setJudgmentMode(body.mode);
  }

  // 提示词
  @Get('prompts')
  listPrompts() {
    return this.customization.listPrompts();
  }

  @Post('prompts/:toolKey')
  upsertPrompt(@Param('toolKey') toolKey: string, @Body() body: { prompt: string; enabled?: number }) {
    return this.customization.upsertPrompt(toolKey, body);
  }

  @Delete('prompts/:toolKey')
  deletePrompt(@Param('toolKey') toolKey: string) {
    return this.customization.deletePrompt(toolKey);
  }
}
