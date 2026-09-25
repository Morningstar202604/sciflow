import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AiModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
