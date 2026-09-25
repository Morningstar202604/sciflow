import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { LiteratureModule } from '../literature/literature.module';
import { ReferencesService } from './references.service';
import { ReferencesController } from './references.controller';

@Module({
  imports: [AiModule, LiteratureModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class ReferencesModule {}
