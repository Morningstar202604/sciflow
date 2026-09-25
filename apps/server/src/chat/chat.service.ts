import { Injectable } from '@nestjs/common';
import { AiService, ChatMessage } from '../ai/ai.service';

@Injectable()
export class ChatService {
  constructor(private readonly ai: AiService) {}

  async answer(message: string, history: ChatMessage[] = []) {
    return { answer: await this.ai.chat(message, history) };
  }

  stream(message: string, history: ChatMessage[] = []) {
    return this.ai.streamChat(message, history);
  }
}
