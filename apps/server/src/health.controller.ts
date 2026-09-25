import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai/ai.service';

@Controller()
export class HealthController {
  constructor(private readonly ai: AiService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      time: Date.now(),
      ai: this.ai.config,
    };
  }
}
