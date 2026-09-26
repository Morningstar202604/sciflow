import { Body, Controller, Post } from '@nestjs/common';
import { JudgmentService } from './judgment.service';

@Controller('judgment')
export class JudgmentController {
  constructor(private readonly judgment: JudgmentService) {}

  /** 意图识别：一句话 → 科研动作 + 置信度 + 路由（规则优先，LLM 兜底） */
  @Post('intent')
  intent(@Body() body: { message: string; context?: string }) {
    return this.judgment.intent(body.message || '', body.context || '');
  }
}
