import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [AiModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
