import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UsageController } from './usage.controller';

@Module({
  imports: [AiModule],
  controllers: [SettingsController, UsageController],
  providers: [SettingsService],
})
export class SettingsModule {}
