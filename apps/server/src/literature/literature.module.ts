import { Module } from '@nestjs/common';
import { LiteratureService } from './literature.service';

@Module({
  providers: [LiteratureService],
  exports: [LiteratureService],
})
export class LiteratureModule {}
