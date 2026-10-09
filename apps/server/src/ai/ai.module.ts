import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiTransportService } from './ai-transport.service';

@Module({
  providers: [AiTransportService, AiService],
  exports: [AiService, AiTransportService],
})
export class AiModule {}
